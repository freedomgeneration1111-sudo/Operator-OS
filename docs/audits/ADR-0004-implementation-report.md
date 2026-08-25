# ADR-0004 Implementation Report — Staff Fallback Notification Parity

Implements `docs/adr/ADR-0004-staff-fallback-notifications.md`. Worked
through the six sections of the implementation prompt in order, verifying
each before moving to the next. Every claim below is backed by real
command output captured during this pass — no summarized assumptions.

## Section 1 — Reconcile `staff.mosesjorgensen.com` config

**Live check (before touching anything):**
```
$ curl -I --max-time 10 https://staff.mosesjorgensen.com
HTTP/2 302
location: https://freedomgeneration1111.cloudflareaccess.com/cdn-cgi/access/login/staff.mosesjorgensen.com?kid=155a76ec90ab8c6acf9f86583b8975d8a379696e84b9ddb41a0b5a9157ba354b&...
```
`kid=155a76ec9...` matches `moses`'s `ACCESS_AUD` exactly
(`deployments/moses-jorgensen/api.staging.jsonc`), confirming the domain
was live and correctly wired to the right Access application, not just
DNS-resolving to *some* zone.

**Config consolidation.** `deployments/focus-lab/console.staging.jsonc`
is the config the npm scripts actually deploy
(`focus:staging:deploy:console`), but it was missing the custom-domain
route (which lived only in root `wrangler.jsonc`'s `env.staging`) *and*
`staff.focuslabproductions.com` in its `STAFF_HOSTNAME` var. That second
gap was a real latent bug: `src/index.ts:53`'s `isStaffAssetHost()` gates
PWA asset-serving on `STAFF_HOSTNAME`, so redeploying via the documented
npm script as it stood would have stopped serving the app on the custom
domain even though the route itself would remain attached.

Fixed by:
- Adding `"routes":[{"pattern":"staff.focuslabproductions.com","custom_domain":true}]` to `deployments/focus-lab/console.staging.jsonc`, and updating its `STAFF_HOSTNAME` to include both hostnames.
- Removing the `routes` block from root `wrangler.jsonc`'s `env.staging`.
- Adding the equivalent `routes` + fixed `STAFF_HOSTNAME` to `deployments/moses-jorgensen/console.staging.jsonc` (which had no `routes` key at all before).

**Deployed and verified both:**
```
$ npm run focus:staging:deploy:console
...
Uploaded focus-lab-operations-staging (17.08 sec)
Deployed focus-lab-operations-staging triggers (6.83 sec)
  https://focus-lab-operations-staging.freedomgeneration1111.workers.dev
  staff.focuslabproductions.com (custom domain)
Current Version ID: c444657c-b01d-4ad7-9a38-62f29f6ef018

$ curl -s -o /dev/null -w "%{http_code}\n" https://staff.focuslabproductions.com
302   # unchanged, still healthy post-deploy

$ npm run moses:staging:deploy:console
...
Uploaded moses-operator-console-staging (19.35 sec)
Deployed moses-operator-console-staging triggers (6.85 sec)
  https://moses-operator-console-staging.freedomgeneration1111.workers.dev
  staff.mosesjorgensen.com (custom domain)
Current Version ID: a3511bb7-1d53-466a-beee-b2e1dda7a2a3

$ curl -s -o /dev/null -w "HTTP status: %{http_code}\n" --max-time 15 https://staff.mosesjorgensen.com
HTTP status: 302
```
Both custom domains are live, both deploys reconciled cleanly against
existing Cloudflare state (no conflict errors), and `CLAUDE.md` has been
corrected to reflect this (see "CLAUDE.md corrections" below).

## Section 2 — Capability flags

Added to `business-profiles.mts`:
```ts
export type BusinessCapabilities={
  event:boolean; schedule:boolean; capacity:boolean; availability:boolean;
  whatsappChannel:boolean;
  opsNotifyEmail:boolean;
  opsNotifyPush:boolean;
};
```
Set `opsNotifyEmail:true,opsNotifyPush:true` for both `focus` and
`moses`. Also gated `dispatchPushEvent` (`src/push.ts`) on
`opsNotifyPush`, since the ADR's "these become the source of truth for
whether a channel is active" applies to push as much as email — push was
previously gated only on secret presence, same implicit pattern the ADR
flagged as a problem for email.

## Section 3 — Relocate the email trigger

Moved the Resend dispatch out of `startNativeConversation`
(`src/native-chat.ts`) and into `StaffChatHub.deliver()`
(`src/chat-durable.ts`), right alongside the existing `dispatchPushEvent`
call, same `senderKind==="customer"` gate. `sendOpsNotification` (which
took form-submission fields directly) was replaced with
`dispatchOpsNotificationEmail(env,event)`, which looks up the contact,
reply preferences, and message body from D1 by `conversationId`/`sequence`
— because `deliver()` only has the lightweight hub event, not the raw
form fields, and now needs to run for WhatsApp-sourced messages too where
those form fields never existed in the first place.

**Live proof this now fires on both new threads and follow-ups** (it
previously fired only on new threads): sent two real messages to the live
`focus-lab-api-staging` Worker while tailing its logs.

```
$ curl -s -X POST https://focus-lab-api-staging.freedomgeneration1111.workers.dev/v1/chat/conversations \
  -d '{"name":"ADR-0004 Test Customer","email":"adr0004-test@example.test","phone":"555-0199",
       "message":"ADR-0004 live test — new thread","clientMessageId":"adr0004-test-...-001",
       "replyEmail":true,"replySms":false,"replyCall":false}'
{"ok":true,"conversation":{"id":"cc3467f2-2aea-43a0-a239-8c52a5f4df65","resumeToken":"d1d4d9...","mode":"async"},
 "message":{"sequence":1,"sender_kind":"customer","body":"ADR-0004 live test — new thread",...}}

$ curl -s -X POST ".../v1/chat/conversations/cc3467f2-2aea-43a0-a239-8c52a5f4df65/messages" \
  -H "X-Chat-Resume-Token: d1d4d9..." \
  -d '{"body":"ADR-0004 live test — follow-up message","clientMessageId":"adr0004-test-...-002"}'
{"ok":true,"message":{"sequence":2,"sender_kind":"customer","body":"ADR-0004 live test — follow-up message",...}}
```

`wrangler tail` output for both requests:
```
POST https://chat-room/message?conversationId=REDACTED - Ok @ 8/24/2026, 8:23:01 AM
POST .../v1/chat/conversations - Ok @ 8/24/2026, 8:22:59 AM
POST https://staff-hub/event - Ok @ 8/24/2026, 8:23:01 AM
  (warn) {"message":"ops notification skipped: not configured","conversationId":"cc3467f2-2aea-43a0-a239-8c52a5f4df65"}
POST https://chat-room/message?conversationId=REDACTED - Ok @ 8/24/2026, 8:23:10 AM
POST .../v1/chat/conversations/REDACTED/messages - Ok @ 8/24/2026, 8:23:10 AM
POST https://staff-hub/event - Ok @ 8/24/2026, 8:23:10 AM
  (warn) {"message":"ops notification skipped: not configured","conversationId":"cc3467f2-2aea-43a0-a239-8c52a5f4df65"}
```
Both the new-thread message (sequence 1) **and** the follow-up (sequence
2) reached `dispatchOpsNotificationEmail` and logged the same
"not configured" skip — proof the relocation works; it stopped at the
Resend-secrets check, not before it, which is exactly the scope-parity
change this section asked for. (Why it stops there is Section 5.)

WhatsApp inbound already shares this same `persist()` → `deliver()` path
(`src/whatsapp.ts:84`), so it gets this trigger "for free" by
construction — not independently live-tested here because the `moses`
API Worker deploy is blocked (Section 5/6).

## Section 4 — Per-tenant recipient and deep link

**Mechanism decision.** The prompt left the choice open between hardcoding
in `business-profiles.mts` vs. a per-deployment secret. Neither fit
cleanly: an email address isn't sensitive enough to warrant
`wrangler secret put`, and this repo's own pattern for genuinely
per-tenant *operational* values (`VAPID_KEYSET_ID`, `ACCESS_AUD`,
`BUSINESS_TIMEZONE`) is a plain `vars` entry in each deployment's
`api.staging.jsonc`, not a secret and not a hardcoded business-profile
field. Went with that: `OPS_NOTIFY_EMAIL` and the new `STAFF_CONSOLE_ORIGIN`
are now plain per-tenant `vars`:
- `deployments/focus-lab/api.staging.jsonc`: `OPS_NOTIFY_EMAIL:"focuslabproductions@gmail.com"`, `STAFF_CONSOLE_ORIGIN:"https://staff.focuslabproductions.com"`
- `deployments/moses-jorgensen/api.staging.jsonc`: `OPS_NOTIFY_EMAIL:"freedomgeneration1111@gmail.com"`, `STAFF_CONSOLE_ORIGIN:"https://staff.mosesjorgensen.com"`

Confirmed live on the focus deploy (moses deploy is blocked, see
Section 5):
```
env.OPS_NOTIFY_EMAIL ("focuslabproductions@gmail.com")                                 Environment Variable
env.STAFF_CONSOLE_ORIGIN ("https://staff.focuslabproductions.com")                     Environment Variable
```

**Deep link.** `dispatchOpsNotificationEmail` now builds
`${STAFF_CONSOLE_ORIGIN}/#/chat?conversation=${conversationId}` (same
route shape the existing push payload already uses,
`src/push.ts:126`) and appends it to the email body when
`STAFF_CONSOLE_ORIGIN` is configured, alongside the existing
message/contact/reply-preference text. Covered by
`test/ops-notify.test.ts` ("sends a Resend email with customer details,
reply preferences, and a staff console deep link" / "omits the deep link
when STAFF_CONSOLE_ORIGIN is not configured").

## Section 5 — Verify and provision secrets

```
$ npx wrangler secret list --config deployments/focus-lab/api.staging.jsonc
[
  {"name": "TURNSTILE_SECRET_KEY", "type": "secret_text"},
  {"name": "VAPID_PRIVATE_KEY", "type": "secret_text"},
  {"name": "VAPID_PUBLIC_KEY", "type": "secret_text"},
  {"name": "VAPID_SUBJECT", "type": "secret_text"}
]

$ npx wrangler secret list --config deployments/moses-jorgensen/api.staging.jsonc
[
  {"name": "VAPID_PRIVATE_KEY", "type": "secret_text"},
  {"name": "VAPID_PUBLIC_KEY", "type": "secret_text"},
  {"name": "VAPID_SUBJECT", "type": "secret_text"}
]
```

**`RESEND_API_KEY` and `CUSTOMER_EMAIL_FROM` are absent on both Workers.**
This confirms what the pre-implementation audit could only infer from
config files. I asked the user directly whether real values were
available to provision; the answer was **ship dormant, document it** — do
not fabricate a key or sending identity. `dispatchOpsNotificationEmail`
already degrades safely without them (the "not configured" skip seen live
in Section 3), matching the exact behavior the original
`sendOpsNotification` had. **This is the one open item blocking real email
delivery on both tenants** — needs a real Resend account + a verified
sending address before the feature is functionally live, not just
code-complete.

**Second, unplanned finding:** attempting to deploy `moses-operator-api-staging`
to pick up the Section 2/3/4 code changes failed outright:
```
$ npm run moses:staging:deploy:api
...
✘ [ERROR] The following required secrets have not been set: WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WEBHOOK_VERIFY_TOKEN
```
`deployments/moses-jorgensen/api.staging.jsonc` declares these as
`secrets.required`, and wrangler enforces that list at deploy time — this
isn't just documentation, it's a hard gate. None of the four are
provisioned (confirmed by the `secret list` output above), and I have no
real WhatsApp Business API credentials to supply, so this Worker's deploy
is blocked independent of anything in this ADR. `wrangler deployments list`
shows it *has* shipped before (earliest 2026-08-17), which directly
contradicts `CLAUDE.md`'s prior "never deployed" note — corrected below.
Whatever shipped on 2026-08-17 is what's still live; **the Section 2/3/4
code changes are in the repo but not deployed to `moses-operator-api-staging`.**

I did not attempt to work around this (no fake secret values, no
loosening the `required` list) — same "don't fabricate, document it"
treatment as the Resend gap.

## Section 6 — Test

**`focus`, native chat, new thread + follow-up:** see Section 3's live
transcript — both messages were accepted (`201`), persisted, and both
triggered the relocated email dispatch (correctly no-op'd without
Resend secrets).

**Push — confirmed with real delivery, not just dispatch:**
```
$ npx wrangler d1 execute focuslab-crm-staging --remote --config deployments/focus-lab/api.staging.jsonc \
  --command "SELECT event_id,subscription_id,notification_type,status,response_status FROM push_deliveries WHERE conversation_id='cc3467f2-2aea-43a0-a239-8c52a5f4df65'"
[
  {"event_id":"message:a40f...","subscription_id":"e39c...","notification_type":"async_message","status":"sent","response_status":201},
  {"event_id":"message:a40f...","subscription_id":"0d99...","notification_type":"async_message","status":"sent","response_status":201},
  {"event_id":"message:6c10...","subscription_id":"e39c...","notification_type":"message","status":"sent","response_status":201},
  {"event_id":"message:6c10...","subscription_id":"0d99...","notification_type":"message","status":"sent","response_status":201}
]
```
Both the new thread and the follow-up produced `status:"sent"` /
`response_status:201` to two real, already-registered push subscriptions
belonging to responder `rsp_dev_c` ("Test Responder C", admin role — the
admin/manager fallback path in `routeResponders()` picked it up since the
test conversation was unassigned and no one had live presence). **This
sent two real push notifications to a real registered device** as a side
effect of this test — worth knowing if that device is still in someone's
hands, since the titles were "New Focus Lab message" for both.

D1 round-trip confirmed:
```
conversations:        id=cc3467f2..., provider=native_web, channel_state=open, reply_email=1
conversation_messages: [seq 1, customer, "ADR-0004 live test — new thread"]
                        [seq 2, customer, "ADR-0004 live test — follow-up message"]
```

**Deep link — not independently live-verified.** The email itself never
sent (Section 5), so the deep-link string wasn't observed in a real inbox;
its correctness rests on the unit tests in `test/ops-notify.test.ts`,
which assert the exact `https://staff.example.test/#/chat?conversation=<id>`
shape against a live D1-backed conversation. Once `RESEND_API_KEY`/
`CUSTOMER_EMAIL_FROM` are provisioned, a repeat of the Section 3 test
against `staff.focuslabproductions.com`/`staff.mosesjorgensen.com` would
give real end-to-end confirmation.

**`focus`, WhatsApp:** N/A — `focus`'s `whatsappChannel` capability is
`false`. Not applicable per "where each channel applies."

**`moses`, native chat:** N/A — `moses`'s `publicChat` capability is
`false`; `/v1/chat/*` 404s (`module_disabled`) for this tenant by design.
Not applicable per "where each channel applies."

**`moses`, WhatsApp:** **Not tested — blocked, not skipped.** Two
independent blockers, either one alone would be sufficient: (1) the API
Worker holding this tenant's `ChatRoom`/`StaffChatHub`/webhook handler
can't be deployed at all (Section 5), so even if a webhook arrived, it
would hit whatever code shipped 2026-08-17, not this session's changes;
(2) simulating an inbound WhatsApp webhook requires a valid
`X-Hub-Signature-256` HMAC computed from the real `WHATSAPP_APP_SECRET`
(`src/whatsapp.ts:121-128`), which doesn't exist as a provisioned secret
and which I have no real value for — it can't be forged.

**Domains tested against:** both real custom domains,
`staff.focuslabproductions.com` and `staff.mosesjorgensen.com` — both
confirmed live post-deploy (Section 1). The chat/message-send testing
itself went through `focus-lab-api-staging.freedomgeneration1111.workers.dev`
directly (the API Worker's own domain — there's no public-facing chat
widget hosted on the staff custom domain to click through; that lives in
the separate `Sunny-ops` repo).

## Verification run before any deploy

```
$ npm run typecheck        # clean
$ npm run lint              # clean (0 errors, 0 warnings)
$ npm run test:operations   # 141/141 passed (was 138 before this session; +3 new ops-notify tests net of the 3 removed old ones, plus overlap)
$ npm run test:config-isolation   # 3/3 passed
$ npm run staff:typecheck   # clean
$ npm run staff:lint        # clean
$ npm run staff:test        # 32/32 passed
```
`staff-app/src/lib/business-profile.test.ts` needed a fix independent of
this ADR: its `toEqual` assertions were already stale before this session
(missing `availability`/`whatsappChannel` from the ADR-0003 WhatsApp
work — the exact "known-failing tests tied to capability-flag changes"
pattern `CLAUDE.md` already warns about). Fixed in the same edit that
added the two new flags.

## CLAUDE.md corrections

Per its own §7 ("if you discover this file is wrong... fix it in the same
session"):
- §1's capability list was stale (`{event, schedule, capacity, availability}`, missing `whatsappChannel` from ADR-0003 and now `opsNotifyEmail`/`opsNotifyPush`) — updated.
- The `moses` row said "Never deployed" — false; `wrangler deployments list` shows real deployments from 2026-08-17. Corrected to describe the actual current state: console live with a real custom domain, API Worker un-deployable pending WhatsApp secrets.
- §2's config table updated: `deployments/focus-lab/console.staging.jsonc` is now the sole authoritative home for the `staff.focuslabproductions.com` route (previously only in root `wrangler.jsonc`); `deployments/moses-jorgensen/console.staging.jsonc` is now marked live with its own custom domain.

## What's still open

1. **`RESEND_API_KEY` / `CUSTOMER_EMAIL_FROM`** — not provisioned on either tenant. Email notification is code-complete and live-deployed (on `focus`) but functionally dormant until a real Resend account + verified sending address exist. Explicit user decision: ship dormant.
2. **`moses`'s four WhatsApp secrets** — not provisioned; blocks *any* deploy to `moses-operator-api-staging`, not just this ADR's changes. Pre-existing condition, not caused by this work, but it means `moses` doesn't yet have the Section 2/3/4 changes live at all.
3. Once (1) is resolved, re-run the Section 3 live test and confirm the actual received email contains a working deep link into `staff.focuslabproductions.com` / `staff.mosesjorgensen.com`.
4. Once (2) is resolved, redeploy `moses-operator-api-staging` and test the WhatsApp inbound path for real (a real inbound WhatsApp message, or a webhook call signed with the real `WHATSAPP_APP_SECRET`).
