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
