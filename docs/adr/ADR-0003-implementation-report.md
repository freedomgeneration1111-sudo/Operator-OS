# ADR-0003 Implementation Report — WhatsApp Channel (`moses` tenant)

Implements `docs/adr/ADR-0003-whatsapp-channel.md` against `main` at
commit `5191119`. Scope: `moses-operator-api-staging` /
`moses-operator-crm-staging` only. No `focus`/`focus-lab-*` file,
config, or secret was touched — confirmed by diff (see below).

## Resolved: webhook gating decouples from `PUBLIC_API_ENABLED`

Originally gated on both `profile.capabilities.whatsappChannel` and the
existing `PUBLIC_API_ENABLED !== "false"` check, mirroring `/v1/chat/*`.
Flagged for a decision rather than assumed. Resolved: `/v1/webhooks/whatsapp`
now checks `profile.capabilities.whatsappChannel` only —
`src/index.ts:37`:

```ts
if(url.pathname==="/v1/webhooks/whatsapp"&&!profile.capabilities.whatsappChannel)
  return json({ok:false,error:{code:"module_disabled",message:"WhatsApp channel is not enabled for this deployment"}},404);
```

Reasoning: `PUBLIC_API_ENABLED` gates public-facing customer surfaces
(chat widget, inquiry form) ahead of site launch; the WhatsApp webhook is
a server-to-server endpoint from Meta, already protected by
`X-Hub-Signature-256` verification, and shouldn't be coupled to
site-launch status. No other route's gating changed — `/v1/inquiries`,
`/v1/availability`, and `/v1/chat/*` still check `publicApiEnabled`
exactly as before (confirmed by grep and by `test:operations` /
`test:config-isolation` passing unchanged after the edit).

Practical effect: the webhook route is live on `moses-operator-api-staging`
as soon as `whatsappChannel:true` is deployed, independent of moses's
current `"PUBLIC_API_ENABLED":"false"`.

## What was built

### Schema
No migration. `provider='whatsapp'` + `external_conversation_id=<E.164
phone>` reuse existing `conversations` columns per ADR Decision 1.
`src/conversation-providers.ts` adds `CONVERSATION_PROVIDERS = ['native_web',
'whatsapp'] as const` as the application-level enum enforcement (no DB
`CHECK`, per Decision 1). `native-chat.ts` now writes `NATIVE_WEB_PROVIDER`
instead of the `"native_web"` string literal.

### Inbound webhook — `src/whatsapp.ts`
- `GET /v1/webhooks/whatsapp` — `hub.verify_token` handshake
  (`handleWhatsAppVerify`).
- `POST /v1/webhooks/whatsapp` — verifies `X-Hub-Signature-256`
  (HMAC-SHA256 over the raw body via `crypto.subtle`, timing-safe
  compare) before any parsing or DB write; rejects with 401 on mismatch
  or missing secret (`WhatsAppWebhookError`, handled in `index.ts`'s
  top-level catch).
- On a valid signed payload: for each inbound message, finds-or-creates
  the contact by exact phone match (`+<digits>` normalized from Meta's
  `wa_id`), finds-or-creates the conversation keyed on
  `(provider='whatsapp', external_conversation_id=<normalized phone>)`,
  and persists the message through the existing `ChatRoom` Durable
  Object via `persistThroughRoom` (now exported from `native-chat.ts`) —
  reusing the same sequencing, WebSocket broadcast, and staff-hub push
  path native web chat uses, rather than writing D1 directly.
- Non-text messages get the ADR-mandated placeholder body
  (`"[Media message received — reply not yet supported for this type]"`)
  instead of being dropped.

### Outbound reply — `src/whatsapp.ts` + `src/chat-durable.ts`
- `WhatsAppNotificationProvider` / `createWhatsAppNotificationProvider` /
  `dispatchWhatsAppReply`, mirroring `CustomerNotificationEmailProvider`'s
  shape (`customer-email.ts`). Authenticated `POST` to
  `https://graph.facebook.com/v22.0/{WHATSAPP_PHONE_NUMBER_ID}/messages`,
  bearer `WHATSAPP_ACCESS_TOKEN`. Delivery bookkeeping reuses
  `conversation_notifications` as-is (`provider='whatsapp'`,
  `status`/`failure_code` columns) — no new table.
- Wired into the actual dispatch call site: `ChatRoom.persist()` in
  `src/chat-durable.ts` now looks up `conversation.provider` and, for a
  responder reply, branches — `whatsapp` → `dispatchWhatsAppReply` (the
  only delivery path for that conversation; there's no "customer live on
  the website socket" concept for WhatsApp), anything else → the
  pre-existing `notifyCustomerOfAbsentReply` email-continuity logic,
  unchanged. The `continuity.status` in the reply response gained a new
  value, `"whatsapp_dispatched"`.

### Rate limiting
New `WHATSAPP_WEBHOOK_RATE_LIMITER` binding, namespace `22005` (next
available after moses's existing `22003`/`22004`), added only to
`deployments/moses-jorgensen/api.staging.jsonc`. Keyed on a constant
scope (`"whatsapp-webhook"`), not IP, per ADR Decision 4. Fails closed
outside `ENVIRONMENT=development`, matching `enforceChatRateLimit`.

### Secrets
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` declared on both
`Env` and `Cloudflare.Env` in `secrets.d.ts`, added to moses's
`secrets.required`. Not generated or hardcoded anywhere — provision via
`wrangler secret put <NAME> --config deployments/moses-jorgensen/api.staging.jsonc`.

### Capability flag
`BusinessCapabilities.whatsappChannel: boolean` added in
`business-profiles.mts`. `false` for `focus`, `true` for `moses`.

### Staff console — `staff-app/src/views/ChatView.tsx`
- `item.provider==="native_web"?...:humanize(...)` ternary replaced with
  a `channelBadge()` lookup (🌐 Website / 🟢 WhatsApp / humanized
  fallback for anything else).
- "Native Customer Channel" eyebrow → "Customer Conversations"; "Website
  conversations are stored..." → channel-neutral copy; "No website
  conversations" empty state → "No conversations yet".
- "External channels remain future adapters" stub replaced with
  "Website chat and WhatsApp share this inbox".
- `send()` delivery-status line gained a `"whatsapp_dispatched"` →
  "Reply sent via WhatsApp." case; `staff-app/src/lib/api.ts`'s
  `reply()` return type updated to include that status literal.

## Verification run

All passing:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run test:operations` | 138/138 (pre-existing suite, unmodified, unaffected) |
| `npm run test:config-isolation` | 3/3 |
| `npm run staff:typecheck` | clean (after fixing `api.ts`'s `reply()` continuity-status union) |
| `npm run staff:lint` | clean |
| `npm run staff:test` | 32/32 (fixed 2 pre-existing stale assertions in `business-profile.test.ts` — that file was already missing the `availability` capability from a prior ADR before this change; CLAUDE.md §6 had already flagged this file as carrying known-failing tests tied to capability changes) |

**Not run — requires Meta sandbox credentials I don't have access to:**
1. Send a real WhatsApp message to the Meta test number; confirm it
   lands in D1 (`conversations`/`conversation_messages`,
   `provider='whatsapp'`) and renders in the staff console with the new
   badge.
2. Reply from the staff console; confirm delivery to the test WhatsApp
   number.
3. Send an unsigned/forged `POST` to `/v1/webhooks/whatsapp`; confirm
   401 and that it never reaches the D1 write path.

These need the four secrets provisioned via `wrangler secret put`, then a
deploy of `moses-operator-api-staging` with `whatsappChannel:true` — the
gating decision above is resolved, so no further code change is needed
to unblock this.

## Diff summary

```
 business-profiles.mts                          |  5 +++--
 deployments/moses-jorgensen/api.staging.jsonc   |  4 ++--
 secrets.d.ts                                    | 10 ++++++++++
 src/chat-durable.ts                             | 10 +++++++++-
 src/index.ts                                    |  6 +++++-
 src/native-chat.ts                              |  5 +++--
 staff-app/src/lib/api.ts                        |  2 +-
 staff-app/src/lib/business-profile.test.ts      |  4 ++--
 staff-app/src/views/ChatView.tsx                |  9 +++++----
 9 files changed, 40 insertions(+), 15 deletions(-)
```
New files (untracked, not yet committed): `src/conversation-providers.ts`,
`src/whatsapp.ts`, `docs/adr/ADR-0003-whatsapp-channel.md`,
`docs/audits/whatsapp-channel-readiness.md`, this report.

No `deployments/focus-lab/` file, `focus`-keyed business-profile entry
beyond the one-line capability addition, or `focus-lab-*` secret was
touched.
