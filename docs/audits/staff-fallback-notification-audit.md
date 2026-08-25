# Staff Fallback Notification — Pre-Implementation Audit

Read-only audit. No production code was changed to produce this report.

Context: extending the existing staff-facing fallback notifications (Resend
email + Web Push) so both fire reliably as a safety net whenever *any* new
message arrives — live chat widget or "Send us a Message" form — across
both the `focus` and `moses` tenants. This document answers the audit
questions asked before that implementation work starts.

---

## Q1 — Email notification trigger scope

`sendOpsNotification` (`src/ops-notify.ts:13-31`) is called from exactly **one** place repo-wide (confirmed by `grep -rn "sendOpsNotification"`): `src/native-chat.ts:44`, inside `startNativeConversation`.

```ts
// src/native-chat.ts:34-46
export async function startNativeConversation(request:Request,env:Env,ctx:ExecutionContext){
  ...
  const now=new Date().toISOString();const proposedContactId=crypto.randomUUID();const conversationId=crypto.randomUUID();...
  await env.DB.prepare(`INSERT OR IGNORE INTO contacts (...) VALUES (...)`)...run();
  const contact=await env.DB.prepare("SELECT id FROM contacts WHERE lower(email)=?")...
  await env.DB.prepare(`INSERT INTO conversations (id,contact_id,provider,channel_state,...) VALUES (...)`)...run();   // line 42 — new thread row
  const result=await persistThroughRoom(env,conversationId,{senderKind:"customer",...});                                // line 43 — first message
  ctx.waitUntil(sendOpsNotification(env,{...}).catch(...));                                                             // line 44 — ops email
  return Response.json({...});
}
```

This function only runs on **new-conversation creation** — the `INSERT INTO conversations` happens two lines above the notification call. It is never reached for an existing thread.

Follow-up messages on an already-open thread go through a different function, `publicConversationRoute`, specifically the message-post branch:

```ts
// src/native-chat.ts:53-58
if(request.method==="POST"&&action==="messages"){
  await enforceChatRateLimit(request,env,"message");const parsed=messageSchema.safeParse(...);
  ...
  const result=await persistThroughRoom(env,conversationId,{senderKind:"customer",senderResponderId:null,...parsed.data});
  return Response.json({ok:true,...result},{status:201});
}
```

This calls `persistThroughRoom` → `ChatRoom.persist()` (`src/chat-durable.ts:16-27`), which never imports or calls `sendOpsNotification`. Commit `0b34aa3` ("add conversation reply preferences (ADR-0002)") message confirms this was deliberate: *"threads ctx through startNativeConversation for a backup Resend ops-notification email... degrades silently when unconfigured."*

**Answer: new-thread creation only, not every message.**

---

## Q2 — Live chat vs. "Send us a Message" parity

Both UI modes hit the **same** endpoint and handler — there is no branching by mode:

```ts
// src/index.ts:32-33
if(url.pathname.startsWith("/v1/chat/")&&(!publicApiEnabled||!profile.publicChat))return json({...code:"module_disabled"...},404);
if(request.method==="POST"&&url.pathname==="/v1/chat/conversations")return startNativeConversation(request,env,ctx);
```

"Live Chat" vs. "Send us a Message" is purely a **label**, computed by presence lookup, that the frontend reads from `GET /v1/chat/status` before the customer even submits — it does not affect which handler processes the submission:

```ts
// src/native-chat.ts:27-32
export async function nativeChatStatus(db:D1Database,now:string){
  const row=await db.prepare(`SELECT COUNT(*) ... WHERE r.active=1 AND p.available=1 AND p.expires_at>?`)...
  const live=Number(row?.count??0)>0;
  return {state:live?"live":"async",label:live?"Live Chat":"Send us a Message",...};
}
```

**No divergence — identical call path.**

**Caveat that matters for the "both tenants" part of this ticket:** a third inbound path exists — WhatsApp — which also lands in `persistThroughRoom` but never touches `sendOpsNotification`:

```ts
// src/whatsapp.ts:79-85
async function processInboundMessage(env: Env, message: WhatsAppInboundMessage, contact...) {
  ...
  await persistThroughRoom(env, conversationId, { senderKind: "customer", senderResponderId: null, body, clientMessageId: message.id });
}
```

And `moses`'s business profile has `publicChat:false` (`business-profiles.mts:40`), so `/v1/chat/*` is **404 `module_disabled`** for that tenant (`src/index.ts:32`). That means for `moses`, the native chat widget / message form doesn't exist at all — its only inbound customer channel today is WhatsApp, which never fires the Resend email regardless of thread state. Email notification is effectively unreachable for `moses`, not merely "only fires on new threads."

---

## Q3 — Web Push trigger scope

**Storage** — `push_subscriptions`, keyed by `responder_id` (a staff member), not by tenant:

```sql
-- migrations/0004_staff_web_push.sql:3-16
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL REFERENCES responders(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  active_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_success_at TEXT, last_failure_at TEXT, last_failure_code TEXT
);
```
Registered via `PUT /v1/internal/push/subscriptions` (`src/push.ts:24-34`).

**Send trigger** — `dispatchPushEvent` (`src/push.ts:79-109`), called from `StaffChatHub.deliver()`:

```ts
// src/chat-durable.ts:36
private async deliver(event:Record<string,unknown>){
  if(event.senderKind!=="customer")return;
  ...
  this.ctx.waitUntil(dispatchPushEvent(this.env,event as ...).catch(...));
}
```

`deliver()` is invoked by `ChatRoom.persist()` — **on every persisted message**, unconditionally of new-thread vs. follow-up:

```ts
// src/chat-durable.ts:20
const hub=this.env.CHAT_STAFF_HUB;
if(hub)await hub.getByName("staff-events").fetch("https://staff-hub/event",{method:"POST",...JSON.stringify({id:`message:${id}`,type:sequence===1?"conversation:new":"message:new",...})});
```

`persist()` is shared infra called from `native-chat.ts:43` (new thread), `native-chat.ts:57` (follow-up), and `whatsapp.ts:84` (WhatsApp inbound) — so push fires on **every customer message, on every channel**, gated only by `senderKind==="customer"` (`push.ts:80`, `chat-durable.ts:36`).

**Confirmed: push fires on a different (broader) event than email.** Email = new thread only, native-chat only. Push = every customer message, every channel.

---

## Q4 — Per-tenant recipient config

**Email (Resend):** single static address, `env.OPS_NOTIFY_EMAIL` (`ops-notify.ts:14,25`) — not sourced from `business-profiles.mts` at all. I checked both deployment configs' declared secrets:

```jsonc
// deployments/focus-lab/api.staging.jsonc:8
"secrets": {"required": ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]},
```
```jsonc
// deployments/moses-jorgensen/api.staging.jsonc:4
"secrets":{"required":["VAPID_PUBLIC_KEY","VAPID_PRIVATE_KEY","VAPID_SUBJECT","WHATSAPP_ACCESS_TOKEN","WHATSAPP_PHONE_NUMBER_ID","WHATSAPP_WEBHOOK_VERIFY_TOKEN","WHATSAPP_APP_SECRET"]},
```

Neither lists `RESEND_API_KEY`, `CUSTOMER_EMAIL_FROM`, or `OPS_NOTIFY_EMAIL`. Since `sendOpsNotification` no-ops (with only a `console.warn`) when any of those three env vars is absent (`ops-notify.ts:14-17`), and neither deployment declares them as required, the email path is most likely **dormant for both live deployments today**. This is inferred from config, not from a live secret listing — a secret can technically be set on a Worker without appearing in this file's `required` array, so certainty beyond this would require running `wrangler secret list --config <deployment>` against each, which was not done in this read-only pass.

**Push:** no static "recipient" exists — it's dynamic per-conversation staff routing via `routeResponders()`:

```ts
// src/push.ts:111-120
async function routeResponders(db,assignedResponderId,now){
  if(assignedResponderId)return{responderIds:[assignedResponderId],hasAvailable:false};
  const available=await db.prepare(`SELECT r.id FROM responders r JOIN responder_presence p ... WHERE r.active=1 AND p.available=1 AND p.expires_at>?`)...
  if(available.results.length)return{responderIds:available.results.map(r=>r.id),hasAvailable:true};
  const fallback=await db.prepare("SELECT id FROM responders WHERE active=1 AND role IN ('admin','manager') ...")...
  if(fallback.results.length)return{...};
  const active=await db.prepare("SELECT id FROM responders WHERE active=1 ...")...
  return{responderIds:active.results.map(r=>r.id),hasAvailable:false};
}
```
i.e. assigned responder → else all present/available responders → else admin/manager fallback → else all active responders. What *is* tenant-scoped already: `pushTopicPrefix` (`"fl"` vs `"mj"`, `business-profiles.mts:34,41`, used only for push-topic naming/collapsing) and separate `VAPID_KEYSET_ID` per deployment (`"focus-staging-existing"` vs `"moses-staging-2026-08-17"`) — so the push infra is already deployment-isolated per the repo's model, it just has no single "recipient email"-equivalent concept.

---

## Q5 — Email content

```ts
// src/ops-notify.ts:19-28
const preferences=[notification.replyEmail?"Email":null,notification.replySms?"Text":null,notification.replyCall?"Call":null].filter(Boolean).join(", ")||"None selected";
const text=`New message from ${notification.name}\n\n${notification.message}\n\nEmail: ${notification.email}\nPhone: ${notification.phone??"Not supplied"}\nReply preferences: ${preferences}`;
const response=await fetcher("https://api.resend.com/emails",{
  method:"POST",
  headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},
  body:JSON.stringify({
    from:env.CUSTOMER_EMAIL_FROM,to:[env.OPS_NOTIFY_EMAIL],
    subject:`New message from ${notification.name} — ${profile.shortName}`,
    text,
  }),
});
```

Subject: `New message from {name} — {shortName}`. Body (plain text, not HTML): full raw message text inline, plus name/email/phone/reply-preferences. **No conversation ID, no deep link, no staff console URL anywhere** — this is not a "preview + link" pattern, the entire message is embedded as text with nothing clickable back into the console.

---

## Q6 — Staff PWA domains (verified directly against configs, not assumed)

| Tenant | Env | Config file | `STAFF_HOSTNAME` | Custom domain route |
|---|---|---|---|---|
| focus | staging (deployment config) | `deployments/focus-lab/console.staging.jsonc:14` | `focus-lab-operations-staging.freedomgeneration1111.workers.dev` | **none in this file** |
| focus | staging (root config, `--env staging`) | `wrangler.jsonc:80-92,123` | `staff.focuslabproductions.com,focus-lab-operations-staging.freedomgeneration1111.workers.dev` | `routes: [{pattern:"staff.focuslabproductions.com", custom_domain:true}]` (`wrangler.jsonc:82-87`) |
| moses | staging | `deployments/moses-jorgensen/console.staging.jsonc:10` | `moses-operator-console-staging.freedomgeneration1111.workers.dev` | none — no `routes` key in this file at all |

Both `focus-lab-operations-staging` configs (root `wrangler.jsonc --env staging`, and `deployments/focus-lab/console.staging.jsonc`) deploy to the **same Worker name**, but only the root config's `env.staging` block actually carries the `staff.focuslabproductions.com` custom-domain route — exactly the split CLAUDE.md §2 warns about. `deployments/moses-jorgensen/RESOURCE_PLAN.md:14` explicitly says: *"Do not connect `moses-static.pages.dev` or `mosesjorgensen.com` during Sprint 2."* So `moses` has **no custom domain at all**, staging or otherwise — `staff.mosesjorgensen.com` does not exist anywhere in this codebase.

---

## Q7 — Existing capability flags

```ts
// business-profiles.mts:1-7
export type BusinessCapabilities={
  event:boolean; schedule:boolean; capacity:boolean; availability:boolean;
  whatsappChannel:boolean;
};
```
Plus two sibling booleans on `BusinessProfile` itself, same independent-per-tenant pattern: `publicEventInquiry`, `publicChat` (`business-profiles.mts:21,23`).

Current per-tenant values:
```ts
// business-profiles.mts:35  (focus)
capabilities:{event:true,schedule:true,capacity:true,availability:true,whatsappChannel:false},
// business-profiles.mts:42  (moses)
capabilities:{event:false,schedule:false,capacity:false,availability:false,whatsappChannel:true},
```

**Nothing for email or push exists today**, in `capabilities` or as a sibling boolean. Both channels are currently gated only by secret *presence*, not by a declarative flag:
```ts
// ops-notify.ts:14
if(!env.RESEND_API_KEY||!env.CUSTOMER_EMAIL_FROM||!env.OPS_NOTIFY_EMAIL){ ... return; }
// push.ts:129
function configured(env:Env){return Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);}
```
A `notifyEmail`/`notifyPush`-style capability, if wanted, would be new — it doesn't exist under any name today.

---

## Summary of gaps this surfaces for the implementation work

1. Email fires only on new-thread creation (native chat only); push fires on every customer message across all channels. Making email match push's "every message, every channel" behavior means moving the trigger out of `startNativeConversation` and into the shared `ChatRoom.persist()` path (or `StaffChatHub.deliver()`), and adding a WhatsApp call site.
2. `moses` can't currently receive the email notification at all — no `publicChat`, so no native-chat path ever runs `sendOpsNotification`.
3. `RESEND_API_KEY`/`CUSTOMER_EMAIL_FROM`/`OPS_NOTIFY_EMAIL` aren't declared as required secrets in either deployment config — the email path may be entirely unconfigured in both live staging Workers right now (would need `wrangler secret list` to confirm with certainty).
4. No deep link in the email; adding one needs a `CUSTOMER_CONVERSATION_ORIGIN`-style origin plus a staff console URL — and per Q6, which staff domain to link to differs by tenant/config (and focus has two live domains in parallel).
5. No capability flag gates either channel today — if per-tenant on/off control is wanted (independent of whether secrets happen to be provisioned), that's new surface in `business-profiles.mts`.
