# CLAUDE.md — operator-os

Operating rules for Claude Code in this repo. Read this fully before making changes — there's no separate `AGENTS.md` here, this is the one required read. `README.md` and `API.md` are shorter references; nothing here contradicts them, this is just more complete.

## 1. What this is

The canonical, business-neutral CRM/chat/scheduling Worker backend, extracted so multiple client businesses can run on the same codebase with **deployment-time, not runtime, isolation** — no tenant ID, no shared database, no shared Worker. Each business gets its own D1 database, its own Durable Object namespaces, its own Workers, deployed from its own config file. `business-profiles.mts` is the single source of truth for what a given deployment is allowed to do (`capabilities: {event, schedule, capacity, availability, whatsappChannel, opsNotifyEmail, opsNotifyPush}`), keyed by `BUSINESS_PROFILE`.

Two business profiles exist today:

| Key | Business | Status |
|---|---|---|
| `focus` | Focus Lab Productions | **Live.** Real customer traffic via the paired `Sunny-ops` repo. |
| `moses` | Moses Jorgensen (consulting) | `PUBLIC_API_ENABLED:"false"`, `publicChat:false` — no native chat/message-form traffic. Staff console **is live** at `staff.mosesjorgensen.com` (attached 2026-08-24). The API Worker (`moses-operator-api-staging`) has real deployments on record (`wrangler deployments list` — earliest 2026-08-17) contradicting any note that says "never deployed," but it's currently **un-deployable**: `deployments/moses-jorgensen/api.staging.jsonc` requires `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_WEBHOOK_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET` and none are provisioned (`wrangler secret list` confirms), so `wrangler deploy` hard-fails before upload. Whatever code shipped there on 2026-08-17 is what's still live — verify against current `src/` before assuming parity. |

Stack: TypeScript, Cloudflare Workers, D1, Durable Objects (`ChatRoom`, `StaffChatHub`), Zod-validated contracts, `jose` for Access JWT verification, Vitest (`@cloudflare/vitest-pool-workers`), a separate React/Vite staff PWA (`staff-app/`).

## 2. Deployment — read before touching

Every deployment target is its own config file under `deployments/<business>/`. **Never run a bare `wrangler deploy`** — always pass `--config`, and always use the npm scripts, which chain the right build step first where one is needed.

| Config | Worker | Purpose | Status |
|---|---|---|---|
| `deployments/focus-lab/api.staging.jsonc` | `focus-lab-api-staging` | Core API — chat, CRM, scheduling, availability. Service-bound from `Sunny-ops`' public site (`OPERATIONS_API`) and from the staff console (`CHAT_API`). | **Live.** "Staging" is a legacy name — this takes real customer traffic. |
| `deployments/focus-lab/console.staging.jsonc` | via `staff:build:focus:staging` + deploy | Staff PWA. | **Live**, bound to custom domain `staff.focuslabproductions.com` *and* the `workers.dev` route, kept in parallel during the transition. As of 2026-08-24 this file is the sole authoritative home for that route (see ADR-0004) — it previously lived only in root `wrangler.jsonc`'s `env.staging`, which was a live/deploy-config split; that route was removed from root `wrangler.jsonc` in the same pass. |
| Root `wrangler.jsonc` (no `--config`, or `--env staging`) | `focus-lab-operations` / `focus-lab-operations-staging` | Local dev config. Its `env.staging` block still exists and targets the same Worker name as `deployments/focus-lab/console.staging.jsonc`, but no longer carries the custom-domain route — don't re-add it there. | Legacy/local-dev; not the deploy path the npm scripts use. |
| `deployments/moses-jorgensen/api.staging.jsonc` | `moses-operator-api-staging` | Moses profile's API. | Has real deployments on record but is **currently un-deployable** — required WhatsApp secrets are missing. See the profile table above. |
| `deployments/moses-jorgensen/console.staging.jsonc` | via `staff:build:moses:staging` + deploy | Moses profile's staff console. | **Live**, bound to custom domain `staff.mosesjorgensen.com` (attached 2026-08-24, see ADR-0004) *and* the `workers.dev` route. |

```bash
npm run focus:staging:deploy:api        # core API
npm run focus:staging:deploy:console    # staff PWA (builds first)
npm run focus:staging:migrate           # D1 migrations, --remote
```

Deploying anything is a real, hard-to-reverse action against a live system with real customer data behind it. Don't deploy without explicit instruction, and **verify live after deploying** — curl the endpoint, check a version ID, don't just trust a clean build.

## 3. The paired frontend repo

The public-facing site and its `/v1/*` proxy live in a **separate repo**: `/home/moses/projects/Sunny-ops`. It has its own `CLAUDE.md`/`AGENTS.md`. Changes to request/response shapes here need to stay compatible with what that repo's `lib/operations-api.ts` expects — check there before changing a contract. Do not attempt to build or modify the frontend from inside this repo.

## 4. Secrets and D1

- Never commit secrets. `wrangler secret put <NAME> --config <deployment-config>` for anything real; `.dev.vars` (gitignored) for local.
- `wrangler d1 migrations apply <db-name> --remote --config <deployment-config>` applies migrations independently of a Worker code deploy — the two are not coupled. Don't assume a fresh code deploy means the schema is current, or vice versa; check both.
- `focuslab-crm-staging` is the live D1 database despite the name. `moses-operator-crm-staging` exists but is unused.

## 5. Testing

```bash
npm run test:operations          # Vitest, core Worker logic
npm run test:config-isolation    # cross-tenant isolation invariants — run this if you touch business-profiles.mts or any deployment config
npm run typecheck
npm run lint
npm run staff:typecheck && npm run staff:lint && npm run staff:test
npm run test:staff:e2e           # Playwright, staff PWA
```

`test:config-isolation` exists specifically to catch a Focus/Moses resource or security-identifier leak — it's cheap, run it whenever the deployment-isolation model itself is at risk, not just when you think you broke it.

## 6. Known open items

- **ADR-0001 (Google Calendar availability checking) is deferred indefinitely.** `Check Availability` on the public site routes through the messaging system, not automated calendar sync. `GET /v1/availability` degrades to `status:"unknown"` by design (cache-read only, secrets never provisioned) — don't "fix" this without checking `Sunny-ops/known-open-items.md` first, it's a deliberate product decision, not a bug.
- `staff-app/src/lib/business-profile.test.ts` has had known-failing tests tied to capability-flag changes landing without a matching test update — check current state before assuming a red test here is your fault.

## 7. Keeping this file honest

If you discover this file is wrong or led you to a mistake, fix the underlying issue **and** correct this file in the same session. One source of truth per topic — extend this file rather than writing a second doc that will drift from it.
