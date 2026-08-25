# WhatsApp Channel Readiness — Audit Findings

Read-only audit for scoping ADR-0003 (WhatsApp as a conversation channel).
No code, migrations, or ADR were written in this pass. Audited against
`main` at commit `5191119`, migrations up to `0007_conversation_reply_preferences.sql`.

## 1. Schema (D1, latest migration 0007)

`conversations` (built up across 0001, 0003, 0007):

```
id TEXT PK
contact_id TEXT NOT NULL REFERENCES contacts
inquiry_id TEXT REFERENCES inquiries ON DELETE SET NULL
event_id TEXT REFERENCES events ON DELETE SET NULL
provider TEXT NOT NULL                     -- freeform string, e.g. "native_web"
external_conversation_id TEXT
channel_state TEXT NOT NULL DEFAULT 'open' CHECK IN ('open','closed','pending')
created_at TEXT NOT NULL, updated_at TEXT NOT NULL
assigned_responder_id TEXT REFERENCES responders ON DELETE SET NULL
public_resume_token_hash TEXT
last_message_at TEXT
last_customer_message_at TEXT
reply_email INTEGER NOT NULL DEFAULT 1 CHECK (reply_email IN (0,1))
reply_sms   INTEGER NOT NULL DEFAULT 0 CHECK (reply_sms IN (0,1))
reply_call  INTEGER NOT NULL DEFAULT 0 CHECK (reply_call IN (0,1))
```

Unique index: `conversations_provider_external_unique ON (provider, external_conversation_id) WHERE external_conversation_id IS NOT NULL` (`migrations/0001_operations_foundation.sql:80`).

**`provider` is already the channel column.** It's `TEXT NOT NULL`, not
CHECK-constrained — the only value ever written today is the literal
`"native_web"` (`src/native-chat.ts:41`). No `CHECK (provider IN (...))`
exists anywhere. A WhatsApp channel does **not** need a new column — it
slots into `provider` as a new string value (e.g. `"whatsapp"`), and
`external_conversation_id` is exactly the field for Meta's WhatsApp
conversation identifier, already unique-indexed per provider. This is a
stronger existing hook than may have been assumed — confirm this is what
you want, since it likely means **no schema migration is needed** for the
conversation-identity side.

`conversation_messages`: `sender_kind TEXT CHECK IN ('customer','responder','system')`,
`body TEXT CHECK (length(body) BETWEEN 1 AND 2000)`, `client_message_id`/`sequence`
uniqueness per conversation. No channel column — messages inherit channel
via their parent conversation's `provider`. WhatsApp text fits the 2000-char
constraint; media messages (image/audio/document) have no representable
body today — flag this as a real gap if media support is in scope.

`contacts`: `email TEXT, phone TEXT`, `CHECK (email IS NOT NULL OR phone IS NOT NULL)`,
unique index on lowercased email, plain (non-unique) index on phone. Phone
is already a first-class identity field — a good fit for WhatsApp identity,
but `phone` has no format/E.164 constraint and no uniqueness constraint
(unlike email), so multiple contacts could collide on the same WhatsApp
number without app-level dedup logic.

**House boolean/enum convention** (confirmed against `reply_email`/`reply_sms`/`reply_call`,
`blocks_capacity`, `active`, `enabled`): booleans are
`INTEGER NOT NULL DEFAULT <0|1> CHECK (col IN (0,1))`, never `BOOLEAN`.
String enums (`channel_state`, `workflow_state`, `sender_kind`, `actor_kind`,
`role`): `TEXT NOT NULL DEFAULT '<value>' CHECK (col IN ('a','b',...))`.
**`provider` breaks this convention** — it's the one enum-shaped column
left unconstrained. If ADR-0003 adds a genuine `channel` column instead of
reusing `provider`, house style says add a `CHECK`. If you instead reuse
`provider` as-is, note you'd be matching the one column that already
deviates from house style — worth an explicit ADR decision, not a silent
default.

## 2. Outbound reply path

There is **no single outbound dispatch abstraction** — three separate,
unrelated code paths, not a pluggable interface:

- **WebSocket (live, in-app)**: `src/chat-durable.ts` (`ChatRoom`/`StaffChatHub`
  Durable Objects) — not relevant to a WhatsApp send.
- **Web Push (staff notification)**: `src/push.ts` — staff-facing only.
- **Customer email notification**: `src/customer-email.ts` defines a real
  interface — `CustomerNotificationEmailProvider` with
  `sendConversationReplyNotification()` — and a factory
  `createCustomerNotificationEmailProvider(env, fetcher)`. Invoked from
  `src/customer-continuity.ts:notifyCustomerOfAbsentReply()`, which writes
  to `conversation_notifications` (status `pending`/`accepted`/`failed`,
  `provider` column, `failure_code`, idempotency via an `Idempotency-Key`
  header). **This is the closest thing to a reusable pattern** — the shape
  (provider interface + `conversation_notifications` audit table + typed
  config/delivery errors) is what a `WhatsAppNotificationProvider` should
  mirror, not `messaging.ts`.

**`MessagingProvider` / `MESSAGING_DESTINATION_URL` is a dead end for
WhatsApp, not worth resurrecting.** `src/messaging.ts:9-23` is a
static-URL redirect builder — it takes a fixed HTTPS destination (e.g. a
`wa.me` deep link) and appends a `?text=` query param, nothing else. It
never sends a message; it only hands the customer a link to click. No API
call, no auth token, no phone-number-ID concept, no delivery status. Used
exactly once, in `src/staff-api.ts:28`, purely to compute the legacy
`GET /v1/internal/status` "messaging" label (`resolveChatStatus` in
`messaging.ts:25-38`) — a vestige of a pre-native-chat era, unrelated to
actual message delivery. A real WhatsApp Cloud API integration needs the
`customer-email.ts`-shaped provider/interface pattern (authenticated POST
to the Graph API, `WHATSAPP_ACCESS_TOKEN` bearer auth, delivery status
tracking), not `messaging.ts`.

## 3. Inbound webhook pattern

**There is no inbound webhook route anywhere in this Worker.** The full
route table in `src/index.ts` (lines 23–48) is either public customer-facing
(`/v1/inquiries`, `/v1/chat/*`, `/v1/availability`) or staff-authenticated
(`/v1/internal/*` via Cloudflare Access JWT, `src/auth.ts`). Resend is used
**outbound-only** (`customer-email.ts`, `ops-notify.ts` — both POST to
`api.resend.com`); there's no Resend inbound-email or delivery-webhook
receiver. No Stripe integration exists at all. A Meta webhook receiver
(`GET` for the verify-token handshake + `POST` for events) has **no
existing precedent to mirror** — it will be new surface area, not an
extension of an existing pattern.

**Signature/token verification**: the only verification pattern that
exists is `src/inquiry-protection.ts`'s Turnstile flow, and it is
**outbound verification** (this Worker POSTs the client's token to
Cloudflare's `siteverify` endpoint and trusts the response) — structurally
the opposite of what a Meta webhook needs (verifying an *inbound*
HMAC-SHA256 signature over the raw request body via `crypto.subtle`, plus
the one-time `GET` challenge/verify-token handshake). Staff auth
(`src/auth.ts`, `jose`-based Access JWT verification) verifies Cloudflare
Access identity tokens, not third-party webhook signatures, and is also
not applicable. No `crypto.subtle.importKey`/HMAC-verify code exists
anywhere in `src/` (confirmed by grep). This is genuinely new code — call
this out explicitly in the ADR rather than assuming a "mirror this file"
scope.

## 4. Secrets & config

Confirmed end-to-end pattern via `VAPID_*` / `RESEND_API_KEY` / `CUSTOMER_EMAIL_FROM`:

1. Declare as optional string on **both** `Env` and `Cloudflare.Env`
   interfaces in `secrets.d.ts` (duplicated declaration). Note:
   `RESEND_API_KEY` and `CUSTOMER_EMAIL_FROM` are declared there but **not**
   listed in either deployment's `secrets.required` array — only
   `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` appear there
   today, for both `focus` and `moses`. `secrets.required` is not an
   exhaustive/enforced list against everything actually read from `env` —
   don't assume adding a name there documents provisioning status; it
   doesn't currently, for the closest analog (`RESEND_API_KEY`).
2. Read directly off `env.<NAME>` at point of use with a runtime guard
   (`if(!env.RESEND_API_KEY||...)`), never a central config loader — see
   `customer-email.ts:20`, `ops-notify.ts:14`.
3. Provision with `wrangler secret put <NAME> --config deployments/<business>/api.staging.jsonc`
   per `CLAUDE.md` §4 — per-deployment-config, so `focus` and `moses`
   secrets are provisioned as two entirely separate `wrangler secret put`
   invocations against two separate Worker names, never shared.

For `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`: add all three to both interfaces in
`secrets.d.ts`, and to `moses-jorgensen/api.staging.jsonc`'s
`secrets.required` array (currently just the VAPID keys) if you want that
file to reflect what's actually provisioned — though note it's aspirational
documentation, not enforced, based on the `RESEND_API_KEY` precedent above.

## 5. Multi-tenant scoping

**This is a genuinely clean boundary, confirmed at every layer:**

- **Separate Workers, separate deployment configs**: `moses-operator-api-staging`
  (`deployments/moses-jorgensen/api.staging.jsonc`) vs `focus-lab-api-staging`
  (`deployments/focus-lab/api.staging.jsonc`) — different `name`, different
  `--config` path, deployed by different npm scripts. Deploying/testing one
  never touches the other's Worker.
- **Separate D1 databases**: `moses-operator-crm-staging` (`578a2794-...`)
  vs `focuslab-crm-staging` (`9a7e55cb-...`) — fully separate databases, not
  row-scoped by tenant ID. WhatsApp conversations created on `moses`
  physically cannot appear in `focus`'s data.
- **Separate rate-limiter namespaces**: `22003`/`22004` (moses) vs
  `12003`/`12004`/`12007` (focus) — distinct namespace IDs.
- **Separate secrets**: `wrangler secret put --config deployments/moses-jorgensen/api.staging.jsonc`
  writes only to the `moses-operator-api-staging` Worker's secret store;
  `focus-lab-api-staging`'s secrets are untouched.
- **`business-profiles.mts` gates behavior, not just labels**: the `moses`
  profile currently has `publicChat:false` and `publicEventInquiry:false`.
  Per `src/index.ts:31`, this means **`/v1/chat/*` returns 404
  (`module_disabled`) on the moses deployment today** — the entire
  native-chat public surface is off. A WhatsApp inbound webhook route would
  need to live outside that gate (e.g. an unconditional
  `/v1/webhooks/whatsapp` route, or its own capability flag) — decide
  explicitly whether WhatsApp needs its own flag in `BusinessCapabilities`
  or bypasses `publicChat` entirely.

You can safely build and fully test the WhatsApp channel against the
`moses-operator-api-staging` Worker/DB without any risk of touching
`focus-lab-api-staging` or its live customer data — the isolation is real,
not just conventional.

**Staleness flag**: `deployments/moses-jorgensen/RESOURCE_PLAN.md` (dated
2026-08-17) states migrations 0001–0006 are applied to
`moses-operator-crm-staging`; migration 0007 (added `reply_email`/`reply_sms`/`reply_call`)
postdates that doc. Verify the actual applied-migration state on the moses
D1 instance before assuming schema parity with `focus` — don't trust this
doc as current.

## 6. Rate limiting

`CHAT_RATE_LIMITER` **is** wired to actual middleware, not just declared.
`src/native-chat.ts:116`, `enforceChatRateLimit(request, env, scope)`: keys
on `` `${scope}:${CF-Connecting-IP}` ``, calls `.limit()`, throws
`NativeChatError(429,...)` on failure; fails closed (503) outside
`development` if the binding is absent. Bound for both `focus`
(`namespace_id:"12004"`) and `moses` (`namespace_id:"22004"`) in their
respective `.jsonc` files. The pattern (declare `RateLimit` binding per
deployment → guard function keyed by IP+scope → throw a typed error the
route's catch-all in `index.ts` already handles) is directly reusable for
a new WhatsApp webhook route — same shape as `enforceChatRateLimit` /
`enforceInquiryProtection` / `availability-api.ts`'s equivalent. Prefer a
fresh `namespace_id` per deployment (following the `12003`/`12004`/`12007`
vs `22003`/`22004` numbering convention) rather than reusing
`CHAT_RATE_LIMITER`, since a webhook receiver should probably be keyed on
something other than customer IP (Meta's webhook calls originate from
Meta's servers, not the end user) — an explicit decision for the ADR, not
a silent reuse.

## 7. Staff console rendering

`staff-app/src/views/ChatView.tsx` (29 lines, single file, no per-channel
components):

- Header copy is hardcoded single-channel: `"Native Customer Channel"`
  eyebrow, `"Website conversations are stored in D1 and delivered live
  through Cloudflare WebSockets."` (line 22); empty state says `"No website
  conversations"` (line 24) — all assume web chat is the only channel.
- The conversation list **already has a generic-provider fallback**: line
  24, `item.provider==="native_web" ? "Website chat" : humanize(item.provider)`
  — a `provider:"whatsapp"` row would render today via `humanize("whatsapp")`
  without crashing, just without a dedicated badge/icon. This is the
  natural seam for a future channel badge — swap the ternary for a
  lookup/badge component keyed on `item.provider`.
- Reply-preference UI (`Call`/`Text` links, line 25) is driven by
  `reply_call`/`reply_sms` booleans on the conversation, independent of
  `provider` — no coupling there to worry about.
- The metric card `"External channels remain future adapters"` (line 23)
  is literally a stub comment anticipating this work.
- `client.reply()` (line 18) posts a reply through one generic endpoint
  regardless of channel — no per-channel send branching client-side today,
  so a WhatsApp send needs to be dispatched server-side (per §2) rather
  than the client choosing a channel.

## Summary: reuse vs. new

| Area | Reuse | New |
|---|---|---|
| Schema | `provider`/`external_conversation_id` columns already channel-shaped | Possibly nothing, or one CHECK constraint if formalizing `channel` |
| Outbound send | `CustomerNotificationEmailProvider` interface shape, `conversation_notifications` audit table | Actual WhatsApp Graph API client; `messaging.ts` is a dead end |
| Inbound webhook | Route dispatch/error-handling pattern in `index.ts` | Entire receiver — no existing webhook route to mirror |
| Signature verification | None usable | HMAC verify + verify-token handshake — fully new |
| Secrets | `secrets.d.ts` + per-deployment `wrangler secret put` convention | Just add 3 names, same mechanics |
| Multi-tenant isolation | Fully clean already | Decide whether WhatsApp needs its own `BusinessCapabilities` flag |
| Rate limiting | `enforceChatRateLimit` pattern reusable | New namespace; IP-keying likely wrong for a server-to-server webhook |
| Staff UI | Generic provider fallback already renders unknown channels | Badge/icon component, header copy |

## Non-goals honored

No schema migrations, no new routes/files/scaffolding, no ADR, and no
changes to the `focus` tenant were made in this pass — this document is
inventory only.
