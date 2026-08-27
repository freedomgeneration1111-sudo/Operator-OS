# ADR-0006 Pre-Implementation Verification Addendum

**Date:** 2026-08-27
**Companion to:** `docs/audits/2026-08-27-scheduling-integration-audit.md`
**Purpose:** Answers the `CC:` verification items in the rescoped **ADR-0006: Manual Booking Intake &
Availability Display (Phase 1)** — the "verify before building" gates in Decisions 4 and 5, plus
implementation notes for Decisions 2 and 3 and the Prerequisites check.
**Method:** Read-only. Every claim anchored to `path:line`. Repos as in the companion audit
(`operator-os` @ `main` with a dirty tree, `Sunny-ops` @ `feat/check-availability-google-calendar`).

---

## Summary of conclusions

| ADR item | Verified finding |
|---|---|
| **D4 — event-type field** | **Already wired end-to-end.** No gap. `eventType` is a required Zod field → `events.event_family` → surfaced in staff console. |
| **D4 — phone requiredness** | **Already optional** at UI *and* Zod layers. Required only in the explicit "prefer phone contact" branch. No gap. |
| **D4 — "Check Your Date captures name/email/phone/date/type"** | The `/check-availability` **page flow** already captures all of it (via the separate `CheckAvailabilityForm`). The **checker widget itself** captures only a date. Any change here is `Sunny-ops` UX, not a schema/contract change. |
| **D4 — real new column** | Only Decision 3's `availability_checked`. |
| **D5 — staff notified on new event inquiry** | **No. Nothing fires today.** Decision 5's addition is genuinely needed; it's a clean copy of the (uncommitted) consulting-inquiry notification. |
| **D2 — D1-backed availability** | Feasible; requires `handleAvailability` to query `events` and union blocking dates into `busy` before both the status decision and `nearby`. First time `/v1/availability` touches D1 — a deliberate reversal of the property stated in `API.md:8`. |
| **D3 — `availability_checked` column** | Clean additive `ALTER TABLE` (new column + CHECK is fine; no table rebuild). Touches 6 code sites listed below. |
| **Prerequisites — dirty tree** | Confirmed. Moses `publicConsultingInquiry` feature, uncommitted, no ADR. |
| **Numbering** | `ADR-0006` is correct (next free). |

---

## Decision 4 — intake field inventory

### 4.1 `src/contracts.ts` → `inquiryRequestSchema` (lines 8–43): exact field list

| Field | Rule | Required? |
|---|---|---|
| `eventType` | `requiredText(100)` — trimmed, 1–100 chars | **Required** |
| `date` | `isoDate` — `/^\d{4}-\d{2}-\d{2}$/` | **Required** |
| `endDate` | `isoDate.optional()` | Optional — `endDate ≥ date` (superRefine `:34`) |
| `startTime` | `isoTime.optional()` — `HH:MM` | Optional — **must pair with `endTime`** (`:40`) |
| `endTime` | `isoTime.optional()` | Optional — pairs with `startTime` |
| `location` | `optionalText(300)` | Optional |
| `services` | `z.array(requiredText(100)).max(20).default([])` | Optional — defaults `[]` |
| `guests` | `z.union([int 1–100000, /^\d{1,6}$/ → Number]).optional()` | Optional |
| `budget` | `optionalText(100)` | Optional |
| `name` | `requiredText(150)` | **Required** |
| `email` | `z.string().trim().email().max(254)` | **Required** |
| `phone` | `optionalText(40)` | **Optional** — required only if `contact === "phone"` (`:37`) |
| `contact` | `z.enum(["email","phone"])` | **Required** |
| `note` | `optionalText(4000)` | Optional |
| `source` | `optionalText(100)` | Optional |
| `referral` | `optionalText(300)` | Optional |
| `landingPage` | `optionalText(1000)` | Optional |
| `referrer` | `optionalText(1000)` | Optional |
| `utmSource` / `utmMedium` / `utmCampaign` / `utmTerm` / `utmContent` | `optionalText(200)` each | Optional |
| `availabilityChecked` | `z.boolean().optional()` | Optional |

- Schema is `.strict()` — unknown keys are rejected (this is why `availabilityChecked` needs its own
  line to survive validation, per companion audit §1.3).
- superRefine rules: `endDate ≥ date`; `contact === "phone"` ⇒ `phone` required; `startTime` and
  `endTime` must both be present or both absent.
- **Not part of the dirty working tree** — `git diff src/contracts.ts` only touches the
  `consultingInquirySchema` block lower in the file. This field list is what is live.

### 4.2 `components/sections/CheckAvailabilityForm.tsx` — `State` type + form fields

`State` (`:12`):
`{ eventType, date, location, services[], guests, budget, name, email, phone, contact, note, availabilityChecked }`

- **Step 1** (`:86–92`):
  - `eventType` — chip buttons; source list `eventTypes = ["Wedding","Asian Wedding",
    "Party / Celebration","Corporate / Community"]` (`:15`).
  - `date` — `<input required name="date" type="date">` (`:88`). Editing it resets
    `availabilityChecked` to `false` in the same handler.
  - `location` — "Venue or city", **not** `required`.
  - `services` — chips from `serviceOptions` (`:16`).
  - `guests` — "Estimated guest count", `type="number" min="1"`, **not** `required`.
  - `budget` — `<select>`, **not** `required`.
  - "Continue" button disabled unless `form.eventType && form.date` (`:91`).
- **Step 2** (`:93–104`):
  - `name` — `<input required name="name">`.
  - `email` — `<input required name="email" type="email">`.
  - `phone` — label literally **"Phone (optional)"**, `<input name="phone" type="tel">`, **no
    `required` attribute** (`:95`).
  - `contact` — "Preferred contact" `<select>`: `email` / `phone` (`:96`).
  - `note` — "Anything else we should know? (optional)", textarea.
  - `website` — visually-hidden honeypot (`:98`).
  - `TurnstileWidget` (`:99`).
- `availabilityChecked` — initialised from `params.get("availabilityChecked") === "true"` (`:30`),
  re-synced by a `useEffect` when arriving via a same-route query change (`:48–53`).

### 4.3 Is the event-type field wired end-to-end? — YES, already complete

| Leg | Evidence |
|---|---|
| Public form | `CheckAvailabilityForm.tsx` chip UI; "Continue" gated on `eventType` (`:91`) |
| Client type | `Sunny-ops/lib/operations-api.ts:2` — `InquirySubmission.eventType: string` |
| Transport | `submitInquiry` posts the whole `form` object as the JSON body of `POST /v1/inquiries` (`operations-api.ts:45`) |
| Validation | `src/contracts.ts:9` — `eventType: requiredText(100)` (required) |
| Adapter | `src/inquiry-adapters.ts:23` — `focusCommand` maps `eventFamily: input.eventType` |
| Persistence | `src/inquiry-service.ts:63–68` — `INSERT INTO events (… event_family …)` |
| Staff read | `src/repository.ts:38` selects `e.event_family`; rendered in `staff-app/src/views/InquiryDetailView.tsx:21` and `InboxView.tsx:19`; filterable via the inbox `eventFamily` query param (`src/staff-api.ts:47,64`) |

**→ Decision 4's event-type gap does not exist. No work required on this leg.** The audit it asked
for confirms the chain is intact.

### 4.4 Is phone already optional at the UI and Zod layers? — YES

- **Zod:** `src/contracts.ts:20` — `phone: optionalText(40)`. Becomes required only inside the
  `contact === "phone"` superRefine branch (`:37–39`). Correct behaviour: "I want to be called" ⇒
  a number is needed.
- **UI:** `CheckAvailabilityForm.tsx:95` — no `required` attribute; label says "(optional)".
  (`components/operations/NativeChatPanel.tsx` similarly treats phone as optional unless
  reply-by-text/call is selected.)
- **DB:** `contacts.phone` is nullable; table-level `CHECK (email IS NOT NULL OR phone IS NOT NULL)`
  (`migrations/0001_operations_foundation.sql:7`).

**→ Decision 4's phone-requiredness concern does not exist. No work required.**

### 4.5 Does the "Check Your Date" widget itself capture contact info?

**No.** `components/sections/AvailabilityChecker.tsx` renders only a single date `<input>` (`:46`) and
a "Check Availability" button. Name / email / phone / event-type are collected by the **separate**
`CheckAvailabilityForm` component rendered lower on the same route
(`app/check-availability/page.tsx:14`). The checker's result CTAs deep-link to `#inquiry-form` (that
form) with `date` and `availabilityChecked` prefilled (`AvailabilityChecker.tsx:16–18`).

So the **page-level flow** already captures everything ADR-0006's Context paragraph lists, and it
already lands in the inquiry pipeline (`POST /v1/inquiries` → `createFocusInquiry` →
contacts + events + inquiries + intake_submissions + activities rows).

One nuance worth an explicit ADR decision: `createInquiry` does **not** insert a `conversations` row
(`src/inquiry-service.ts` inserts contacts / events / inquiries / inquiry_services / intake_submissions
/ activities only). So an event inquiry has **no in-app reply channel** — the "Conversation" panel in
`InquiryDetailView.tsx:27` shows *"No provider conversation metadata exists for this inquiry"* until
the customer separately starts a chat. "Staff reply through the existing messaging pipeline" today
means staff reply **out of band** (email/phone), or wait for the customer to open chat.

If ADR-0006's intent is that the checker widget should collect contact fields **inline** (one
continuous step rather than "check date, then scroll to a 2-step form"), that is a `Sunny-ops`
front-end change with **no** `operator-os` schema or contract impact — `POST /v1/inquiries` already
accepts every field involved.

**→ The only genuinely new persisted field ADR-0006 introduces is Decision 3's `availability_checked`.**

---

## Decision 5 — staff notification on a new `focus` event inquiry

**Verified: no notification fires today for a new event inquiry.**

- `src/index.ts` → `publicInquiry(...)`, `kind === "event"` branch — **both the committed version and
  the dirty working tree**: `const result = await createFocusInquiry(env.DB, parsed.data, key, now);
  return json(result, …);`. No `ctx.waitUntil`, no dispatch call.
- The `kind === "consulting"` branch **does** fire
  `dispatchConsultingInquiryNotificationEmail(env, {inquiryId})` on `!result.idempotentReplay` — but
  that entire branch is **uncommitted working tree** (`git diff src/index.ts`, `git diff
  src/ops-notify.ts`).
- `dispatchOpsNotificationEmail` (`src/ops-notify.ts:11`) fires **only** from
  `StaffChatHub.deliver()` on inbound **customer chat messages** (`src/chat-durable.ts:37`), gated
  `senderKind === "customer"`. Since `createInquiry` opens no `conversations` row, submitting the
  date-check form produces no chat event and therefore no chat notification.

**→ Today, staff discover a new event inquiry only by polling the Inbox view
(`GET /v1/internal/inbox`).**

Decision 5's addition is therefore **needed**, and it is a near-verbatim copy of the consulting
pattern:

- New `ConsultingInquiryNotificationEvent`-style type + `dispatchEventInquiryNotificationEmail(env,
  {inquiryId}, fetcher?)` in `src/ops-notify.ts`.
- Query: `inquiries i JOIN contacts c JOIN events e ON e.id = i.event_id LEFT JOIN intake_submissions
  s ON s.inquiry_id = i.id … ORDER BY s.received_at DESC LIMIT 1` — pull name / email / phone /
  event_family / start_date / end_date / attribution.
- Guards, identical to the consulting function: `if (!profile.capabilities.opsNotifyEmail) return;`
  then `if (!RESEND_API_KEY || !CUSTOMER_EMAIL_FROM || !OPS_NOTIFY_EMAIL) { console.warn(...); return; }`.
- Deep link: `${STAFF_CONSOLE_ORIGIN}/#/inquiry/${inquiryId}`.
- Fired from the `kind === "event"` branch of `publicInquiry`, on `!result.idempotentReplay`, wrapped
  in `ctx.waitUntil(...).catch(log)`.

**Sequencing:** the consulting notification it mirrors is **not yet committed**. The event-inquiry
version should land in the same commit as, or after, that consulting work — not before (it would
otherwise import a function that only exists in a parallel uncommitted change).

---

## Decision 2 — D1-backed availability (implementation notes)

`resolveAvailability(cache, date, todayIso)` (`src/availability-api.ts:36`) is **pure** over
`AvailabilityCache | null` and takes no `D1Database`. To make an internally-blocked date read
`unavailable`:

1. `handleAvailability` (`:66`) must additionally query D1 for events overlapping the requested
   window. Reuse the exact predicate from `src/repository.ts:5` `listBlockingWindows`:
   `blocks_capacity = 1 AND scheduling_state NOT IN ('cancelled','declined') AND start_date IS NOT
   NULL AND COALESCE(end_date, start_date) >= ? AND start_date <= ?`. Expand each row's
   `start_date..end_date` span into individual ISO dates (`isoDatesBetween`,
   `src/availability-timezone.ts:45`).
2. Union that set into `busy` **before** the `available` / `unavailable` decision (`:39`) **and**
   before the `nearby` scan (`:42–49`), otherwise `nearby` could suggest an internally-booked date.
3. Signature change: either `resolveAvailability(cache, blockingDates, date, todayIso)` or pass a
   pre-merged `busyDates`. Keep the function pure — do the D1 read in the handler and hand it in.

Trade-off to record in the ADR: this puts a D1 read on the `/v1/availability` **request path** for
the first time. It is small and covered by `events_capacity_range_idx`
(`migrations/0001_operations_foundation.sql:24`), but it contradicts the current documented property
in `API.md:8` (*"cache-read only, never calls Google Calendar on the request path"* — the intent
being "no per-request backend work"). Update `API.md` and `openapi.yaml:31–57` in the same change.

`test/availability-api.test.ts` will need cases for "date is clear in KV but has a
`blocks_capacity=1` event" and "nearby skips an internally-blocked date".

---

## Decision 3 — `availability_checked` column (implementation notes)

Migration (additive — safe; a new column *with* a CHECK does not require a table rebuild, unlike
adding a CHECK to an existing column, which is what forced the `0006` rebuild):

```sql
-- migrations/0008_intake_availability_checked.sql   (0007 is the latest existing)
PRAGMA foreign_keys = ON;
ALTER TABLE intake_submissions
  ADD COLUMN availability_checked INTEGER CHECK (availability_checked IN (0,1));
```

Code sites to thread it through:

| # | File / line | Change |
|---|---|---|
| 1 | `src/inquiry-service.ts:28–35` (`commandSchema.intake`) | add `availabilityChecked: z.boolean().nullish()` (or similar) to the `intake` object |
| 2 | `src/inquiry-service.ts:87–94` (the `intake_submissions` INSERT) | add the column + bind param |
| 3 | `src/inquiry-adapters.ts:17–26` (`focusCommand`) | pass `input.availabilityChecked` into `intake` |
| 4 | `src/repository.ts:45–47` (`getInquiryDetail` intake `SELECT`) | add `availability_checked` to the column list |
| 5 | `staff-app/src/lib/types.ts:32` (`intakeSubmissions` shape) | add `availability_checked: number \| null` |
| 6 | `staff-app/src/views/InquiryDetailView.tsx` | render a small badge (there is no dedicated intake panel today — the intake rows are currently not displayed at all; adding a minimal one, or attaching the badge to the existing header `badge-row` at `:18`, is the lightest touch) |

Note for #6: `InquiryDetailView` currently does **not** render `detail.intakeSubmissions` anywhere —
the data is fetched by `getInquiryDetail` but unused in the view. The ADR should say whether it wants
a new "Intake" panel or just the single badge.

`payload_json` continues to carry the raw value too (it already does, via `payload:{...input}`); the
column is a promoted, queryable copy, not a replacement.

---

## Prerequisites check

### Dirty working tree (`operator-os` @ `main`)

```
 M CLAUDE.md
 M business-profiles.mts                         (+ publicConsultingInquiry flag)
 M deployments/moses-jorgensen/RESOURCE_PLAN.md
 M deployments/moses-jorgensen/api.staging.jsonc
 M secrets.d.ts
 M src/contracts.ts                              (consultingInquirySchema: +9 attribution fields)
 M src/index.ts                                  (publicInquiry → event|consulting split, consulting notify)
 M src/inquiry-adapters.ts                       (consulting acknowledgement copy, firstTouchCapturedAt)
 M src/inquiry-protection.ts
 M src/ops-notify.ts                             (+ dispatchConsultingInquiryNotificationEmail)
 M test/inquiry-protection.test.ts
 M test/ops-notify.test.ts
?? test/public-consulting-inquiry.test.ts
```

This is the **Moses `publicConsultingInquiry` feature** — implemented in source, no ADR written for
it, not committed. ADR-0006's Prerequisites correctly flags that this must be resolved (committed or
reverted) before the ADR-0006 migration lands, because ADR-0006 Decision 5 mirrors
`dispatchConsultingInquiryNotificationEmail`, which only exists in this uncommitted change.

### ADR numbering

`ADR-0006` is the next free number. Physical ADR files today: `ADR-0003`, `ADR-0004`, `ADR-0005` in
`docs/adr/` (ADR-0001 and ADR-0002 have no decision doc anywhere — see companion audit §6.2). No
`ADR-0006*` file exists yet.

---

## Items still for the ADR author to decide (not blockers, surfaced by this pass)

1. **In-app reply for event inquiries.** Event inquiries create no `conversations` row, so there is
   no in-system reply surface — "staff replies through the messaging pipeline" is currently out-of-band
   for this path. Does ADR-0006 leave that as-is (staff email/phone the customer directly), or does
   "manual booking intake" imply opening a `native_web` conversation on inquiry submission so staff
   can reply in-console (and get the existing `dispatchOpsNotificationEmail` for free)?
2. **`InquiryDetailView` intake rendering** — new panel vs. single badge (Decision 3 note #6).
3. **`API.md` / `openapi.yaml` property change** — Decision 2 makes `/v1/availability` read D1;
   the "never touches the backend on the request path" wording must be updated, not just left stale.
4. **Checker-widget inline capture** — is the `Sunny-ops` UX change (contact fields inside the
   "Check Your Date" card) in scope for this ADR or a separate front-end task? No `operator-os` impact
   either way.
