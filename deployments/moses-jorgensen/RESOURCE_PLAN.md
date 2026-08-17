# Moses Operator OS staging resource plan

Provisioning status as of 2026-08-17:

- D1: `moses-operator-crm-staging` - provisioned, migrations 0001-0006 applied
- API Worker: `moses-operator-api-staging` - deployed with public intake/chat disabled
- Console Worker: `moses-operator-console-staging` - deployed; final separate Access AUD configured
- API hostname: `moses-operator-api-staging.freedomgeneration1111.workers.dev`
- Console hostname: `moses-operator-console-staging.freedomgeneration1111.workers.dev`
- A separate Cloudflare Access self-hosted application protects the console hostname with a Moses-only AUD and exact-email policy
- Moses-only VAPID keypair and subject secrets on the API Worker; public key on the console Worker - generated/configured without committing private material
- Rate-limit namespaces `22003` and `22004` - accepted by Wrangler and deployed on the Moses API Worker

The active checked-in configs contain the final isolated D1 and Access identifiers. Public intake and public chat remain disabled. Do not connect `moses-static.pages.dev` or `mosesjorgensen.com` during Sprint 2.
