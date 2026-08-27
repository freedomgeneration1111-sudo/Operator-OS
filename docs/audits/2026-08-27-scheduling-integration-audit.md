# Scheduling / Booking Integration — Ground-Truth Audit

**Date:** 2026-08-27
**Scope:** Read-only inventory of everything in `operator-os` and `Sunny-ops` relevant to adding a
tenant-neutral scheduling/booking system to Operator OS.
**Method:** Direct file reads. Every claim below is anchored to `path:line`. Inferences are labelled
**(inferred)**; anything not found is called out as "not found" rather than omitted.
**Repos inspected:**

- `~/projects/operator-os` @ `main`, last commit `9bbf740` — **working tree is dirty** (see §7 note).
- `~/projects/Sunny-ops` @ `feat/check-availability-google-calendar`, last commit `2ad8d10`.

---

## 1. Existing scheduling / calendar / availability surface area

### 1.1 There is already a substantial, deployed availability subsystem in `operator-os`

This is not greenfield. A read-optimised, cron-fed availability pipeline already exists and is wired
into the live `focus` deployment:

| Concern | File | What it does |
|---|---|---|
| Google auth + freebusy | `src/google-calendar.ts` | Service-account JWT (`jose`), `POST oauth2.googleapis.com/token`, then `POST calendar/v3/freebusy` for **one** calendar. Scope is `calendar.readonly`. Comment at `:43` — "never `events.list`". Returns `FreeBusyInterval[]` (`{start,end}` only). |
| Timezone math | `src/availability-timezone.ts` | Pure helpers: `zonedDayBoundsUtc`, `addDaysIso`, `addMonthsIso`, `isoDateInTimeZone`, `isoDatesBetween`. No deps. |
| Cache builder (cron only) | `src/availability-cache.ts` | `refreshAvailabilityCache(env)` — freebusy over a rolling `AVAILABILITY_WINDOW_MONTHS` window, reduces to a whole-day busy-date set (`reduceBusyDates`, `:23`), writes JSON to KV key `availability:v1` (`AVAILABILITY_CACHE_KEY`, `:13`). No-ops silently if `AVAILABILITY_CACHE` / `GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY` / `GOOGLE_CALENDAR_ID` unset (`:37`). |
| Request-path resolver | `src/availability-api.ts` | `GET /v1/availability?date=YYYY-MM-DD`. **KV-read only**, never calls Google. `resolveAvailability()` (`:36`) returns `available` / `unavailable` / `unknown`; on `unavailable` also computes up to 3 `nearby` open dates within 21 days from the same cached set (`NEARBY_COUNT`/`NEARBY_RADIUS_DAYS`, `:16-17`). Stale cache (`AVAILABILITY_CACHE_STALE_MINUTES`, default 30) → everything `unknown` (`:73`). IP-hashed rate limit via `AVAILABILITY_RATE_LIMITER` (`:53`); if that binding is absent outside `development` the endpoint 503s (`:55`). |
| Internal scheduling assessment | `src/scheduling.ts` | Pure `assessScheduling(proposed, existing[], capacity)` → `clear` / `potential_conflict` / `capacity_conflict` / `review_required`. Date+time overlap logic with `definite` vs `potential` certainty. This is **decision-support only**, not a booking gate. |

**Route registration** — `src/index.ts`:

- `:56` — `/v1/availability` returns `404 module_disabled` unless `publicApiEnabled && profile.capabilities.availability`.
- `:57` — `GET /v1/availability` → `handleAvailability`.
- `:69` — `/v1/internal/schedule` returns `404 module_disabled` unless `profile.capabilities.schedule`.
- `:70` — `/v1/internal/inquiries/{id}/(capacity|conflicts)` gated on `profile.capabilities.capacity`.
- `:82` — `scheduled()` handler: the **only** cron entry point; `ctx.waitUntil(refreshAvailabilityCache(env))`.

**Staff API** — `src/staff-api.ts`:

- `:14` / `:87` `schedule()` — `GET /v1/internal/schedule?start&end&state` reads `events` joined to
  `inquiries`+`contacts` over a date range (`LIMIT 250`), runs `assessScheduling` per event against
  all the others, returns `{events:[{...row, assessment}]}`.

**CRM** — `src/crm.ts`:

- `:46` `GET /v1/internal/inquiries/{id}/conflicts` — single-event assessment via
  `listBlockingWindows` (`src/repository.ts:5`) + `assessScheduling`.
- `:40` `PATCH /v1/internal/inquiries/{id}/capacity` — toggles `events.blocks_capacity`.

**Staff PWA** — `staff-app/`:

- `src/views/ScheduleView.tsx` — month-navigator list view, calls `client.schedule(start,end,state)`
  (`src/lib/api.ts:13`), renders `ConflictBadge` / `CapacityBadge`. Range helper
  `src/lib/schedule.ts:monthRange`.
- `src/views/InquiryDetailView.tsx:24` — "Scheduling Review" panel (capability `schedule`), plus a
  capacity-blocking toggle (`:23`, capability `capacity`) with copy: *"This internal control does not
  notify the customer or confirm a booking."*
- Nav item "Schedule" only rendered when `capabilities.schedule` (`src/lib/business-profile.ts:10`,
  `routeEnabled` at `:16`).

**Tests already covering this area:** `test/google-calendar.test.ts`, `test/availability-cache.test.ts`,
`test/availability-api.test.ts`, `test/availability-timezone.test.ts`, `test/scheduling.test.ts`,
`test/staff-api.test.ts`, `test/helpers/test-service-account.ts`.

**Config / bindings that back it** (`deployments/focus-lab/api.staging.jsonc`):

- `:10` `kv_namespaces` → `AVAILABILITY_CACHE` id `41bd5932cce34db295fe820d491569a3`.
- `:14` `ratelimits` → `AVAILABILITY_RATE_LIMITER` namespace `12007`.
- `:16` `triggers.crons` → `["*/10 * * * *"]`.
- `:26` vars → `BUSINESS_TIMEZONE=America/Chicago`, `AVAILABILITY_WINDOW_MONTHS=6`, `AVAILABILITY_CACHE_STALE_MINUTES=30`.

The Moses API config (`deployments/moses-jorgensen/api.staging.jsonc`) has **no** `kv_namespaces`,
**no** `triggers`, **no** Google/availability vars — consistent with `availability:false, schedule:false`
for that profile.

> **Status caveat (from both repos' own docs):** `operator-os/CLAUDE.md:63` and
> `Sunny-ops/known-open-items.md:3` both state **"ADR-0001 (Google Calendar availability checking) is
> deferred indefinitely."** The GCP service account was never provisioned, so `GET /v1/availability`
> currently always returns `status:"unknown"` in production. The *code and bindings* are live; the
> *secrets and data* are not. `Check Availability` on the public site is, by product decision, a
> manual "state your dates, staff replies" flow routed through chat/inquiry — not automated calendar
> sync. Treat the existing pipeline as a dormant, tested foundation, not as a working feature.

### 1.2 `Sunny-ops` client-facing date/availability surface

| File | Role |
|---|---|
| `app/check-availability/page.tsx` | The route. Renders `<AvailabilityChecker/>` then `<CheckAvailabilityForm/>`. |
| `components/sections/AvailabilityChecker.tsx` | Date `<input>` → `getAvailability(date)` → renders `available` / `unavailable` (+ `nearby` chips) / `unknown`. CTAs link to `/check-availability?date=<iso>&availabilityChecked=<bool>#inquiry-form` (`:16-18`). Analytics: `availability_check_attempt`, `availability_check_result`, `availability_cta_request_date`, `availability_cta_ask_options`. |
| `components/sections/CheckAvailabilityForm.tsx` | Two-step inquiry form. Reads `date` + `availabilityChecked` from query string into form state (`:30`, and a re-sync `useEffect` at `:48-53`). Editing the date field resets `availabilityChecked` to `false` (`:88`). Submits via `submitInquiry({...form, turnstileToken, website}, idempotencyKey)`. |
| `lib/operations-api.ts` | `getAvailability(date)` (`:71`) — `GET {apiUrl}/v1/availability?date=` ; **always resolves**, any failure → `{status:"unknown"}`. `submitInquiry` (`:34`) → `POST {apiUrl}/v1/inquiries`. `InquirySubmission` type includes `availabilityChecked?: boolean` (`:4`). `apiUrl` = `NEXT_PUBLIC_INQUIRY_API_URL`. |
| `operations/src/public-site.ts` | Same-origin proxy Worker (`focus-lab-public-staging`). `:8` forwards `/v1/inquiries`, `/v1/availability`, `/v1/chat/status`, `/v1/chat/resume`, `/v1/chat/conversations*`, `/health` to the `OPERATIONS_API` service binding; everything else → static `ASSETS`. |
| `wrangler.staging.jsonc` | `focus-lab-public-staging`, `main: operations/src/public-site.ts`, service binding `OPERATIONS_API` → `focus-lab-api-staging`. |

"Check Availability" CTAs are scattered across the marketing site (`app/page.tsx`, `app/about`,
`app/pricing`, `components/layout/Header.tsx`/`Footer.tsx`, `components/sections/PageHero.tsx`,
`EventPage.tsx`, `PlanningGuidePage.tsx`, guides). All are plain links to `/check-availability`; none
carry booking logic.

No calendar widget, no time-slot picker, no "book a call" UI anywhere in `Sunny-ops`. **(inferred
from exhaustive grep of `app/`, `components/`, `lib/` for `calendar|schedule|booking|appointment|slot|
timeslot`.)**

### 1.3 The `availabilityChecked` flag — full lifecycle

**Where it is set (producer, `Sunny-ops`):**

1. `components/sections/AvailabilityChecker.tsx:16` — `requestDateHref(date, confirmed)` builds
   `/check-availability?date=…&availabilityChecked=${confirmed}`. `confirmed=true` only on the
   "Request This Date" CTA shown for an `available` result (`:59`); `false` for the `unavailable`
   "Ask Us About Options" (`:85`) and `unknown` "Send an Inquiry" (`:95`) CTAs.
2. `components/sections/CheckAvailabilityForm.tsx:30,52` — parsed from the query string
   (`params.get("availabilityChecked") === "true"`) into `form.availabilityChecked`; reset to `false`
   if the user edits the date (`:88`).
3. `lib/operations-api.ts:4` — carried on `InquirySubmission`; `submitInquiry` posts the whole `form`
   object (spread) as the JSON body of `POST /v1/inquiries`.

**Where it is accepted (`operator-os`):**

4. `src/index.ts:33` — body → `inquiryRequestSchema.safeParse(inquiryInput)`.
5. `src/contracts.ts:32` — **`availabilityChecked: z.boolean().optional()`**. The schema is
   `.strict()` (`:33`), so this field exists *specifically* to let the key survive validation rather
   than be rejected as unknown. This line is **committed** (not part of the dirty working tree).

**Where it is persisted:**

6. `src/inquiry-adapters.ts:21` — `focusCommand()` sets `intake:{ …, payload:{...input} }`, i.e. the
   entire validated input object, `availabilityChecked` included.
7. `src/inquiry-service.ts:43` — `payloadJson = JSON.stringify(command.intake.payload)`.
8. `src/inquiry-service.ts:87-94` — inserted into **`intake_submissions.payload_json`** (a
   `json_valid`-checked TEXT blob, ≤16 KiB — `migrations/0006…sql:230`).

**Where it is read downstream: nowhere.**

- `src/repository.ts:45-47` — `getInquiryDetail()` selects explicit columns from `intake_submissions`
  (`id, form_schema_key, schema_version, origin, source_channel, referral, landing_page, referrer,
  utm_*, captured_at, received_at`). **`payload_json` is deliberately not selected.**
- `src/ops-notify.ts:54` — joins `intake_submissions` for attribution columns only; never
  `payload_json`.
- Grep of `src/`, `staff-app/src/` for `payload_json` / `payloadJson` / `availabilityChecked`:
  the only non-test hits are the write path above and the schema line. No staff console field, no
  notification line, no CRM filter, no activity metadata.
- `staff-app/src/lib/types.ts:32` — the typed `intakeSubmissions` shape the PWA consumes has no
  `payload_json` member.

**Conclusion:** `availabilityChecked` is **write-only / captured-but-unsurfaced**. It lands in the
`payload_json` blob verbatim and nothing — staff console, notifications, CRM view, activity log —
reads it back. It is not promoted to its own column. Its only current value is forensic (a manual
`SELECT payload_json …` in D1).

### 1.4 Third-party scheduling APIs / SDKs

- **Google Calendar** — yes, but only `freebusy.query` + OAuth token, hand-rolled in
  `src/google-calendar.ts` using `jose`. No `googleapis` SDK. Secrets:
  `GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY`, `GOOGLE_CALENDAR_ID` (declared in `secrets.d.ts:27-28`,
  `.dev.vars.example:18-19`; **never provisioned** per §1.1 caveat).
- **Calendly / Cal.com / Acuity / Nylas / Google Meet / Zoom / SavvyCal / Motion** — **not found**
  in either repo's `package.json`, `wrangler*.jsonc`, `secrets.d.ts`, `.dev.vars.example`, or source.
- `operator-os` runtime deps are just `jose`, `react`, `react-dom`, `web-push`, `zod`
  (`package.json:28-34`).
- MCP tools named `Google_Calendar__*` are available to *this Claude session* but are not referenced
  by, or wired into, either codebase.

---

## 2. Tenant capability-flag pattern

### 2.1 Where flags live

`business-profiles.mts` (repo root, `.mts`, imported by both Worker source and — via a Vite define —
the staff PWA). Single source of truth. Structure:

- `BusinessCapabilities` type (`:1-9`): `{ event, schedule, capacity, availability, whatsappChannel,
  opsNotifyEmail, opsNotifyPush }` — all `boolean`.
- `BusinessProfile` type (`:15-29`): key `"focus"|"moses"`, display strings, `logoUrl`,
  `capabilities`, `publicEventInquiry`, `publicConsultingInquiry` *(added in the dirty working tree —
  see §7)*, `publicChat`, `pushTopicPrefix`, `vocabulary`.
- `profiles` record (`:32-48`): the two concrete profiles.
  - `focus`: `{event:true, schedule:true, capacity:true, availability:true, whatsappChannel:false,
    opsNotifyEmail:true, opsNotifyPush:true}`.
  - `moses`: `{event:false, schedule:false, capacity:false, availability:false, whatsappChannel:true,
    opsNotifyEmail:true, opsNotifyPush:true}`.
- `resolveBusinessProfile(value)` (`:50`) — `value || "focus"`, throws on anything but
  `focus`/`moses`. `resolveClientBusinessProfile` (`:55`) — same, minus the build-only `logoSource`.

There is **no D1 table, no KV entry, and no runtime store** for capability flags. They are compiled
constants keyed by a single string.

### 2.2 How the key is selected per deployment

- **Worker:** `env.BUSINESS_PROFILE`, set in each deployment config's `vars`
  (`deployments/focus-lab/api.staging.jsonc:18` → `"focus"`;
  `deployments/moses-jorgensen/api.staging.jsonc:8` → `"moses"`; likewise the two `console.*.jsonc`).
  Root `wrangler.jsonc` has **no** `BUSINESS_PROFILE` var → defaults to `focus` via `:50`.
- **Staff PWA:** build-time. `npm run staff:build:focus` sets `VITE_BUSINESS_PROFILE=focus`
  (`package.json:14-18`); `staff-app/src/lib/business-profile.ts:3-4` reads a Vite-injected
  `declare const __BUSINESS_PROFILE__` constant. **(inferred:** the `__BUSINESS_PROFILE__` define is
  produced in `staff-app/vite.config.mts` from `VITE_BUSINESS_PROFILE` — config file not read in this
  pass, but the naming and the `resolveClientBusinessProfile` call in the test make this certain.)

### 2.3 How flags are read at request time

`src/index.ts:51` — `const profile = resolveClientBusinessProfile(env.BUSINESS_PROFILE);` once per
request, then:

- `:54-55` — `profile.publicEventInquiry` / `profile.publicConsultingInquiry` select the inquiry adapter.
- `:56` — `profile.capabilities.availability` gates `/v1/availability` (→ `404 module_disabled`).
- `:58` — `profile.publicChat` gates `/v1/chat/*`.
- `:63` — `profile.capabilities.whatsappChannel` gates `/v1/webhooks/whatsapp`.
- `:69` — `profile.capabilities.schedule` gates `/v1/internal/schedule`.
- `:70` — `profile.capabilities.capacity` gates `/v1/internal/inquiries/{id}/(capacity|conflicts)`.

Same pattern elsewhere: `src/ops-notify.ts:13-14,43-44` (`opsNotifyEmail`), `src/auth.ts:35`
(`shortName` for error copy). Disabled modules return `{ok:false,error:{code:"module_disabled"}}` and
**do not mutate state** (`API.md:37`).

Staff PWA: `staff-app/src/App.tsx:36` (`businessProfile.capabilities.schedule` before mounting
`ScheduleView`), `:41` (`routeEnabled`), `InquiryDetailView.tsx:12,21,24`, `InboxView.tsx:18-19`.

### 2.4 `whatsappChannel` — the precedent to copy (ADR-0003)

`docs/adr/ADR-0003-whatsapp-channel.md` Decision 3 (`:49-63`) is the explicit template for adding a
channel flag:

> *"Gate the route behind a new `whatsappChannel` flag in `BusinessCapabilities` (default `false` for
> both tenants), following the existing `publicChat`/`publicEventInquiry` pattern … rather than
> bypassing capability gating entirely or reusing `publicChat` — WhatsApp is a distinct product
> decision."*

It was later flipped `true` for `moses` only. `opsNotifyEmail`/`opsNotifyPush` were added the same way
in ADR-0004 Decision 2.

### 2.5 How to add a `schedulingChannel` (or similar) flag — the mechanical checklist

1. Add the field to `BusinessCapabilities` in `business-profiles.mts:1-9`.
2. Set it explicitly on **both** `focus` and `moses` in the `profiles` record (`:38`, `:45`).
   Default `false` unless the tenant is meant to have it now.
3. Update `staff-app/src/lib/business-profile.test.ts:7-8` — both `expect(profile.capabilities)
   .toEqual({…})` literals enumerate every flag; a missing entry is exactly the "known-failing test"
   noted in `CLAUDE.md:64` and `known-open-items.md`.
4. Gate the new route(s) in `src/route()` (`src/index.ts`) with the same
   `404 module_disabled` shape.
5. If the staff PWA gets a new view/nav item, gate it in `staff-app/src/lib/business-profile.ts`
   (`navigationFor`, `routeEnabled`) and `App.tsx`.
6. Run `npm run test:config-isolation` (`scripts/deployment-isolation.test.mjs`) — `CLAUDE.md:52,59`
   says run it on any `business-profiles.mts` or deployment-config change.
7. Add any new bindings/vars/secrets to **each** `deployments/<tenant>/*.jsonc` that should have the
   feature (and to `secrets.d.ts` on both `Env` and `Cloudflare.Env`).

---

## 3. D1 schema relevant to scheduling

### 3.1 Migration directory + convention

- Location: `operator-os/migrations/`. Applied with
  `wrangler d1 migrations apply <db> --remote --config <deployment-config>` (`CLAUDE.md:45`); schema
  and code deploys are **decoupled**.
- Naming: `NNNN_snake_case_description.sql`, zero-padded sequential. Current set:
  `0001_operations_foundation.sql`, `0002_staff_access_identity.sql`, `0003_native_web_chat.sql`,
  `0004_staff_web_push.sql`, `0005_customer_email_continuity.sql`,
  `0006_business_neutral_inquiries.sql`, `0007_conversation_reply_preferences.sql`.
- Convention (ADR-0003 `:28`, ADR-0002 per its impl report): **additive-only** — `ALTER TABLE … ADD
  COLUMN`, new tables, new indexes. **0006 is the sole exception**: a full `CREATE _s1_* AS SELECT …`
  / `DROP` / recreate / `INSERT … SELECT` table-rebuild dance under `PRAGMA defer_foreign_keys`, done
  because SQLite/D1 cannot `ALTER … DROP CONSTRAINT` (it made `inquiries.event_id` nullable and added
  `consulting_details` + `intake_submissions`).
- No `migrations` metadata table is checked in; `RESOURCE_PLAN.md` tracks applied state loosely and
  is explicitly called stale in ADR-0003 `:158-161`.
- Seed data: `seeds/development.sql` (synthetic only), reset via `scripts/reset-local-db.mjs`.
- Local test schema is injected via `Cloudflare.Env.TEST_MIGRATIONS` (`secrets.d.ts:75`,
  `test/setup.ts`).

### 3.2 `intake_submissions` — full schema (`migrations/0006_business_neutral_inquiries.sql:213-234`)

```sql
CREATE TABLE intake_submissions (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  form_schema_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  origin TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  referral TEXT,
  landing_page TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 16384)
);
CREATE INDEX intake_submissions_inquiry_idx    ON intake_submissions(inquiry_id, received_at DESC);
CREATE INDEX intake_submissions_source_idx     ON intake_submissions(source_channel, captured_at DESC);
CREATE INDEX intake_submissions_campaign_idx   ON intake_submissions(utm_campaign, captured_at DESC)
  WHERE utm_campaign IS NOT NULL;
```

- Every field except `payload_json` and `referral`/`utm_*` is `NOT NULL`.
- `payload_json` holds the full validated public-form input as JSON (see §1.3). All timestamps are
  ISO-8601 TEXT (repo-wide convention — no real `DATE`/`DATETIME` types anywhere).
- Written only by `src/inquiry-service.ts:87`; one row per inquiry today (`test/api.test.ts:53`).

### 3.3 `events` — the closest thing to a bookings table (`0001_operations_foundation.sql:12-24`)

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY, event_family TEXT, start_date TEXT, end_date TEXT,
  start_time TEXT, end_time TEXT, venue_location TEXT,
  guest_count INTEGER CHECK (guest_count IS NULL OR guest_count > 0),
  blocks_capacity INTEGER NOT NULL DEFAULT 0 CHECK (blocks_capacity IN (0,1)),
  scheduling_state TEXT NOT NULL DEFAULT 'requested'
    CHECK (scheduling_state IN ('requested','tentative','confirmed','cancelled','declined')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR start_date IS NOT NULL)
);
CREATE INDEX events_date_range_idx     ON events(start_date, end_date);
CREATE INDEX events_capacity_range_idx ON events(blocks_capacity, scheduling_state, start_date, end_date);
```

- `start_date`/`end_date`/`start_time`/`end_time` are all **nullable** TEXT (`YYYY-MM-DD` / `HH:MM`,
  enforced only at the Zod layer, `src/contracts.ts:5-6`).
- `blocks_capacity` is the manual staff toggle that feeds conflict assessment; it does **not**
  represent a confirmed booking. `scheduling_state` is a 5-value lifecycle but there is **no**
  transition logic, no state machine, and no customer-visible meaning — `crm.ts` never writes it
  (only `blocks_capacity` and `workflow_state` are mutated).
- One `events` row per `inquiries` row for `focus` (event extension); `moses` inquiries have
  `event_id = NULL`.
- `0006` migration recreates `inquiries` with `event_id TEXT REFERENCES events(id)` **nullable**
  (was `NOT NULL` in `0001`).

### 3.4 Other tables that could plausibly touch a booking/availability system

| Table | Migration | Relevance |
|---|---|---|
| `inquiries` | `0006:29-42` | `id, contact_id, event_id?, source_channel, workflow_state (new→…→won/lost/archived), budget_context?, customer_note?, idempotency_key UNIQUE, created_at, updated_at`. The CRM spine a booking would attach to. |
| `contacts` | `0001:3-10` | `id, full_name, email?, phone?, preferred_contact?, timestamps`. `CHECK(email OR phone)`. Unique index on `lower(email)`. No phone uniqueness (ADR-0003 `:85-92` flags this). Customer identity for any booking. |
| `responders` | `0001:47-51` + `0002` | Staff. `id, display_label, active, role (admin/manager/responder), access_subject?, verified_email?`. Would be the "assignee"/"host" for a staff-side calendar. |
| `responder_presence` | `0001:83-88` | `responder_id PK, available (0/1), heartbeat_at, expires_at, updated_at`. **Live/away toggle, not a calendar** — TTL-based (`PRESENCE_TIMEOUT_SECONDS`). Powers chat "live vs async". |
| `assignments` | `0006:50-56` | `(inquiry_id, responder_id)` M:N + `assigned_at, assigned_by`. |
| `activities` | `0006:86-95` | Append-only audit: `inquiry_id?, event_id?, actor_kind, activity_type, metadata_json, created_at`. Existing types include `workflow_changed`, `capacity_blocking_changed`, `responder_assigned`. A booking event would add rows here (`recordActivity`, `repository.ts:67`). |
| `conversations` | `0006:66-84` + `0007` | `contact_id, inquiry_id?, event_id?, provider (native_web/whatsapp), channel_state (open/closed/pending), assigned_responder_id?, reply_email/reply_sms/reply_call (0/1)`. Channel a booking confirmation thread could live in. |
| `conversation_notifications` | `0005:15-29` / `0006:154-169` | **The reusable delivery-bookkeeping table.** `conversation_id, message_id, message_sequence, resume_token_id?, provider, status (pending/accepted/failed), provider_message_id?, failure_code?, attempted_at, completed_at, cleared_at`, `UNIQUE(conversation_id, message_sequence)`. ADR-0003 Decision 2 reused this as-is for WhatsApp; a booking-confirmation/reminder sender could do the same or model itself on it. |
| `conversation_resume_tokens` | `0005:3-13` | SHA-256-hashed single-purpose tokens (`purpose CHECK IN ('email_continuity')`). A "manage your booking" link would extend the `purpose` enum. |
| `push_subscriptions` / `push_deliveries` | `0004` | Web Push to staff PWA. `push_deliveries` PK `(event_id, subscription_id)` where `event_id` is a notification id string, **not** an `events.id`. |
| `consulting_details` | `0006:197-211` | `moses` per-inquiry 1:1 extension (`timeline`, `budget`, …). Precedent for a per-inquiry typed extension table — a `booking_details` table would mirror this shape. |

**No table for:** bookings/reservations, appointment slots, availability rules/working-hours,
blackout dates, calendar connections/OAuth tokens, time-slot inventory, holds/locks, or deposits.
The `AVAILABILITY_CACHE` KV entry (`availability:v1`) is the *only* persisted availability state and
it is a derived, disposable read-cache.

### 3.5 `Sunny-ops` D1

`Sunny-ops` has a local `operations/.wrangler/state/.../d1/*.sqlite` (miniflare dev artefact only) and
`operations/test/*`. It defines **no migrations and no schema of its own** — its Worker
(`operations/src/public-site.ts`) is a pure proxy with only `ASSETS` + `OPERATIONS_API` bindings. All
schema lives in `operator-os`.

---

## 4. Notification plumbing

### 4.1 Resend wiring (structure only — already documented as working)

Two distinct Resend call sites, both raw `fetch("https://api.resend.com/emails", …)` with
`Authorization: Bearer ${env.RESEND_API_KEY}` — **no SDK**.

| Module | Function | Trigger | Recipient | Notes |
|---|---|---|---|---|
| `src/ops-notify.ts` | `dispatchOpsNotificationEmail(env, {conversationId,sequence,senderKind})` | Every inbound **customer** message, from `StaffChatHub.deliver()` (`src/chat-durable.ts:37`, `ctx.waitUntil`) | per-tenant `env.OPS_NOTIFY_EMAIL` | Gated `profile.capabilities.opsNotifyEmail` (`:14`); logs + returns if `RESEND_API_KEY`/`CUSTOMER_EMAIL_FROM`/`OPS_NOTIFY_EMAIL` unset (`:15-18`). Builds a plain-text body incl. a `STAFF_CONSOLE_ORIGIN` deep link. |
| `src/ops-notify.ts` | `dispatchConsultingInquiryNotificationEmail(env, {inquiryId})` | New `moses` consulting inquiry, from `src/index.ts:42` (`ctx.waitUntil`) | `env.OPS_NOTIFY_EMAIL` | Same gating. **This is working-tree-only — see §7.** |
| `src/customer-email.ts` | `ResendCustomerNotificationEmailProvider.sendConversationReplyNotification({to, customerFirstName, resumeUrl, idempotencyKey})` | Staff replies while customer not connected, via `notifyCustomerOfAbsentReply` (`src/customer-continuity.ts:7`) ← `ChatRoom.persist()` (`src/chat-durable.ts:25`) | the **customer** | Provider-interface pattern (`CustomerNotificationEmailProvider`, `:11`). Sends `Idempotency-Key` header. Records to `conversation_notifications`. HTML + text. `CUSTOMER_EMAIL_FROM` as `from`. |

Secrets (declared `secrets.d.ts:21-25`, `.dev.vars.example`): `RESEND_API_KEY`, `CUSTOMER_EMAIL_FROM`,
`OPS_NOTIFY_EMAIL`, `STAFF_CONSOLE_ORIGIN`, `CUSTOMER_CONVERSATION_ORIGIN`. Per-tenant `OPS_NOTIFY_EMAIL`
+ `STAFF_CONSOLE_ORIGIN` are plain `vars` in each `deployments/<tenant>/api.staging.jsonc`
(`focus`: `focuslabproductions@gmail.com` / `https://staff.focuslabproductions.com`; `moses`:
`freedomgeneration1111@gmail.com` / `https://staff.mosesjorgensen.com`). `RESEND_API_KEY` /
`CUSTOMER_EMAIL_FROM` are runtime secrets (ADR-0004 Decision 6 flags their provisioning as
"verify before live").

**The module a booking confirmation/reminder sender would extend or mirror:** `src/ops-notify.ts`
for staff-facing, and `src/customer-email.ts`'s `CustomerNotificationEmailProvider` interface for
customer-facing. Both take `env` + a small event object and are `void`-returning fire-and-forget
(always called inside `ctx.waitUntil(...).catch(log)`). A `sendBookingConfirmation` /
`sendBookingReminder` would slot in as either a third function in `ops-notify.ts` or a second method
on the customer-email provider interface. `conversation_notifications` is the delivery-audit table to
reuse (ADR-0003 already did this for a non-chat sender).

### 4.2 Cron Triggers

- **Only one cron exists**: `"*/10 * * * *"` (every 10 min), declared in
  `deployments/focus-lab/api.staging.jsonc:16` and root `wrangler.jsonc:55-58`.
- **Only handler**: `src/index.ts:82` `scheduled()` → `refreshAvailabilityCache(env)`. Single
  statement, wrapped in `ctx.waitUntil` + `.catch(log)`.
- The Moses API config has **no** `triggers` block.
- **No Durable Object alarms anywhere** — grep for `alarm` / `setAlarm` in `src/` returns nothing.
  All scheduled work is cron-only.
- Implication for reminders: a booking-reminder job would either (a) add a second cron expression to
  the same `triggers.crons` array and branch inside `scheduled()` on `event.cron`, or (b) introduce
  DO alarms (new pattern for this codebase). Option (a) matches existing precedent.

---

## 5. Staff console

### 5.1 Shape

- **One React/Vite PWA** in `staff-app/`, built per-tenant. `npm run staff:build:focus` /
  `:moses` set `VITE_BUSINESS_PROFILE` (+ `VITE_APP_STAGE=staging VITE_AUTH_MODE=access` for the
  `:staging` variants). Output `staff-app/dist/` is served as Worker Static Assets
  (`not_found_handling: single-page-application`, `run_worker_first: true`).
- **The console Worker is `src/console.ts`** — a 3-line re-export of `src/index.ts` (same routing,
  same handlers). Deployed as `focus-lab-operations-staging` / `moses-operator-console-staging` from
  `deployments/<tenant>/console.staging.jsonc`, with `PUBLIC_API_ENABLED:"false"` (public routes fail
  closed) and a `CHAT_API` **service binding** to the tenant's API Worker (the API Worker owns the
  Durable Objects; the console has none — `docs/deployment-model.md:5-7`).
- Custom-domain routes: `staff.focuslabproductions.com` (`deployments/focus-lab/console.staging.jsonc:9`)
  and `staff.mosesjorgensen.com` (`deployments/moses-jorgensen/console.staging.jsonc:4`), both
  `custom_domain: true`, plus the parallel `*.workers.dev` hostname. Consolidated into the
  `deployments/` configs by ADR-0004 Decision 5 (previously split with root `wrangler.jsonc`).

### 5.2 Auth

`src/auth.ts`:

- `authenticateStaff(request, env)` (`:25`): if `ENVIRONMENT==="development" && STAFF_AUTH_MODE==="development"`
  → dev-token path (`INTERNAL_API_TOKEN` bearer + `X-Development-Responder-Id` header). Otherwise
  **Cloudflare Access**: verifies the `Cf-Access-Jwt-Assertion` JWT via `jose` `createRemoteJWKSet`
  against `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` (`:33-34`), then `resolveStaffIdentity` (`:51`) looks
  the `sub`/`email` up in the **`responders`** table (must exist, `active=1`, valid `role`).
- `ACCESS_AUD` is **per-tenant** (`focus`: `295ea7bd…0000`; `moses`: `155a76ec…354b`) — separate
  Access applications (`docs/deployment-model.md`, `RESOURCE_PLAN.md:10`).
- RBAC: `Permission` union + `permissions` record by role (`:9-15`). `requirePermission` throws
  `AuthenticationError(403)`. Relevant perms: `crm:read`, `workflow:update`, `assignment:self`,
  `assignment:manage`, `capacity:manage`, `presence:self`, `staff:admin`. **There is no
  scheduling-specific permission** — `/v1/internal/schedule` only requires a valid identity
  (`staff-api.ts` never calls `requirePermission`), and `conflicts` requires `crm:read` via
  `handleCrm` (`crm.ts:12`).

### 5.3 Where a staff calendar/booking view would plug in

- **Routing:** `staff-app/src/App.tsx:33-41` — hash routes (`useHashRoute`), a chain of
  `route.startsWith("/…")` checks. Add `else if (route.startsWith("/calendar") &&
  businessProfile.capabilities.<flag>) content = <CalendarView …/>`.
- **Nav:** `staff-app/src/lib/business-profile.ts:7-14` `navigationFor()` — add
  `...(profile.capabilities.<flag> ? [{href:"/calendar",label:"Calendar"}] : [])`, and extend
  `routeEnabled()` (`:16`).
- **API client:** `staff-app/src/lib/api.ts` `OperationsClient` — add methods next to `schedule()`
  (`:13`). All methods go through `request<T>()` which handles Access-redirect detection.
- **Types:** `staff-app/src/lib/types.ts` — new response types next to `ScheduleEvent` / `Assessment`.
- **Backend route:** `src/index.ts` `route()` inside the `/v1/internal/` block (`:67-75`), then a new
  handler module mirroring `src/staff-api.ts` (`handleStaffApi` returns `Response | null` and is
  tried before `handleCrm`).
- **The existing "lead view" UI** is `staff-app/src/views/InboxView.tsx` (list) →
  `InquiryDetailView.tsx` (detail, incl. the "Scheduling Review" and capacity panels). A booking-
  management view would most naturally live as a sibling view + a new panel in `InquiryDetailView`.

---

## 6. ADR precedent

### 6.1 Location & naming

- Directory: `operator-os/docs/adr/`.
- Decision docs: `ADR-NNNN-kebab-title.md` (`ADR-0003-whatsapp-channel.md`,
  `ADR-0004-staff-fallback-notifications.md`, `ADR-0005-decouple-whatsapp-secrets-enable-moses-chat.md`).
- Pre-implementation audits: `docs/audits/<kebab-topic>.md` (`whatsapp-channel-readiness.md`,
  `staff-fallback-notification-audit.md`) — **this file follows that convention.**
- Implementation reports: naming is **inconsistent** —
  `docs/adr/ADR-0003-implementation-report.md` but `docs/audits/ADR-0004-implementation-report.md` and
  `docs/audits/ADR-0005-implementation-report.md`. `Sunny-ops` keeps its own at
  `reports/2026-08-19-adr-0002-implementation-report.md` (date-prefixed).

### 6.2 ADR-0001 and ADR-0002 — **no ADR document exists for either**

Searched both repos (and `~/projects/Sunny`, `~/projects/Moses`). Findings:

- **ADR-0001** ("Google Calendar availability checking") — referenced only as a *deferral note* in
  `operator-os/CLAUDE.md:63` and `Sunny-ops/known-open-items.md:3`. No file named `ADR-0001*` anywhere.
- **ADR-0002** ("Conversation Reply Preferences & Continuity") — the decision file
  `ADR-0002-conversation-reply-preferences.md` is *cited* by
  `Sunny-ops/reports/2026-08-19-adr-0002-implementation-report.md:3`,
  `Sunny-ops/docs/native-web-chat.md:27`, and `operator-os/docs/adr/ADR-0003-whatsapp-channel.md:28`
  — but the file itself is **not present in any repo** (only the implementation report survives, in
  `Sunny-ops/reports/`). Migration `0007_conversation_reply_preferences.sql` and commit
  `0b34aa3` are its code artefacts.

**(inferred:** ADRs 0001–0002 predate the `operator-os` extraction from the `Sunny` monorepo; their
decision docs were not carried across, leaving 0003 as the first ADR physically in `operator-os`. A
new scheduling ADR would be **ADR-0006**.)

### 6.3 House style (from ADR-0003, ADR-0004, ADR-0005)

Section order, Markdown `##` headings:

1. `# ADR-NNNN: Title`
2. `## Status` — one line: `Proposed` / `Proposed — targets <worker> only` / `Accepted` + later
   verification notes.
3. `## Context` — prose, **cites the pre-implementation audit in `docs/audits/`** by filename and
   commit; enumerates gaps as bullets; ends with a one-sentence `Goal:`.
4. `## Decision` (0004/0005) or `## Decisions` (0003) — **numbered, each starting with a bold
   sentence**, then justifying prose that references audit sections (`audit §N`). Deliberate
   deviations from convention are called out explicitly ("a documented, deliberate deviation … not a
   silent one").
5. `## Data model change` — often literally "**None.**" with justification (0003).
6. `## Alternatives considered` (0003) / `## Consequences` (0004) — bulleted, each "**Option.**
   Rejected — reason."
7. `## Prerequisites` / `## Non-goals for this pass` / `## Out of scope` — bulleted.
8. `## Open follow-ups (not this ADR)` — bulleted.

Tone: terse, decisive, cross-references audits and prior ADRs heavily, names exact files/bindings/
namespace IDs, and defers explicitly rather than silently. `CC:` prefixes call out things the
implementing agent must confirm at build time.

---

## 7. `CLAUDE.md` / `AGENTS.md`

### `operator-os`

- **No `AGENTS.md` file exists.** `operator-os/CLAUDE.md:3` states it outright: *"there's no separate
  `AGENTS.md` here, this is the one required read."*
- `CLAUDE.md` does **not** use an `@AGENTS.md` import directive (no `@`-import syntax anywhere in it).
  It is a full standalone operating manual (7 sections: what it is, deployment, paired frontend repo,
  secrets/D1, testing, known open items, "keeping this file honest").
- Directly relevant content already there: §1 names the capability set
  `{event, schedule, capacity, availability, whatsappChannel, opsNotifyEmail, opsNotifyPush}`; §6
  documents the ADR-0001 deferral as a **product decision, not a bug** — *"don't 'fix' this without
  checking `Sunny-ops/known-open-items.md` first."*

### `Sunny-ops`

- **`CLAUDE.md` and `AGENTS.md` both exist.** `CLAUDE.md` is a deliberate **prose pointer**, not an
  `@`-import: *"This is a pointer file, not a duplicate. Read `AGENTS.md` in full…"* It re-states one
  fact as a safety net (the two-wrangler-configs hazard). It does **not** contain the string
  `@AGENTS.md` — Claude Code's file-import mechanism is not used; the pointer is textual only.
- `AGENTS.md` (13 KB) is the real manual — not fully read in this pass; `CLAUDE.md:3` describes it as
  "business context, stack, the deployment-target table, the doc index, and 20+ sections of rules."

### `Sunny` / `Moses`

Not in scope; not inspected beyond confirming no ADR files (§6.2).

---

## 8. Durable Objects inventory

Declared in `wrangler.jsonc:137-158`, `deployments/*/api.staging.jsonc`, and exported from
`src/index.ts:15` (`export { ChatRoom, StaffChatHub } from "./chat-durable"`). Both are
`type: "durable-object", storage: "sqlite"`. **Owned by the API Worker only**; console configs carry
`state: "deleted"` tombstones (`deployments/focus-lab/console.staging.jsonc:20`).

| Class | Binding | Instancing | Purpose | State |
|---|---|---|---|---|
| `ChatRoom` | `CHAT_ROOMS` | one per conversation **(inferred** from `getByName`/id-per-conversation usage; `chat-durable.ts:11-16`) | WebSocket chat room. `/connect` (customer or responder socket, `serializeAttachment`), `/message` POST → `persist()`. Assigns monotonic `sequence`, writes `conversation_messages` + `conversation_activity` + updates `conversations` (via `this.env.DB` batch — **D1, not DO SQLite storage**), broadcasts to sockets, notifies `StaffChatHub`, fires WhatsApp reply or customer-continuity email. | Uses `this.ctx.acceptWebSocket` / `getWebSockets` / `deserializeAttachment` for hibernatable socket state. **No `ctx.storage` use, no alarms.** |
| `StaffChatHub` | `CHAT_STAFF_HUB` | **singleton** — `getByName("staff-events")` (`chat-durable.ts:21`) | Staff fan-out hub. `/connect` (per-responder socket), `/event` POST → `deliver()`: routes an event to assigned or all-available responders' sockets, then `ctx.waitUntil(dispatchPushEvent)` + `ctx.waitUntil(dispatchOpsNotificationEmail)`. | Sockets only. **No `ctx.storage`, no alarms.** |

`push_deliveries.event_id` is a notification-id string, unrelated to `events.id`.

### Fit assessment for per-tenant calendar/availability state

- **Neither existing DO is a natural host.** `ChatRoom` is conversation-scoped and chat-specific;
  `StaffChatHub` is a stateless socket router. Bolting calendar state onto either would break their
  single-responsibility shape and the "API Worker owns DOs, console doesn't" model would drag
  calendar state into a place the console can't reach directly (it would have to go through the
  `CHAT_API` service binding).
- **The current availability design deliberately avoids a DO**: KV read-cache (`availability:v1`) +
  cron writer. That is correct for a *read-mostly, eventually-consistent, derived* signal and should
  stay for public "is this date open" checks.
- **A booking system with write-side invariants** (no double-booking, capacity limits, holds/locks,
  atomic "reserve then confirm") is the textbook case for a **new** Durable Object — one instance per
  tenant (or per tenant+resource), `getByName(<tenant-key>)`, using `ctx.storage` (SQLite) for the
  reservation ledger and `ctx.storage.setAlarm` for hold-expiry and reminder scheduling. This matches
  the `durable-objects` skill's stated "booking systems" use case and would be the **first** alarm
  user in the codebase.
- Because isolation here is **deployment-time, not runtime** (`docs/deployment-model.md:1-3`; no
  tenant ID in code), a per-tenant booking DO needs no tenant partitioning logic — each tenant's API
  Worker has its own DO namespace already. A stable name like `"calendar"` or `"bookings"` per
  deployment is sufficient.
- New DO classes must be added to `durable_objects.bindings` **and** `exports` in **every**
  `deployments/<tenant>/api.staging.jsonc` + root `wrangler.jsonc`, and a migration/tombstone story
  handled for the console configs (mirror the existing `ChatRoom` treatment).

---

## Open Questions for the ADR

1. **Reservations DB vs. Durable Object vs. both.** Is booking state a new D1 table set
   (`bookings`, `booking_holds`, `availability_rules`, …) with app-level conflict checks, or a
   per-tenant Durable Object ledger with alarms, or D1 for the record of truth + a DO purely as the
   serialization point for "check-and-reserve"? This is the core architectural fork and everything
   else hangs off it. (Codebase bias: D1-for-truth, additive migrations; DOs used sparingly and only
   for coordination.)

2. **Capability-flag name and default.** New `BusinessCapabilities` flag —
   `scheduling`? `booking`? `appointments`? — and does it start `false` for **both** `focus` and
   `moses` (ship dormant, ADR-0004 style) or `true` for `focus` immediately? Does it subsume or sit
   beside the existing `schedule` (decision-support) and `availability` (public date-check) flags?

3. **Relationship to the existing `events` / `scheduling_state` / `blocks_capacity` machinery.**
   Does a confirmed booking *write* `events.scheduling_state='confirmed'` + `blocks_capacity=1`
   (making `assessScheduling` and `AVAILABILITY_CACHE` reflect it automatically), or is booking a
   parallel table that the availability cache must additionally consult? Note `refreshAvailabilityCache`
   currently only reads Google freebusy, never D1.

4. **What "availability" means per tenant.** `focus` = event dates (whole-day, capacity 1, from
   `CONCURRENT_EVENT_CAPACITY`). A future tenant may want time-slot / duration / working-hours /
   multi-resource booking. Does the ADR commit to a slot model now, or stay whole-day and defer
   slots to a follow-up (ADR-0003's "text-only for v1" precedent)?

5. **Google Calendar: read-only freebusy vs. read-write events.** The current integration is
   `calendar.readonly` + `freebusy.query` only (`src/google-calendar.ts:8,43`), and it's
   **unprovisioned/deferred** (ADR-0001). Does a booking system (a) stay read-only and treat Google
   as advisory, (b) write confirmed bookings back as Calendar events (needs a write scope, a
   different auth story, and reversal of ADR-0001's deferral), or (c) make Operator OS the calendar
   of record and not touch Google at all? Who owns the "source of truth" when both exist?

6. **Reminder scheduling mechanism.** Second cron expression in the existing `triggers.crons` array
   with a branch on `event.cron` in `scheduled()` (matches current precedent, coarse granularity),
   or DO alarms (precise, per-booking, new pattern, first alarm user)? Reminders also need an
   idempotency/"already sent" ledger — reuse `conversation_notifications` shape or a dedicated
   `booking_notifications` table?

7. **Confirmation/reminder email path.** New function in `src/ops-notify.ts`, new method on
   `CustomerNotificationEmailProvider` (`src/customer-email.ts`), or a new provider module? Customer
   emails currently only exist for chat continuity and require `CUSTOMER_EMAIL_FROM` +
   `RESEND_API_KEY` (provisioning unverified per ADR-0004 §6). Does a booking confirmation need a
   "manage/cancel my booking" resume-token link (extend `conversation_resume_tokens.purpose` enum,
   currently `CHECK IN ('email_continuity')`)?

8. **Public booking surface & its security.** Would `Sunny-ops` gain a real booking/slot-picker UI
   (beyond today's date-check + inquiry form), and would that be a new public endpoint
   (`POST /v1/bookings`?) added to the `operations/src/public-site.ts` proxy allow-list and gated by
   Turnstile + a rate-limiter namespace, mirroring `/v1/inquiries`? Every new public write path in
   this codebase gets Turnstile + `enforceInquiryProtection`-style handling.

9. **Staff RBAC for booking management.** There is currently **no** scheduling permission —
   `/v1/internal/schedule` needs only a valid identity. Does booking mutation
   (confirm / reschedule / cancel) introduce a `booking:manage` permission in `src/auth.ts`'s
   `Permission` union and role map, and at which roles?

10. **`availabilityChecked` — promote or drop.** It's captured write-only in `payload_json` today
    (§1.3). Does the booking work finally surface it (dedicated `intake_submissions` column? shown in
    `InquiryDetailView`? an `activities` row?), or is it explicitly abandoned as a dead field? It's
    the one existing artefact that a booking flow would plausibly want to read.

11. **Which ADR number and where.** Confirm this is **ADR-0006** in `operator-os/docs/adr/`, and
    whether the missing ADR-0001/ADR-0002 decision docs get back-filled or left as historical gaps
    referenced only by their implementation reports.
