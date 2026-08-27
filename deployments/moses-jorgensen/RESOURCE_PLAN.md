# Moses Operator OS deployment record

Provisioning status checked 2026-08-25:

- D1: `moses-operator-crm-staging` - provisioned, migrations 0001-0006 applied
- API Worker: `moses-operator-api-staging` - deployed; public native chat is live
- Console Worker: `moses-operator-console-staging` - deployed; final separate Access AUD configured
- API hostname: `moses-operator-api-staging.freedomgeneration1111.workers.dev`
- Console hostname: `moses-operator-console-staging.freedomgeneration1111.workers.dev`
- A separate Cloudflare Access self-hosted application protects the console hostname with a Moses-only AUD and exact-email policy
- Moses-only VAPID keypair and subject secrets on the API Worker; public key on the console Worker - generated/configured without committing private material
- Rate-limit namespaces `22003`, `22004`, and `22005` - accepted by Wrangler and deployed on the Moses API Worker
- Structured consulting inquiry persistence, provenance, and staff-console rendering are implemented on the shared Operator OS schema
- The protected public consulting route is implemented in source and requires a Moses Turnstile widget plus `TURNSTILE_SECRET_KEY` before the next API deployment

The active checked-in configs contain the isolated D1 and Access identifiers. The current production website still talks directly to the API for native chat. The redesigned website will use a same-origin public Worker facade and service binding. Do not move the `mosesjorgensen.com` production domain until its separate review Worker has been approved.
