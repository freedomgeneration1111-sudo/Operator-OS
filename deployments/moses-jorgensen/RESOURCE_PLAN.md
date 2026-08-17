# Moses Operator OS staging resource plan

Proposed, not provisioned or deployed:

- D1: `moses-operator-crm-staging`
- API Worker: `moses-operator-api-staging`
- Console Worker: `moses-operator-console-staging`
- API hostname: `moses-operator-api-staging.freedomgeneration1111.workers.dev`
- Console hostname: `moses-operator-console-staging.freedomgeneration1111.workers.dev`
- A separate Cloudflare Access self-hosted application protecting the console hostname, with a new Moses-only AUD
- Moses-only VAPID keypair and subject secrets on the API Worker; public key on the console Worker
- Rate-limit namespaces `22003` and `22004`, subject to approval

The template intentionally contains a placeholder D1 ID and Access AUD and has no deploy script. Public intake and public chat are disabled. Do not connect `moses-static.pages.dev` or `mosesjorgensen.com` during Sprint 2.
