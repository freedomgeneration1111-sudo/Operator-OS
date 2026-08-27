# ADR-0006: Manual Booking Intake & Availability Display (Phase 1)

## Status

Proposed. **Rescoped 2026-08-27** per direct product clarification: automated booking
confirmation is paused. Confirmation stays a manual, staff-mediated reply through the existing
messaging pipeline. The automated-confirmation design from this ADR's first draft is preserved
below as a deferred appendix — not deleted — but explicitly out of scope for this ADR's
implementation. All decisions below are resolved.

## Context

The audit (`docs/audits/2026-08-27-scheduling-integration-audit.md`) found a dormant, read-only
availability pipeline already live for `focus` (Google freebusy → cron → KV cache →
`GET /v1/availability`), and a decision-support-only conflict assessor in the staff PWA. ADR-0001
(Google Calendar provisioning) remains deferred indefinitely, so the public availability check
currently always resolves `unknown`. Booking confirmation is a manual flow, by explicit product
decision — customer states a date, staff replies. This ADR does not change that; it makes the
manual flow work better.

A pre-implementation verification pass
(`docs/audits/2026-08-27-adr-0006-verification-addendum.md`) checked every open item from this
ADR's first draft against the live codebase before any code was written. Two of the three
suspected gaps (event-type capture, phone optionality) turned out to already be fully built — no
work needed. The verification also surfaced one thing this ADR's Context didn't anticipate:
**event inquiries currently create no `conversations` row.** The data (contacts, events, inquiry,
intake) lands correctly; there is no in-app thread. Staff discover new inquiries by polling the
Inbox, and any reply today happens out of band (email/phone), unless the customer separately opens
live chat.

That gap was initially proposed to be closed by opening an in-app conversation thread (Decision 6,
first draft). That's rejected: the customer submits the form and leaves — they aren't watching the
website, they're watching whichever contact channel (email or phone) they specified. An in-app
thread, and the resume-link email that would notify them of a reply in it, solves a problem the
customer doesn't have. See Decision 6 (resolved).

**Goal:** make the existing manual "customer states a date, staff replies" loop capture the right
information and reach staff promptly — without building the automated confirm/notify system that's
currently paused.

## Decisions

1. **No automated confirm/cancel endpoint, no new permission, no new `bookings`/
   `booking_notifications` tables, no reminder cron, no confirmation/reminder email automation.**
   All deferred (see Deferred section). Confirmation continues via the existing chat/email tools
   already built (`ChatRoom`, `conversations`, `dispatchOpsNotificationEmail`).

2. **Availability resolver reads D1 directly, not just Google.** Verified feasible
   (`docs/audits/…-verification-addendum.md` §"Decision 2"). Extend `handleAvailability`
   (`src/availability-api.ts:66`) to additionally query D1 using the existing blocking predicate
   already defined in `src/repository.ts:5` (`listBlockingWindows` — `blocks_capacity=1 AND
   scheduling_state NOT IN ('cancelled','declined')`), expand each row's date range to individual
   ISO dates via the existing `isoDatesBetween` helper (`src/availability-timezone.ts:45`), and
   union that set into `busy` **before** both the availability decision and the `nearby` scan —
   otherwise `nearby` could suggest an internally-blocked date. `resolveAvailability()` stays pure;
   the D1 read happens in the handler and gets passed in.
   **This is the first time `/v1/availability` touches D1 on the request path.** `API.md:8` and
   `openapi.yaml:31–57` currently document the endpoint as cache-read-only, never touching the
   backend on the request path — update both in the same change. This is a documented, deliberate
   deviation, not a silent one. Add test cases to `test/availability-api.test.ts`: "date is clear
   in KV but has a `blocks_capacity=1` event" and "nearby skips an internally-blocked date."

3. **`availabilityChecked` is promoted**, not abandoned. Verified as a clean additive
   `ALTER TABLE … ADD COLUMN … CHECK (...)` — a brand-new column with its own `CHECK` does not
   require the table-rebuild dance that modifying an *existing* column's constraint would (that's
   what forced migration `0006`, and what will force the resume-token change in the Deferred
   section — this is different and simpler). Six code sites, per the verification addendum:
   `commandSchema.intake` (`src/inquiry-service.ts:28–35`), the `intake_submissions` INSERT
   (`:87–94`), `focusCommand` adapter (`src/inquiry-adapters.ts:17–26`), `getInquiryDetail`'s
   SELECT (`src/repository.ts:45–47`), the staff-app `intakeSubmissions` type
   (`staff-app/src/lib/types.ts:32`), and `InquiryDetailView.tsx`. **Render as a single badge
   attached to the existing header badge-row (`InquiryDetailView.tsx:18`)** — not a new dedicated
   panel; `payload_json` continues to carry the raw value unchanged, this column is a promoted,
   queryable copy.

4. **Event-type field and phone optionality — verified already complete, no work needed.**
   `eventType` is a required Zod field (`src/contracts.ts:9`) wired end-to-end: public form chip UI
   → `InquirySubmission.eventType` → `POST /v1/inquiries` → `focusCommand` maps `eventFamily` →
   `events.event_family` → selected and rendered in `InquiryDetailView`/`InboxView`, filterable via
   the inbox `eventFamily` param. Phone is optional at both the Zod layer
   (`optionalText(40)`, required only inside the `contact === "phone"` branch) and the UI layer
   (no `required` attribute, labeled "Phone (optional)"). **No schema, contract, or form changes
   needed for either.** One UX note: the "Check Your Date" widget itself
   (`AvailabilityChecker.tsx`) captures only a date — the full name/email/phone/event-type capture
   happens in the separate `CheckAvailabilityForm` further down the same page. Collapsing that into
   one continuous step is a `Sunny-ops` front-end change with **zero** `operator-os` schema or
   contract impact — out of scope for this ADR, can be picked up independently.

5. **Staff notification on new event inquiries.** Verified genuinely needed — nothing fires today
   for a new `focus` event inquiry (only the still-uncommitted consulting-inquiry path notifies
   staff; chat notifications only fire on inbound chat *messages*, and event inquiries create no
   conversation to send one in). Add `dispatchEventInquiryNotificationEmail(env, {inquiryId})` in
   `src/ops-notify.ts`, a near-verbatim copy of `dispatchConsultingInquiryNotificationEmail`: same
   capability/secret guards, pulls name/email/phone/event_family/dates via a join through
   `intake_submissions`, deep-links to `${STAFF_CONSOLE_ORIGIN}/#/inquiry/${inquiryId}`, fired from
   the `kind === "event"` branch of `publicInquiry` on `!result.idempotentReplay`, wrapped in
   `ctx.waitUntil(...).catch(log)`. **Sequencing: must land in the same commit as, or after, the
   consulting-inquiry notification work** — it currently exists only in the uncommitted working
   tree (see Prerequisites), and this copies its pattern directly.

6. **Resolved — no in-app reply channel; no `conversations` row.** `createFocusInquiry` stays
   exactly as it is (contacts / events / inquiries / inquiry_services / intake_submissions /
   activities only). The customer doesn't remain on the site to watch an in-app thread — they
   specify a preferred contact channel (`contact: "email"|"phone"`, already captured, already
   required) precisely because they're going to close the tab. An in-app conversation, and the
   resume-link email that would notify them of a reply in it, is an indirect answer to a customer
   who wants a direct one. **Staff reply on whichever channel the customer specified, outside
   Operator OS** — the contact's name, email, and phone are already fully visible in
   `InquiryDetailView` (audit §5.3), and Decision 5's notification is what gets staff there
   promptly. No `operator-os` code change beyond Decisions 2–5 is needed to close this loop.
   For a `phone`-preference customer this was always going to be a human call or text — there is no
   SMS/voice integration in this stack, and none is proposed here.

## Data model change

Additive only:

```sql
-- migrations/0008_intake_availability_checked.sql   (0007 is the latest existing)
ALTER TABLE intake_submissions
  ADD COLUMN availability_checked INTEGER CHECK (availability_checked IN (0,1));
```

No new tables. Decision 6, if confirmed, requires **no migration at all** — it reuses the existing
`conversations` table via one additional application-level insert. The `bookings` /
`booking_notifications` schema from the original draft stays in the Deferred section and is not
part of this migration.

## Alternatives considered

- **Automated confirm-and-notify loop (the original draft's main content).** Rejected for now —
  paused by explicit product decision. Preserved in Deferred section.
- **Per-tenant Durable Object with hold/expiry state.** Rejected — no automated write-path exists
  to serialize.
- **Self-serve instant booking with a public write endpoint.** Rejected — confirmed out of scope.
  `POST /v1/inquiries` remains the only public write path.
- **Decision 6 — a bare `conversations` row, with reply-via-resume-link email.** Rejected: solves
  for a customer who stays engaged with the website, which doesn't match how this intake actually
  gets used — the customer specifies a contact channel and leaves. A resume-link email is an extra,
  indirect step between staff's reply and the customer actually seeing it.
- **Decision 6 — synthesize a full first customer message through `ChatRoom`/`StaffChatHub` DO
  machinery**, so the new inquiry rides the exact same path a live chat message takes. Rejected for
  the same underlying reason as the bare-row version, with more engineering surface on top (touches
  DO internals from a D1-only code path) for no better outcome.

## Prerequisites

- Resolve the dirty working tree before this migration lands. Verified as the uncommitted
  `publicConsultingInquiry` feature (`business-profiles.mts`, `src/contracts.ts`, `src/index.ts`,
  `src/inquiry-adapters.ts`, `src/inquiry-protection.ts`, `src/ops-notify.ts`, plus tests) — no ADR
  written for it, not committed. Decision 5 depends on
  `dispatchConsultingInquiryNotificationEmail`, which exists only in this uncommitted change.
- None outstanding beyond the dirty-tree resolution above — all decisions are resolved.

## Non-goals for this pass

- Any automated confirmation, reminder, or notification-on-confirm system (see Deferred).
- Reversing ADR-0001's Google Calendar deferral.
- Merging `AvailabilityChecker` and `CheckAvailabilityForm` into one continuous step. `Sunny-ops`
  front-end task, zero `operator-os` impact, not blocking this ADR.

## Open follow-ups (not this ADR)

- The Deferred section below, as a candidate future **ADR-0007** if/when automated confirmation is
  unpaused.
- `Sunny-ops` UX: collapse the two-step "Check Your Date" flow into one continuous step (Decision 4
  note).
- Staff PWA calendar view.
- GCal freebusy as an advisory layer on top of D1, if ADR-0001 is ever revisited.
- **Idea, not a decision:** a "send reply" action in the console that sends a real email directly
  to the contact via the existing Resend/`CUSTOMER_EMAIL_FROM` plumbing (already live and tested
  for `focus`), so the reply gets logged inside Operator OS instead of happening from Sunny's own
  inbox. Would need its own small endpoint and a delivery-log table or reuse of an existing one.
  Not proposed for this ADR — surfaced here because Decision 6's rejection was about the *resume-
  link* pattern specifically, not about email as a channel.

---

## Deferred — Automated Booking Confirmation (Paused)

*Preserved from this ADR's original draft. Not being built now. Revisit as its own ADR if/when the
manual flow above is live and automated confirmation is unpaused.*

- New internal endpoint `PATCH /v1/internal/inquiries/{id}/booking` (`confirm`/`cancel`), gated by a
  new `booking:manage` permission (distinct from `capacity:manage`, since this has customer-facing
  side effects the capacity toggle explicitly does not).
- New `bookings` table (thin, 1:1 with a confirmed `events` row) and `booking_notifications` table
  (delivery idempotency for confirmation/reminder sends, `UNIQUE(booking_id, notification_type)`).
- `CustomerNotificationEmailProvider` gains `sendBookingConfirmation`/`sendBookingReminder`; a third
  `src/ops-notify.ts` function sends the staff-facing "booking confirmed" notice.
- A new, separate, once-daily cron (not the existing 10-minute cadence) for reminder sends.
- `conversation_resume_tokens.purpose` extended with `'booking_management'` for a "view your
  booking" link. **CC note (still valid whenever this is picked up):** that column is a `CHECK`
  constraint; SQLite/D1 can't `ALTER … ADD CONSTRAINT` — requires the same create-copy-drop-recreate
  rebuild migration `0006` used, not a simple `ALTER TABLE`.
- Whole-day-only vs. time-slot booking model — moot until this work resumes, since no `bookings`
  schema is being written yet.
