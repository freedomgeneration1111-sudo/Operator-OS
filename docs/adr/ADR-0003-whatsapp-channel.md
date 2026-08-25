# ADR-0003: WhatsApp as a Conversation Channel

## Status
Proposed — targets `moses-operator-api-staging` only. `focus` untouched.

## Context

Audit (`whatsapp-channel-readiness.md`, commit `5191119`) found that
`conversations.provider` is already an unconstrained `TEXT` column
holding only the literal `"native_web"` today, with
`external_conversation_id` already unique-indexed per provider. This is
a stronger hook than assumed going in: adding WhatsApp does not require
new tables or columns for conversation identity, only a new `provider`
value and new code to populate/consume it.

Build and prove this entirely on `moses-operator-api-staging` /
`moses-operator-crm-staging`, which the audit confirmed is a fully
isolated Worker + D1 database from `focus`. Nothing here touches the
`focus` tenant.

## Decisions

**1. Reuse `provider` as the channel column. Do not add a DB-level CHECK constraint.**
`provider` gets a second value, `"whatsapp"`, written and read exactly
like `"native_web"` is today. This is the one enum-shaped column in the
schema without a `CHECK` (audit §1) — formalizing it would require a
SQLite table rebuild (D1/SQLite can't `ALTER ... ADD CONSTRAINT`), and
every migration to date has been additive-only, matching ADR-0002's
"no rebuild beyond the additive migration" philosophy. Enforce the
allowed-value set in application code instead: a single
`const CONVERSATION_PROVIDERS = ['native_web', 'whatsapp'] as const`
referenced everywhere `provider` is written. This is a documented,
deliberate deviation from house convention, not a silent one — DB-level
enforcement is a fair future hygiene item once there's appetite for a
table-rebuild migration, not a blocker for this ADR.

**2. Outbound send: new `WhatsAppNotificationProvider`, mirroring `CustomerNotificationEmailProvider`.**
Audit §2 identified `customer-email.ts`'s provider-interface +
`conversation_notifications` audit-table shape as the actual reusable
pattern — not `messaging.ts`, which the audit confirmed is a dead
`wa.me`-link redirect builder with no send capability, used only for a
legacy status label. Build `WhatsAppNotificationProvider` with a
`sendWhatsAppReply()` method, authenticated `POST` to the Graph API
(`https://graph.facebook.com/v22.0/{WHATSAPP_PHONE_NUMBER_ID}/messages`,
bearer `WHATSAPP_ACCESS_TOKEN`). Reuse `conversation_notifications`
as-is for delivery bookkeeping (it already has a `provider` column) —
no new table.

**3. Inbound webhook: new route `/v1/webhooks/whatsapp`, gated by a new capability flag.**
No existing webhook route to mirror (audit §3 confirmed this is
genuinely new surface area) — `GET` handles Meta's one-time
challenge/verify-token handshake (echo `hub.challenge` when
`hub.verify_token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN`); `POST`
verifies `X-Hub-Signature-256` via HMAC-SHA256 over the raw body using
`WHATSAPP_APP_SECRET` (`crypto.subtle`, since the audit confirmed no
HMAC-verify code exists anywhere in `src/` yet) before processing.
Gate the route behind a new `whatsappChannel` flag in
`BusinessCapabilities` (default `false` for both tenants), following the
existing `publicChat`/`publicEventInquiry` pattern (audit §5) rather than
bypassing capability gating entirely or reusing `publicChat` — WhatsApp
is a distinct product decision from native web chat (`moses` currently
has `publicChat:false`; this flag needs to be independently `true` on
`moses` without touching `focus` or turning web chat back on).

**4. Rate limiting: new namespace, keyed on a coarse scope, not `CF-Connecting-IP`.**
New binding `WHATSAPP_WEBHOOK_RATE_LIMITER`, new `namespace_id` per
deployment (CC: confirm the actual next-available IDs in each `.jsonc`
at implementation time — don't guess numbers). Key on a constant scope
(e.g. `"whatsapp-webhook"`) rather than IP, per the audit's own
reasoning in §6: Meta's webhook calls originate from Meta's
infrastructure, not the end customer, so IP-keying (the
`enforceChatRateLimit` pattern) doesn't fit. Signature verification
(Decision 3) is the real security gate; this limiter is a coarse circuit
breaker behind it, not the primary control.

**5. Text-only for v1. No media support.**
`conversation_messages.body` has a 1–2000 char constraint with no
representable body for image/audio/document messages (audit §1). Inbound
media messages get stored with a placeholder body
(`"[Media message received — reply not yet supported for this type]"`)
rather than silently dropped, so staff at least see that something
arrived and can follow up by phone. No schema change for real media
support — that's a follow-up ADR if it becomes a real gap.

**6. Contact identity: best-effort phone match, no new uniqueness constraint.**
On inbound message, normalize the WhatsApp `wa_id` toward E.164 and look
up `contacts.phone` for a match; create a new contact if none found. No
DB-level uniqueness constraint added to `phone` — that's a pre-existing,
broader `contacts` concern (audit §1) outside WhatsApp's scope. Known
limitation, stated explicitly: a contact already on file under a
differently-formatted number won't auto-merge; that's a manual CRM fix
until dedup is addressed separately.

**7. Secrets: four names.**
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` (self-generated, arbitrary string, used
only for the `GET` handshake), and **`WHATSAPP_APP_SECRET`** (Meta App
Settings → Basic; used for `X-Hub-Signature-256` verification — not the
same value as the access token). All four follow the confirmed pattern
from audit §4: declared on both `Env` and `Cloudflare.Env` in
`secrets.d.ts`, read directly off `env.<NAME>` with a runtime guard at
point of use, provisioned via
`wrangler secret put <NAME> --config deployments/moses-jorgensen/api.staging.jsonc`.
Add all four to that deployment's `secrets.required` for documentation
purposes, understanding (per audit §4) that array isn't currently
enforced against what's actually read from `env`.

**8. Staff UI: swap the provider ternary for a small badge lookup; update channel-assuming copy.**
`ChatView.tsx` line 24 already falls back to `humanize(item.provider)`
for unknown providers, so a `"whatsapp"` row renders today without
crashing — swap that ternary for a lookup/badge component (🌐 Website /
🟢 WhatsApp) instead of extending the ternary. Update the hardcoded
"Native Customer Channel" eyebrow and "No website conversations" empty
state (currently single-channel-assuming) to be channel-neutral. Replace
the "External channels remain future adapters" stub comment — it's
describing exactly this work now.

## Data model change

**None.** Zero D1 migrations for this ADR. `provider` and
`external_conversation_id` already do the job (Decision 1);
`conversation_notifications` already has the shape outbound needs
(Decision 2). This is the payoff of auditing before scoping — the
original plan assumed schema work that isn't actually needed.

## Alternatives considered

- **Add a `CHECK` constraint to `provider` now.** Rejected for this pass
  — requires a SQLite table rebuild on a table with FKs and multiple
  indexes; inconsistent with every prior migration being additive-only.
  Revisit if/when there's appetite for that rebuild on its own merits.
- **Rename `provider` to `channel`.** Rejected — cosmetic, and a rename
  touches every read site for no functional gain. `provider` stays the
  physical column name; "channel" is fine as the conceptual term in code
  comments and UI.
- **Reuse `CHAT_RATE_LIMITER` for the webhook route.** Rejected — it's
  IP-keyed, and Meta's webhook traffic isn't customer-IP-shaped. A
  dedicated limiter keyed on a coarse scope is the right shape.
- **Drop unsupported media messages silently.** Rejected — a placeholder
  body costs nothing and prevents a customer's message from vanishing
  with no staff visibility.
- **Bypass `BusinessCapabilities` gating for the webhook route.**
  Rejected — inconsistent with how every other optional public surface
  in this codebase is controlled, and removes the ability to enable
  WhatsApp on `moses` independently of `focus`.

## Prerequisites (before this can run against staging)

- Meta sandbox setup complete: test WABA, test phone number, verified
  test recipient(s), temporary access token generated (per the sandbox
  walkthrough already covered) — sufficient for initial development. The
  temporary token expires in ~24h; expect to regenerate it manually
  during active dev until a System User / permanent token is set up
  (production concern, not this ADR).
- `WHATSAPP_APP_SECRET` pulled from Meta App → Settings → Basic.
- All four secrets provisioned on `moses-operator-api-staging` via
  `wrangler secret put`.
- Confirm actual applied-migration state on `moses-operator-crm-staging`
  directly (audit §5 flagged `RESOURCE_PLAN.md` as stale/dated
  2026-08-17, predating migration 0007) — don't trust that doc as
  current, even though this ADR adds no new migration itself.

## Non-goals for this pass

- No media message support (images/audio/documents) — text only.
- No business-initiated / template-message sending — replies only,
  within Meta's customer-service window.
- No Coexistence setup or any work on Sunny's real number — `moses`
  sandbox only. Coexistence is its own ADR once this is proven.
- No changes to `focus` tenant code, config, or secrets.
- No contact-phone dedup/uniqueness enforcement.
- No DB-level `CHECK` on `provider` (Decision 1).
- No delivery-status (sent/delivered/read) tracking via Meta's status
  webhooks — send-and-store only for v1.

## Open follow-ups (not this ADR)

- Delivery status tracking, if read/delivered receipts become
  operationally useful.
- Real media message support.
- Coexistence integration for Sunny's existing number.
- Broader `contacts.phone` dedup — pre-existing gap, not WhatsApp-specific.
- `channel_state` staff workflow wiring — still open from ADR-0002.
- Whether `focus` ever gets `whatsappChannel` enabled automatically, or
  requires an explicit manual turn-on — decide at Sunny-rollout time.
