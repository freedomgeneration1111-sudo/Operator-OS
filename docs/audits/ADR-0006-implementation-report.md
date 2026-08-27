# ADR-0006 Implementation Report — Prerequisites Resolution & Doc Landing

Covers the commit pass for `docs/adr/ADR-0006-manual-booking-intake-and-availability-display.md`.
This pass **resolved the ADR's Prerequisites and committed the planning artifacts** — it did **not**
implement ADR-0006's Decisions 2, 3, or 5 (the availability-resolver D1 read, the
`availability_checked` column, the event-inquiry notification). Those remain to be built; see
"Not done in this pass" below.

Worked the three ordered steps from the implementation prompt, verifying each before the next.
Every claim below is backed by command output captured during the pass.

## Commits produced

| Step | Commit | Subject |
|---|---|---|
| A | `69ad652b995fd2c2145cccfe3adfaed208845d47` | `feat: public consulting-inquiry intake path for moses` |
| B | `9c98fb1549cfd95c2530eb69e6af7fb7c1fecab1` | `docs: add scheduling-integration audit and ADR-0006 verification addendum` |
| C | `73d9490a3405f70dd728429653ee8d1062ec0072` | `docs: add ADR-0006 — manual booking intake & availability display (phase 1)` |

Branch: `main`. Base before this pass: `9bbf740` (`chore: reconcile repo with moses's live
PUBLIC_SITE_ORIGIN config`). Working tree is clean after step C.

---

## Step A — Resolve the dirty tree

### Full test suite against the working tree (before committing)

| Command | Result |
|---|---|
| `npm run test:operations` | **19 files / 150 tests passed**, 0 failed (40.8s) |
| `npm run test:config-isolation` | **3 / 3 passed**, 0 failed |
| `npm run typecheck` | clean (`tsc -p tsconfig.json --noEmit`) |
| `npm run lint` | clean (`eslint src test business-profiles.mts scripts`) |
| `npm run staff:typecheck` | clean |
| `npm run staff:lint` | clean |
| `npm run staff:test` | **6 files / 32 tests passed**, 0 failed (6.8s) |

**The known pre-existing failure the prompt anticipated in
`staff-app/src/lib/business-profile.test.ts` did not occur — that test passes.** Its assertions
(`profile.capabilities` deep-equals for `focus` and `moses`) match the current working-tree
`business-profiles.mts` capability objects, including `availability: true` for `focus`. The
`known-open-items.md` / `CLAUDE.md:64` caveat about that test being red is stale; current state is
green.

**No other failure.** The stop condition ("any OTHER failure") was not hit, so the pass proceeded
to commit.

**Not run:** `npm run test:staff:e2e` (Playwright). It brings up three Vite dev servers
(ports 5173/5174/5175) plus Chromium, and `staff-app/e2e/production-auth.spec.ts` exercises real
Cloudflare Access. The step-A change is backend-only (no `staff-app/` source touched), and the
prompt's known-failure reference was a unit test in the green `staff:test` suite. Flagged here
rather than risking a spurious environment block.

### The commit (`69ad652`)

Thirteen files — the twelve modified + the untracked `test/public-consulting-inquiry.test.ts` —
committed together as the `publicConsultingInquiry` feature. Content, from the staged diff:

**Public consulting-inquiry intake (moses):**
- `business-profiles.mts` — new `publicConsultingInquiry` field on `BusinessProfile`
  (`false` for `focus`, `true` for `moses`).
- `src/index.ts` — `publicInquiry()` reworked to take `kind: "event" | "consulting"`; a second
  `POST /v1/inquiries` route registration gated on `profile.publicConsultingInquiry`; on a
  non-replay consulting inquiry it fires `dispatchConsultingInquiryNotificationEmail` via
  `ctx.waitUntil(...).catch(log)`.
- `src/contracts.ts` — `consultingInquirySchema` gains nine provenance fields
  (`firstTouchCapturedAt`, `currentPage`, `currentUtmSource/Medium/Campaign/Term/Content`,
  `pageType`, `contentSlug`).
- `src/inquiry-adapters.ts` — `consultingCommand` uses `input.firstTouchCapturedAt ?? now` for
  intake `capturedAt`; consulting acknowledgement copy reworded to the first-person consulting
  voice.
- `src/ops-notify.ts` — new `dispatchConsultingInquiryNotificationEmail(env, {inquiryId})`,
  mirroring `dispatchOpsNotificationEmail`: gated on `capabilities.opsNotifyEmail`, skips (warn, no
  throw) if `RESEND_API_KEY` / `CUSTOMER_EMAIL_FROM` / `OPS_NOTIFY_EMAIL` missing, joins
  `inquiries → contacts → consulting_details → intake_submissions`, deep-links to
  `${STAFF_CONSOLE_ORIGIN}/#/inquiry/{id}`.
- `test/public-consulting-inquiry.test.ts` (new, 74 lines), `test/ops-notify.test.ts`
  (+consulting-notification case).

**Turnstile hostname hardening** (surfaced by the moses review-domain surface):
- `src/inquiry-protection.ts` — reads `TURNSTILE_EXPECTED_HOSTNAMES` (comma list) with
  `TURNSTILE_EXPECTED_HOSTNAME` as fallback; **fails closed** when neither is configured or the
  verified hostname isn't in the allowlist; tightens the action check to require exactly
  `inquiry_submit` (previously only checked when `result.action` was truthy).
- `secrets.d.ts` — `TURNSTILE_EXPECTED_HOSTNAMES` declared on `Env` and `Cloudflare.Env`.
- `deployments/moses-jorgensen/api.staging.jsonc` — `TURNSTILE_SECRET_KEY` added to
  `secrets.required`; `TURNSTILE_EXPECTED_HOSTNAMES` var; `moses-site-review.…workers.dev` added to
  `PUBLIC_SITE_ORIGIN`.
- `test/inquiry-protection.test.ts` — allowlist-match case, missing-action rejection case,
  fail-closed-when-unconfigured case.

**Doc reconciliation:**
- `CLAUDE.md` — `moses` profile/deployment rows rewritten to current live state (native chat live;
  consulting route in source pending the Moses Turnstile secret; Moses public site now its own repo
  at `~/projects/Moses`); D1 note updated (`moses-operator-crm-staging` is live and isolated, not
  "unused").
- `deployments/moses-jorgensen/RESOURCE_PLAN.md` — retitled "deployment record", status refreshed
  to 2026-08-25, rate-limit namespace `22005` added, consulting-inquiry status noted.

---

## Step B — Commit the two audit docs (`9c98fb1`)

`docs/audits/2026-08-27-scheduling-integration-audit.md` and
`docs/audits/2026-08-27-adr-0006-verification-addendum.md` were untracked (written earlier in the
same body of work, not committed at the time). Committed together as one docs-only commit,
945 insertions.

---

## Step C — ADR file (`73d9490`)

`docs/adr/ADR-0006-manual-booking-intake-and-availability-display.md` was untracked. Verified
against the canonical text:

```
sha256 before re-write:  594a6314de67e43494996fa91af3bcf64323ad5e93e95116ac58f106eae9e2bb
sha256 after  re-write:  594a6314de67e43494996fa91af3bcf64323ad5e93e95116ac58f106eae9e2bb
```

Overwriting the file with the canonical text produced an **identical hash** — the on-disk content
already matched the canonical text exactly, with no rewording, condensing, or alteration.
Committed **as-is under its existing filename**; not renamed, no second file created. 197 lines.

---

## Definition of done

- [x] `publicConsultingInquiry` changes committed — `69ad652` (no new test failure; the one
      anticipated known failure did not occur; step not halted).
- [x] Both audit docs committed — `9c98fb1`.
- [x] ADR file committed, content verified byte-identical to canonical — `73d9490`.
- [x] This report written to `docs/audits/ADR-0006-implementation-report.md`.

Working tree clean (`git status --short` empty) after the pass.

---

## Not done in this pass (ADR-0006 implementation proper)

ADR-0006's code decisions are **not** implemented here. Still open:

- **Decision 2** — `handleAvailability` (`src/availability-api.ts:66`) reading D1 blocking events
  into `busy` before the status decision and `nearby` scan; `API.md:8` + `openapi.yaml:31–57`
  doc update; new `test/availability-api.test.ts` cases.
- **Decision 3** — `migrations/0008_intake_availability_checked.sql` +
  `intake_submissions.availability_checked` threaded through `commandSchema.intake`, the INSERT,
  `focusCommand`, `getInquiryDetail`, `staff-app/src/lib/types.ts`, and the `InquiryDetailView`
  header badge.
- **Decision 5** — `dispatchEventInquiryNotificationEmail` in `src/ops-notify.ts`, fired from the
  `kind === "event"` branch of `publicInquiry` (now unblocked — the consulting notification it
  mirrors is committed as of `69ad652`).

Decisions 1, 4, and 6 require no code (they are "do nothing / already done / rejected").

---

# Addendum — Decision 3 implemented (2026-08-27)

Second pass. **ADR-0006 Decision 3 is now implemented and pushed.** Decisions 2 and 5 remain
open (see updated status at the bottom).

## Commit

| Commit | Subject | On `origin/main` |
|---|---|---|
| `8152c5ea579aab14d92bb4945456ecf05131401f` | `feat: promote availabilityChecked to a queryable intake_submissions column (ADR-0006 Decision 3)` | yes — pushed `6dd0875..8152c5e` |

Base: `6dd0875` (the previous pass's last commit, already on `origin/main` before this pass).
7 files changed, 25 insertions(+), 10 deletions(-).

## Migration

`migrations/0008_intake_availability_checked.sql` — created and **applied to local D1**
(`focus-lab-operations-local`, `wrangler d1 migrations apply … --local`):

```sql
PRAGMA foreign_keys = ON;

ALTER TABLE intake_submissions
  ADD COLUMN availability_checked INTEGER CHECK (availability_checked IN (0,1));
```

Verified post-apply via `pragma_table_info`: column `availability_checked`, type `INTEGER`,
`notnull = 0`, `dflt_value = null` — nullable, no default, exactly as the ADR's Data model change
section specifies. Existing rows are `NULL`. A new column carrying its own `CHECK` is a plain
additive `ALTER TABLE` (no `0006`-style table rebuild). The test harness
(`readD1Migrations("migrations")` in `vitest.config.mts` → `test/setup.ts`) picks it up
automatically.

## The six code sites (per ADR Decision 3)

| # | Site | Change |
|---|---|---|
| 1 | `commandSchema.intake` — `src/inquiry-service.ts` | added `availabilityChecked: z.boolean().nullish()` to the `intake` object (the inner `z.object` strips unknown keys, so it had to be declared to survive parsing) |
| 2 | `intake_submissions` INSERT — `src/inquiry-service.ts` | column + bind added (17 → 18 cols / placeholders); value = `command.intake.availabilityChecked == null ? null : command.intake.availabilityChecked ? 1 : 0`; `payload_json` unchanged (still carries the raw value) |
| 3 | `focusCommand` — `src/inquiry-adapters.ts` | `intake` object now passes `availabilityChecked: input.availabilityChecked`. `consultingCommand` intentionally untouched — consulting inquiries have no availability check, so the field is absent → persisted `NULL` |
| 4 | `getInquiryDetail` SELECT — `src/repository.ts` | `availability_checked` added to the `intake_submissions` column list |
| 5 | `intakeSubmissions` type — `staff-app/src/lib/types.ts` | row shape gains `availability_checked: number \| null` |
| 6 | `InquiryDetailView.tsx` | `const availabilityChecked = detail.intakeSubmissions[0]?.availability_checked === 1` (latest submission, list is `received_at DESC`); renders `<span className="badge neutral">Availability checked</span>` on the **existing header badge-row** (line 18) only when true. No new panel. Reused the existing `badge neutral` class — no `styles.css` change, so the change stays within the six sites the ADR names. |

## Test suite — full run, zero failures

| Suite | Result |
|---|---|
| `npm run test:operations` | **151 passed** / 19 files (was 150; +1 new test) |
| `npm run test:config-isolation` | **3 / 3 passed** |
| `npm run staff:test` | **32 / 32 passed** |
| `npm run test:staff:e2e` (Playwright) | **21 passed, 2 skipped, 0 failed** — run this pass; the change touches `InquiryDetailView.tsx`, whose e2e mocks supply `intakeSubmissions: []` (badge correctly absent) |
| `npm run typecheck` / `staff:typecheck` | clean |
| `npm run lint` / `staff:lint` | clean |

### Two test edits, both required companions to the migration

1. **`test/api.test.ts:103`** — `expect(… COUNT(*) … FROM d1_migrations …).toBe(7)` → `toBe(8)`.
   This assertion is a "did every migration apply" fixture; it hard-codes the migration count and
   must be bumped whenever a migration file is added (the same way
   `test/migration-business-neutral.test.ts` uses `slice(0,5)` / `[5]` indices). Adding `0008` made
   the applied count 8. This surfaced as the **one** initial failure in `test:operations` and was
   fixed in place — a mechanical fixture bump caused solely by the new migration, not a masked
   regression, so it did not warrant halting the step.
2. **`test/api.test.ts`** — new test `"promotes availabilityChecked onto
   intake_submissions.availability_checked, defaulting to NULL"`: posts `{...validInquiry,
   availabilityChecked: true}` → asserts the column is `1`; posts `validInquiry` (field absent) →
   asserts the column is `NULL`. Covers the round trip end to end (`POST /v1/inquiries` →
   `focusCommand` → `commandSchema` → INSERT → D1).

## Definition of done

- [x] Migration `0008` created and applied locally (verified: column present, `INTEGER`, nullable,
      no default).
- [x] All six code sites updated (table above).
- [x] Full test suite passes with zero failures (`test:operations` 151, `config-isolation` 3,
      `staff:test` 32, `staff:e2e` 21/2-skip, typecheck + lint clean).
- [x] Committed — `8152c5e`.
- [x] Pushed to `origin/main` — `6dd0875..8152c5e`.
- [x] This addendum appended to `docs/audits/ADR-0006-implementation-report.md` with the commit
      hash.

## Updated ADR-0006 status

| Decision | Status |
|---|---|
| 1, 4, 6 | No code required (do nothing / already done / rejected) |
| **3** | **Done** — `8152c5e` |
| 2 | Open — `handleAvailability` D1 read + `API.md`/`openapi.yaml` update + `test/availability-api.test.ts` cases |
| 5 | Open — `dispatchEventInquiryNotificationEmail` in `src/ops-notify.ts`, fired from the `kind === "event"` branch of `publicInquiry` (unblocked; mirrors the consulting notification in `69ad652`) |

---

# Addendum — Decision 5 implemented (2026-08-27)

Third pass. **ADR-0006 Decision 5 is now implemented and pushed.** Only Decision 2 remains open.

## Precondition check

`dispatchConsultingInquiryNotificationEmail` confirmed present in `src/ops-notify.ts` at `HEAD`
(`ddd3e34`, `git show HEAD:src/ops-notify.ts`) before starting — the required base for a
near-verbatim copy.

## Commit

| Commit | Subject | On `origin/main` |
|---|---|---|
| `2210bb6189979e4530eea7c2520d88d1fbf0db86` | `feat: notify staff on new event inquiries (ADR-0006 Decision 5)` | yes — pushed `ddd3e34..2210bb6` |

3 files changed, 99 insertions(+), 2 deletions(-).

## The function — mirrors the consulting pattern

`dispatchEventInquiryNotificationEmail(env, {inquiryId}, fetcher = fetch)` in `src/ops-notify.ts`,
placed directly after `dispatchConsultingInquiryNotificationEmail`. Point-by-point parity:

| Aspect | `dispatchConsultingInquiryNotificationEmail` | `dispatchEventInquiryNotificationEmail` |
|---|---|---|
| Capability guard | `if (!profile.capabilities.opsNotifyEmail) return;` | identical |
| Secret guard | `if (!RESEND_API_KEY \|\| !CUSTOMER_EMAIL_FROM \|\| !OPS_NOTIFY_EMAIL) { console.warn(…); return; }` (never throws) | identical (warn message keyed `"event inquiry notification skipped: not configured"`) |
| Query | `FROM inquiries i JOIN contacts c JOIN consulting_details cd LEFT JOIN intake_submissions s ON s.inquiry_id=i.id WHERE i.id=? ORDER BY s.received_at DESC LIMIT 1` | same shape, `JOIN events e ON e.id=i.event_id` in place of `consulting_details`; pulls `full_name, email, phone, event_family, start_date, end_date, venue_location` + `source_channel` + `landing_page/utm_*` from `s` |
| `if (!row) return;` | yes | yes |
| Deep link | `${STAFF_CONSOLE_ORIGIN.replace(/\/$/,"")}/#/inquiry/${encodeURIComponent(inquiryId)}` (null when origin unset) | identical |
| Attribution block | `Source / Landing page / UTM source / UTM medium / UTM campaign`, `.filter(Boolean).join("\n")` | identical |
| Resend call | `POST https://api.resend.com/emails`, `Bearer ${RESEND_API_KEY}`, `{ from: CUSTOMER_EMAIL_FROM, to: [OPS_NOTIFY_EMAIL], subject, text }` | identical |
| Failure | `if (!response.ok) throw new Error("Resend rejected the … notification (${status})")` | identical (message: `"… event inquiry notification …"`) |

Body text: `New event inquiry from {name}` + `Event type` / `Dates` (single date, or `{start} to {end}`
for a range) / `Venue/location` / `Email` / `Phone` / attribution / deep link.

## Wiring — identical to the consulting branch

`src/index.ts`, `publicInquiry`, `kind === "event"` branch:

```ts
const result = await createFocusInquiry(env.DB, parsed.data, key, now);
if (!result.idempotentReplay) {
  ctx.waitUntil(dispatchEventInquiryNotificationEmail(env, { inquiryId: result.inquiryId }).catch((error: unknown) => {
    console.error(JSON.stringify({ message: "event inquiry notification failed", inquiryId: result.inquiryId, error: error instanceof Error ? error.message : "Unknown error" }));
  }));
}
return json(result, result.idempotentReplay ? 200 : 201);
```

Fires once per non-replay event inquiry, off the response path, failure logged not surfaced — the
same `ctx.waitUntil(...).catch(console.error)` shape the consulting branch uses. Import updated:
`import { dispatchConsultingInquiryNotificationEmail, dispatchEventInquiryNotificationEmail } from "./ops-notify";`

## Tests

`test/ops-notify.test.ts` — new `describe("event inquiry notification email")`:

1. **config-absent** — `dispatchEventInquiryNotificationEmail(env, …)` with no Resend config
   resolves `undefined` and never calls `fetch` (mirrors the equivalent `dispatchOpsNotificationEmail`
   case).
2. **full send** — seeds `contacts` + `events` (Wedding, `2027-06-10`..`2027-06-12`, Dallas TX) +
   `inquiries` + `intake_submissions` (with `utm_campaign`), then asserts the Resend body: `from`/`to`,
   subject `New event inquiry from Event Lead`, `Event type: Wedding`, `Dates: 2027-06-10 to
   2027-06-12`, `Venue/location: Dallas, TX`, phone `555-0142`, `UTM campaign: summer-weddings`,
   deep link `https://staff.example.test/#/inquiry/inq_event_notice`.

## Test suite — full run, zero failures

| Suite | Result |
|---|---|
| `npm run test:operations` | **153 passed** / 19 files (was 151; +2 new tests) |
| `npm run test:config-isolation` | **3 / 3 passed** |
| `npm run staff:test` | **32 / 32 passed** |
| `npm run test:staff:e2e` | **21 passed, 2 skipped, 0 failed** |
| `npm run typecheck` / `staff:typecheck` | clean |
| `npm run lint` / `staff:lint` | clean |

**No companion-fixture exception used.** The notification writes nothing to D1, and in the test
environment (no `RESEND_API_KEY` / `CUSTOMER_EMAIL_FROM` / `OPS_NOTIFY_EMAIL` in
`vitest.config.mts`) it hits the secret guard and returns before any `fetch` — exactly as the
consulting notification, wired the same way since `69ad652`, already does. No existing count/list
assertion is affected.

## Definition of done

- [x] Function added, mirrors the consulting pattern (guard-for-guard, join shape, deep link — table
      above).
- [x] Wired into the `kind === "event"` branch on `!result.idempotentReplay`, `ctx.waitUntil(...).catch(log)`.
- [x] Full test suite passes with zero failures (no companion-fixture exception needed).
- [x] Committed — `2210bb6`.
- [x] Pushed to `origin/main` — `ddd3e34..2210bb6`.
- [x] This addendum appended with the commit hash.

## Updated ADR-0006 status

| Decision | Status |
|---|---|
| 1, 4, 6 | No code required |
| **3** | **Done** — `8152c5e` |
| **5** | **Done** — `2210bb6` |
| 2 | Open — `handleAvailability` D1 read + `API.md`/`openapi.yaml` update + `test/availability-api.test.ts` cases |

---

# Addendum — Decision 2 implemented (2026-08-27)

Fourth pass. **ADR-0006 Decision 2 is now implemented and pushed. All three code decisions are
complete.**

## Precondition check

Decisions 3 (`8152c5e`) and 5 (`2210bb6`) both confirmed as ancestors of `HEAD`
(`git merge-base --is-ancestor`) before starting — migration `0008` present, and
`dispatchEventInquiryNotificationEmail` present in `src/ops-notify.ts`.

## Commit

| Commit | Subject | On `origin/main` |
|---|---|---|
| `d36bdc7500138a4fcc9285a545006a94421ee939` | `feat: availability check also reads D1 capacity-blocking events (ADR-0006 Decision 2)` | yes — pushed `fa74515..d36bdc7` |

4 files changed, 63 insertions(+), 9 deletions(-) — `src/availability-api.ts`,
`test/availability-api.test.ts`, `API.md`, `openapi.yaml`, all in the one commit as the prompt
required.

## Code — `src/availability-api.ts`

- **`resolveAvailability` stays pure.** New 4th parameter
  `blockedDates: ReadonlySet<string> = new Set()` — no `D1Database`, no `env`, no `async`. The set
  is unioned into `busy` on the line immediately after `const busy = new Set(cache.busyDates)`, i.e.
  **before** the `busy.has(date)` status decision **and** before the nearby loop (which reads the
  same `busy` via `busy.has(candidate)`). Default empty set means the six existing 3-argument
  `resolveAvailability` unit tests are unaffected.
- **`blockedDatesFromWindows(windows)`** — new pure helper. Expands each `SchedulingWindow`'s
  `startDate..(endDate ?? startDate)` span to individual ISO dates via the existing `isoDatesBetween`
  helper (`src/availability-timezone.ts`), skipping windows with no `startDate`.
- **`handleAvailability` does the D1 read.** `AvailabilityApiEnv` gains optional `DB?: D1Database`.
  The handler calls `listBlockingWindows(env.DB, fresh.windowStart, fresh.windowEnd)` (the existing
  predicate in `src/repository.ts` — `blocks_capacity=1 AND scheduling_state NOT IN
  ('cancelled','declined')`, overlapping the window; indexed by `events_capacity_range_idx`), passes
  it through `blockedDatesFromWindows`, and hands the result to `resolveAvailability`. Guarded:
  the read only happens when `fresh && env.DB && requested date is within [windowStart, windowEnd]`
  — otherwise `resolveAvailability` short-circuits to `"unknown"` and the blocked set is
  irrelevant, so no D1 query is issued.
- Both doc comments (`resolveAvailability`, `handleAvailability`) updated; `handleAvailability` no
  longer claims "cache-read only".

## Docs — same commit

- **`API.md`** — the `/v1/availability` row no longer says "cache-read only"; it now says
  "resolves from the KV busy-date cache unioned with capacity-blocking `events` read from D1 on the
  request path". The availability paragraph (§ after deployment selection) rewritten: the handler
  reads KV **and**, when fresh + in-window, reads D1 for capacity-blocking events, unions their
  whole spans into the busy set before the decision and the nearby scan, this D1 read is the only
  backend touch on the request path and returns no event data, and if KV is missing/stale no D1
  read happens.
- **`openapi.yaml`** — `/v1/availability` `summary` and the `200` `description` updated to name the
  KV+D1 merge and to keep the "never Google, never raw event data" guarantee explicit.

## Tests — the two the ADR specifies

`test/availability-api.test.ts`, `describe("handleAvailability")`:

1. **"resolves unavailable for a date that is clear in KV but has a capacity-blocking event in
   D1"** — seeds an `events` row (`blocks_capacity=1`, `scheduling_state='confirmed'`,
   `2026-09-15`), a date **not** in `cache.busyDates`; asserts `status === "unavailable"`.
2. **"never suggests an internally-blocked date as a nearby alternative"** — busy KV date
   `2026-09-10`, seeds a blocking `events` row for `2026-09-11` (which the cache-only nearby scan
   would otherwise offer first); asserts `nearby` excludes `2026-09-11` and equals
   `["2026-09-09","2026-09-12","2026-09-08"]`.

## Test suite — full run, zero failures

| Suite | Result |
|---|---|
| `npm run test:operations` | **155 passed** / 19 files (was 153; +2) |
| `npm run test:config-isolation` | **3 / 3 passed** |
| `npm run staff:test` | **32 / 32 passed** |
| `npm run test:staff:e2e` | **21 passed, 2 skipped, 0 failed** |
| `npm run typecheck` / `staff:typecheck` | clean |
| `npm run lint` / `staff:lint` | clean |

**No companion-fixture exception used.** The existing `handleAvailability` tests run against an
empty `events` table (`test/setup.ts` clears it each `beforeEach`), so `listBlockingWindows`
returns `[]` and behavior there is byte-identical. No count/list assertion is affected.

## Definition of done

- [x] `handleAvailability` queries D1; `resolveAvailability` stays pure (param is
      `ReadonlySet<string>`, no `D1Database` dependency).
- [x] `busy` unions D1-blocked dates before both the status decision and the nearby scan.
- [x] `API.md` and `openapi.yaml` updated in the same commit as the code (`d36bdc7`).
- [x] Both new test cases added and passing.
- [x] Full test suite passes with zero failures.
- [x] Committed — `d36bdc7`.
- [x] Pushed to `origin/main` — `fa74515..d36bdc7`.
- [x] This addendum written; status table below updated to show Decision 2 done.

## Updated ADR-0006 status

| Decision | Status |
|---|---|
| 1, 4, 6 | No code required (do nothing / already done / rejected) |
| **2** | **Done** — `d36bdc7` |
| **3** | **Done** — `8152c5e` |
| **5** | **Done** — `2210bb6` |

**ADR-0006 is fully implemented.**

---

# Final record — ADR-0006 end to end

Four passes, one branch (`main`), pushed to `origin/main`. Base before any of this work: `9bbf740`.

## All commits, in order

| # | Commit | Type | Summary |
|---|---|---|---|
| 1 | `69ad652` | feat | **Prerequisites.** `publicConsultingInquiry` feature committed off the dirty working tree (moses public consulting-inquiry intake + `dispatchConsultingInquiryNotificationEmail` + Turnstile `TURNSTILE_EXPECTED_HOSTNAMES` hardening + doc reconciliation). Unblocks Decision 5. |
| 2 | `9c98fb1` | docs | The two backing audits: `2026-08-27-scheduling-integration-audit.md` and `2026-08-27-adr-0006-verification-addendum.md`. |
| 3 | `73d9490` | docs | **ADR-0006 itself** — `docs/adr/ADR-0006-manual-booking-intake-and-availability-display.md`, verified byte-identical to the canonical text. |
| 4 | `6dd0875` | docs | This implementation report (prerequisites-resolution pass). |
| 5 | `8152c5e` | feat | **Decision 3.** `migrations/0008_intake_availability_checked.sql` + `availability_checked` threaded through all six code sites (`commandSchema.intake`, the `intake_submissions` INSERT, `focusCommand`, `getInquiryDetail`, staff-app `intakeSubmissions` type, `InquiryDetailView` header badge). Companion fixture: `test/api.test.ts` `d1_migrations` count `7 → 8`. |
| 6 | `ddd3e34` | docs | Report addendum for Decision 3. |
| 7 | `2210bb6` | feat | **Decision 5.** `dispatchEventInquiryNotificationEmail` in `src/ops-notify.ts` (guard-for-guard copy of the consulting notification), fired from the `kind === "event"` branch of `publicInquiry` on `!result.idempotentReplay`. |
| 8 | `fa74515` | docs | Report addendum for Decision 5. |
| 9 | `d36bdc7` | feat | **Decision 2.** `handleAvailability` reads D1 capacity-blocking events and unions them into the busy set before the decision and the nearby scan; `resolveAvailability` stays pure; `API.md` + `openapi.yaml` updated in the same commit. |
| 10 | _(this commit)_ | docs | Report addendum for Decision 2 plus this end-to-end final record. |

## What ADR-0006 changed, in the codebase

- **New migration:** `0008` — `intake_submissions.availability_checked INTEGER CHECK (… IN (0,1))`,
  nullable, no default.
- **New public-path behavior:** `GET /v1/availability` now reads D1 (`events`, capacity-blocking,
  in-window) in addition to the KV cache — the first backend touch on that path. Documented in
  `API.md` and `openapi.yaml`.
- **New staff notification:** `dispatchEventInquiryNotificationEmail` — staff get an email on every
  new (non-replay) `focus` event inquiry, matching the consulting path. Capability- and
  secret-guarded; no-ops when unconfigured.
- **New staff-console signal:** an "Availability checked" badge on the inquiry-detail header when
  the customer had confirmed the date was open before submitting.
- **No new tables, no new endpoints, no new permissions, no reminder cron, no confirmation
  automation** — Decision 1's "do nothing" scope held. The automated-confirmation design remains in
  the ADR's Deferred appendix as a candidate future ADR-0007.

## Not part of ADR-0006 (tracked elsewhere)

- The `publicConsultingInquiry` feature (commit `69ad652`) was pre-existing uncommitted work that
  Decision 5 depended on; it has no ADR of its own.
- `Sunny-ops` front-end change to collapse the two-step "Check Your Date" flow into one continuous
  step (ADR-0006 Decision 4 note / Open follow-ups) — no `operator-os` impact, not done here.
- Staff PWA calendar view; reversing ADR-0001's Google Calendar deferral — Open follow-ups, not
  done here.

## Verification at close

Full suite green on `d36bdc7`: `test:operations` 155, `test:config-isolation` 3, `staff:test` 32,
`test:staff:e2e` 21 passed / 2 skipped, `typecheck` + `staff:typecheck` + `lint` + `staff:lint`
clean. Working tree clean; `main` in sync with `origin/main`.

---

# Addendum — Decision 2 freshness-gating bug fixed (2026-08-27)

Fifth pass. A logic bug in Decision 2's first implementation (`d36bdc7`) was found and fixed
before deploy.

## Commit

| Commit | Subject | On `origin/main` |
|---|---|---|
| `28dd37f2dc95f7c2332fb9d9f86cc4cffd3cbf72` | `fix: run the D1 blocking check regardless of KV cache freshness (ADR-0006 Decision 2)` | yes — pushed `38d00cc..28dd37f` |

2 files changed, 49 insertions(+), 9 deletions(-) — `src/availability-api.ts`,
`test/availability-api.test.ts`.

## The bug

Decision 2 requires the D1 blocking-events check to apply "independent of the KV/Google cache
state" (ADR-0006 Decision 2). The first implementation gated the D1 read on `fresh` — the KV cache
being both present **and** within `AVAILABILITY_CACHE_STALE_MINUTES`:

```ts
// d36bdc7 — buggy
const blockedDates = fresh && env.DB && parsed.data >= fresh.windowStart && parsed.data <= fresh.windowEnd
  ? blockedDatesFromWindows(await listBlockingWindows(env.DB, fresh.windowStart, fresh.windowEnd))
  : new Set<string>();
```

And `resolveAvailability`'s first branch returned `"unknown"` unconditionally when `cache` was
null or the date was out of window — it never consulted `blockedDates` there.

**Why that defeats the point:** ADR-0001 (Google Calendar provisioning) is deferred indefinitely
(`docs/audits/2026-08-27-scheduling-integration-audit.md` §1.1). `GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY`
was never set on the live `focus` deployment, so `refreshAvailabilityCache()` no-ops on every cron
tick and the `AVAILABILITY_CACHE` KV entry is essentially always missing or stale there. Under the
`fresh &&` guard the D1 check therefore almost never fired in production, and a date confirmed
internally (`blocks_capacity=1`) still resolved `"unknown"` — the exact "always returns unknown for
blocked dates" problem Decision 2 set out to fix stayed unfixed.

## Why the original test suite didn't catch it

The two tests added with `d36bdc7` both used the module-level `cache` fixture, which
`describe("handleAvailability")`'s `beforeEach` writes to KV fresh, and the block-time `now`
(`2026-09-01T00:10:00.000Z`) is inside the 30-minute staleness threshold of that fixture's
`generatedAt`. So both ran on the **fresh-cache** path — the one path where the buggy guard
happened to let the D1 read through. The stale/missing-cache path — the only path that actually
exists in production today — was never exercised for a D1-blocked date. The existing
"falls back to unknown when the cache is older than the staleness threshold" test uses a stale
cache but an **empty** `events` table, so it couldn't distinguish "D1 not consulted" from
"D1 consulted, nothing blocking".

## The fix

- **`handleAvailability`** — the `blockedDates` query no longer requires `fresh`. It runs whenever
  `env.DB` is present and the requested date is inside a tracked window. The window is now sourced
  from `cache` (fresh **or** stale) when a cache exists, and from the requested day itself when the
  cache is missing:

  ```ts
  const windowStart = cache?.windowStart ?? parsed.data;
  const windowEnd = cache?.windowEnd ?? parsed.data;
  const blockedDates = env.DB && parsed.data >= windowStart && parsed.data <= windowEnd
    ? blockedDatesFromWindows(await listBlockingWindows(env.DB, windowStart, windowEnd))
    : new Set<string>();
  ```

  The **"date is in-window" bound is preserved** — it is still `parsed.data` within
  `[windowStart, windowEnd]`, identical to before wherever a cache exists (`fresh` was always either
  `cache` or `null`, and when it was `null` the old expression skipped the read entirely). What
  changed is only that freshness is no longer a precondition. When the cache is missing the window
  degenerates to the single requested day, which is the tightest possible in-window bound and keeps
  the D1 scan minimal.

- **`resolveAvailability`** stays pure — no new parameters, no `D1Database`/env. Its no-cache /
  out-of-window branch now returns `"unavailable"` when `blockedDates.has(date)`, before the
  `"unknown"` fallthrough:

  ```ts
  if (!cache || date < cache.windowStart || date > cache.windowEnd) {
    return { ok: true, date, status: blockedDates.has(date) ? "unavailable" : "unknown" };
  }
  ```

**Resulting behavior:**

| D1 | KV cache | Result |
|---|---|---|
| blocked | any (fresh / stale / missing) | `unavailable` |
| clear | fresh, date in-window | resolve from cache (unchanged) |
| clear | stale or missing | `unknown` (unchanged) |

Known boundary, consistent with keeping the in-window bound: a date blocked in D1 but **beyond a
present-but-stale cache's (stale) window** resolves `"unknown"`. This does not occur in the
realistic production state (cache missing → window is the requested day → D1 always consulted); it
would only matter for a cache that was written once long ago and never refreshed, and it resolves
itself the moment the cache is ever refreshed.

## Tests added (`test/availability-api.test.ts`)

Three cases, all on the previously-uncovered stale/missing-cache path:

1. **"resolves unavailable from a D1 capacity-blocking event when the KV cache is missing
   entirely"** — `AVAILABILITY_CACHE.delete(...)`, seed a `blocks_capacity=1` event for the
   requested date, assert `status === "unavailable"`. This is the actual current production state.
2. **"resolves unavailable from a D1 capacity-blocking event when the KV cache is stale"** — cache
   present but `now` set past the staleness threshold, same seed, same assertion.
3. **"still resolves a D1-clear date to unknown when the KV cache is stale"** — no blocking event,
   stale cache, asserts `status === "unknown"` — pins the third row of the matrix so a future
   over-correction can't silently flip it.

## Test suite — full run, zero failures

| Suite | Result |
|---|---|
| `npm run test:operations` | **158 passed** / 19 files (was 155; +3) |
| `npm run test:config-isolation` | **3 / 3 passed** |
| `npm run staff:test` | **32 / 32 passed** |
| `npm run test:staff:e2e` | **21 passed, 2 skipped, 0 failed** |
| `npm run typecheck` / `staff:typecheck` | clean |
| `npm run lint` / `staff:lint` | clean |

**No companion-fixture exception used.** All pre-existing tests pass unchanged; the only edits to
existing test code were additive (three new `it` blocks).

## Definition of done

- [x] D1 blocking check no longer gated on KV cache freshness (`fresh &&` removed from the
      `blockedDates` condition; `resolveAvailability` consults `blockedDates` before its `"unknown"`
      branch).
- [x] "Date is in-window" bound preserved (`parsed.data` within `[windowStart, windowEnd]`, window
      sourced from `cache` or the requested day).
- [x] New test case added: stale cache + D1-blocked → unavailable; missing cache + D1-blocked →
      unavailable; stale cache + D1-clear → unknown.
- [x] All existing tests still pass (158 total, zero failures).
- [x] Committed — `28dd37f`.
- [x] Pushed to `origin/main` — `38d00cc..28dd37f`.
- [x] This report section written — bug, fix, and why the original suite missed it.

## ADR-0006 status — unchanged (all decisions still done)

| Decision | Status |
|---|---|
| 1, 4, 6 | No code required |
| **2** | **Done** — `d36bdc7`, corrected by `28dd37f` |
| **3** | **Done** — `8152c5e` |
| **5** | **Done** — `2210bb6` |
