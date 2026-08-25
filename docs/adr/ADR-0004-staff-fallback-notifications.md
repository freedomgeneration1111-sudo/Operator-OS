# ADR-0004: Staff Fallback Notification Parity

## Status
Proposed

## Context

The pre-implementation audit (see `docs/audits/`) surfaced several gaps:

- The Resend-based ops-notification email only fires on new-conversation
  creation, via `startNativeConversation`. It never fires on follow-up
  messages in an existing thread, and it is never called from the
  WhatsApp inbound path at all.
- `moses`'s business profile has `publicChat:false`, so native chat
  (and therefore the message form) doesn't exist for that tenant. Since
  WhatsApp is its only working customer channel, and WhatsApp never
  triggers the email, **email notification is currently unreachable for
  `moses` under any circumstance.**
- Web Push, by contrast, already fires correctly — on every customer
  message, across every channel (native chat and WhatsApp alike) — via
  `ChatRoom.persist()` → `StaffChatHub.deliver()` → `dispatchPushEvent()`.
- Neither `RESEND_API_KEY`, `CUSTOMER_EMAIL_FROM`, nor `OPS_NOTIFY_EMAIL`
  are declared as required secrets in either tenant's deployment config.
  The email path may be entirely dormant in both staging Workers today —
  unconfirmed, needs verification.
- `OPS_NOTIFY_EMAIL` is a single static value, not sourced per tenant —
  `focus` and `moses` can't currently have distinct destination
  addresses.
- The current email body has no link back to the conversation in the
  staff console.
- No capability flag exists for either channel; both are gated only by
  the incidental presence of secrets.
- `staff.mosesjorgensen.com` does not exist as a custom domain anywhere
  in the repo. `RESOURCE_PLAN.md` had deferred connecting
  `mosesjorgensen.com` during "Sprint 2." **That hold is lifted as of
  this ADR** — it is to be connected now, mirroring
  `staff.focuslabproductions.com`.
- Separately: `staff.focuslabproductions.com`'s route currently lives
  only in the root `wrangler.jsonc` staging env block, while a
  near-duplicate `deployments/focus-lab/console.staging.jsonc` targets
  the same Worker without carrying that route — a config split flagged
  during the audit as the kind of drift risk CLAUDE.md already warns
  about.

Goal: staff on both tenants get a redundant, hard-to-miss push alert
plus a searchable email record for every inbound message, regardless of
which customer-facing channel (live chat, async message form, or
WhatsApp) it arrived through, and regardless of whether the in-app
notification is missed.

## Decision

1. **Relocate the email trigger.** Move the ops-notification email out
   of `startNativeConversation` and into the same `deliver()` path in
   `chat-durable.ts` that already calls `dispatchPushEvent`, gated
   identically (`senderKind === "customer"`). This brings email to
   parity with push: every customer message, every channel, both
   tenants — and incidentally fixes `moses`'s total inability to receive
   it today, since WhatsApp already flows through this same path.

2. **Add explicit capability flags.** Add `opsNotifyEmail: boolean` and
   `opsNotifyPush: boolean` to `BusinessCapabilities`, following the
   existing `whatsappChannel` pattern. These become the source of truth
   for whether a channel is active per tenant, replacing today's
   implicit "whichever secrets happen to be set" behavior. Default both
   to `true` for `focus` and `moses`. Secret/config presence remains a
   secondary safety check — log and skip if a flag is on but the
   underlying config is missing, don't throw.

3. **Per-tenant recipient.** Replace the single static `OPS_NOTIFY_EMAIL`
   with a per-tenant value:
   - `focus` → `focuslabproductions@gmail.com`
   - `moses` → `freedomgeneration1111@gmail.com`

4. **Deep link.** Add a per-tenant `STAFF_CONSOLE_ORIGIN` value and use
   it to include a direct link to the specific conversation in the
   email body, alongside the existing message/contact/reply-preference
   details already sent.

5. **Connect `staff.mosesjorgensen.com`.** Add a custom-domain route for
   the moses console Worker, matching how `staff.focuslabproductions.com`
   is set up. The zone is already active in the Cloudflare account, so
   this is being connected directly via the dashboard rather than through
   wrangler/CC. CC's job is to reconcile the repo's deployment config to
   match what's live afterward, and to consolidate both tenants'
   custom-domain routes into a single authoritative config location,
   removing the existing focus-lab split rather than reproducing it for
   moses. (Separately, connecting the root `mosesjorgensen.com` domain to
   the `moses-static` Pages project is outside this ADR's scope — that's
   the public site, not the staff console — but is happening in the same
   pass; noted here only for cross-reference.)

6. **Verify secrets.** Confirm via `wrangler secret list` whether
   `RESEND_API_KEY`, `CUSTOMER_EMAIL_FROM`, and the new per-tenant
   recipient values actually exist on both staging Workers, and
   provision anything missing, before considering this live.

## Consequences

- Staff on both tenants get two independent, redundant signals — a push
  notification and a searchable email — for every inbound message on
  every channel, closing the "I was logged in but missed it" gap.
- `moses` gets a real custom staff domain ahead of whatever else was
  scoped for Sprint 2 — worth a quick check that nothing else depended
  on that domain staying unconnected a while longer.
- Two new capability flags are two new things to keep in sync per
  tenant going forward, in exchange for replacing an easy-to-forget
  implicit state with an explicit, auditable one.
- The focus-lab config-split cleanup is a small scope increase beyond
  the immediate ask, but shipping the identical unconsolidated pattern
  for moses while leaving it in place for focus would just be
  duplicating a known risk.

## Out of scope

- SMS (explicitly deferred).
- Google Voice (ruled out — no programmatic API exists for it).
- Customer-facing reply-channel preference
  (`reply_email`/`reply_sms`/`reply_call`) — unrelated existing feature.
- Sunny's WhatsApp Coexistence onboarding — separate, already-deferred
  ADR.
