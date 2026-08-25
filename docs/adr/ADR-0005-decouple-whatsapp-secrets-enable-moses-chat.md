# ADR-0005: Decouple Channel Secrets from Deploy Gate; Enable Native Chat for Moses

## Status
Proposed

## Context

The ADR-0004 implementation pass surfaced a blocker outside that ADR's
own scope: `moses-operator-api-staging` cannot be deployed at all.
`deployments/moses-jorgensen/api.staging.jsonc` lists all four WhatsApp
secrets (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) as
`secrets.required`, and wrangler enforces that list as a hard gate at
deploy time. None of the four are provisioned — blocked on Meta/Facebook
Developer account verification, an external, ongoing, indefinite
process.

The practical effect: not just WhatsApp, but *any* change to this
Worker is stuck. ADR-0004's relocated email/push trigger and new
capability flags are already committed to the repo but were never
deployed to moses's API Worker for this reason.

Separately, `moses`'s business profile has `publicChat:false` — native
chat (live chat widget and the async message form) is off for this
tenant by design, scoped that way under ADR-0003 when moses was
WhatsApp-only.

moses's public site (Jorgensen Service Co., a real consulting business,
not an internal test tenant) needs a working way for visitors to reach
out now, independent of when Meta's verification eventually clears.

## Decision

1. **Make WhatsApp secret presence a runtime check, not a deploy-time
   requirement**, for the moses API Worker. Remove the four
   `WHATSAPP_*` entries from `secrets.required` in
   `deployments/moses-jorgensen/api.staging.jsonc`. The WhatsApp webhook
   route should degrade gracefully — a clean, documented error response,
   not a crash — if hit while unconfigured, matching the same
   skip-and-log pattern already used for ops-notify and push elsewhere
   in this codebase.
2. **Flip `publicChat:true` for `moses`** in `business-profiles.mts`,
   enabling native chat (live chat and the message form both) for this
   tenant, alongside its existing `whatsappChannel:true`. Both channels
   can be live simultaneously — nothing about this requires them to be
   mutually exclusive.
3. **Redeploy `moses-operator-api-staging`** with these changes plus
   everything already committed under ADR-0004.
4. WhatsApp remains fully built and stays in the codebase. It will
   activate automatically once real Meta credentials exist — this ADR
   doesn't remove or delay that work, it stops that work from blocking
   everything else in the meantime.

## Consequences

- moses gets a working, testable native chat and fallback-notification
  path today, instead of waiting on an external process with no
  committed timeline.
- The general principle here — a channel's own readiness shouldn't gate
  the whole Worker's deploys — is worth applying to any future channel
  too, not treated as a WhatsApp-specific carve-out.
- `secrets.required` in a deployment config is no longer a complete
  list of "everything this Worker needs to function," just "everything
  required to deploy." Worth a short comment in the config itself so a
  future reader doesn't conflate the two.

## Out of scope

- Actually resolving Meta/WhatsApp Developer verification — separate,
  ongoing, external.
- Adding the chat widget to the Jorgensen Service Co. site's frontend —
  separate follow-up, pending confirmation of which repo/stack that
  site is built on.
