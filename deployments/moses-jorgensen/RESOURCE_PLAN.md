# Moses Operator OS staging resource plan

Provisioning status as of 2026-08-17:

- D1: `moses-operator-crm-staging` - provisioned, migrations 0001-0006 applied
- API Worker: `moses-operator-api-staging` - deployed with public intake/chat disabled
- Console Worker: `moses-operator-console-staging` - pending the separate Access application/AUD
- API hostname: `moses-operator-api-staging.freedomgeneration1111.workers.dev`
- Console hostname: `moses-operator-console-staging.freedomgeneration1111.workers.dev`
- A separate Cloudflare Access self-hosted application protecting the console hostname, with a new Moses-only AUD - dashboard action pending because the current OAuth grant is Access read-only
- Moses-only VAPID keypair and subject secrets on the API Worker; public key on the console Worker - generated/configured without committing private material
- Rate-limit namespaces `22003` and `22004` - accepted by Wrangler and deployed on the Moses API Worker

The checked-in configuration contains the provisioned D1 ID but intentionally retains the fail-closed Access AUD placeholder until the separate application is created. Public intake and public chat are disabled. Do not connect `moses-static.pages.dev` or `mosesjorgensen.com` during Sprint 2.
