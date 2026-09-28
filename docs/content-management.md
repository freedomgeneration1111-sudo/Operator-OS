# Focus website content management

The first CMS slice stores Focus pricing and common/pricing FAQ drafts in a dedicated D1 binding (`CMS_DB`). It does not share tables or migrations with the CRM `DB`, does not add runtime tenant selection, and is disabled unless both the deployment-time Focus capability and `CMS_ENABLED=true` are present. The console Worker proxies CMS requests to the API Worker; only the API owns `CMS_DB`.

Managers and admins receive the single `website:manage` permission. That permission gates reads, initialization, edits, restore, snapshot export, and is reserved for future publish actions. Responders do not receive it. Access is assigned by the existing `responders.role` value; no second login or approval role exists.

## Local setup

```bash
npx wrangler d1 migrations apply focus-lab-operations-local --local --config wrangler.jsonc
npx wrangler d1 execute focus-lab-operations-local --local --config wrangler.jsonc --file seeds/development.sql
npx wrangler d1 migrations apply focus-lab-cms-local --local --config wrangler.jsonc
npm run staff:dev
# In another terminal:
npx wrangler dev --config wrangler.jsonc --var INTERNAL_API_TOKEN:focus-cms-local-test-token
```

From the Sunny repository, explicitly initialize without overwriting existing drafts:

```bash
OPERATOR_OS_TOKEN=focus-cms-local-test-token OPERATOR_OS_RESPONDER_ID=rsp_dev_b \
  npm run cms:initialize -- --api http://127.0.0.1:8787
```

The initialization endpoint inserts only missing documents. Re-running it returns the existing current revisions unchanged. Every save appends an actor/timestamp revision and requires the current revision ID; stale saves return `409 cms_revision_conflict`. Restore copies an old document into a new revision.

## Remote configuration required later

No remote CMS database was provisioned in this milestone. Before a later deploy, create a Focus-only D1 database (recommended name `focuslab-cms-staging`), then add its real UUID as a `CMS_DB` binding in `deployments/focus-lab/api.staging.jsonc` with `migrations_dir: "../../cms-migrations"`. Apply `cms-migrations` to that database independently, set `CMS_ENABLED` to `true`, and only then deploy/verify the API and console. Do not add the binding to Moses or to the console config.

Current scope is draft pricing and common/pricing FAQs plus immutable authenticated snapshot export. Saving is not publishing. Release orchestration, immutable release retention, deployment status, rollback, and broader page/media/SEO/navigation content belong to the next milestones.
