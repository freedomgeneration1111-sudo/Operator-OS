# Focus website content management

The Focus CMS stores pricing and common/pricing FAQ drafts in a dedicated D1 binding (`CMS_DB`). It does not share tables or migrations with the CRM `DB`, does not add runtime tenant selection, and is disabled unless the deployment-time Focus capability, `CMS_ENABLED=true`, and `CMS_DB` are all present. The console proxies human CMS requests to the API Worker; only the API owns CMS data and publication credentials.

Managers and admins receive the single `website:manage` permission. It gates drafts, history, restore, snapshot export, publish, and rollback. Responders do not receive it. Access still comes from the existing `responders.role`; there is no second login, publisher role, approval chain, or change to CRM permissions.

## Draft, release, and live state

- Unsaved form input exists only in the staff browser. It is never exported or published.
- A saved draft is the current immutable pricing revision plus FAQ revision. Saves remain optimistic-concurrency checked; restores append a new draft revision.
- A release atomically captures those two saved revisions, the complete validated snapshot and SHA-256 hash, actor, request time, and a unique request ID. Later draft edits cannot change it.
- `queued`, `building`, and `deploying` are active states. D1's unique `active_slot` permits at most one publish or rollback operation at once. Request-ID retries return the original operation and do not invoke the deploy hook twice.
- `live` means the authenticated build runner reported a successful Wrangler mutation and then independently verified that the exact expected Worker version is the sole active version at 100% traffic. `failed` is terminal. A failed operation never changes `cms_publication_state.current_live_release_id`.
- Multiple historical operations can retain `status=live`; the singleton live pointer identifies the release currently serving. This preserves prior successful releases as rollback candidates.

Publish and rollback use the existing `website:manage` capability. Rollback creates a new operation referencing a previous successful release and its recorded Worker version. It does not modify either current CMS draft. Releases without a verified Worker version cannot be rolled back.

## Publication protocol

1. `POST /v1/internal/cms/releases/publish` atomically records a queued immutable release.
2. Operator-OS POSTs the server-only `CMS_DEPLOY_HOOK_URL`, then attaches Cloudflare's returned build UUID. Hook failure marks the operation failed.
3. The Workers Builds runner authenticates to `/v1/cms-runner/*` with `Authorization: Bearer <CMS_RUNNER_SECRET>`. It does not use Cloudflare Access or development responder headers. Secret digests are compared with Workers `crypto.subtle.timingSafeEqual`.
4. The runner claims only the queued release assigned to its exact `WORKERS_CI_BUILD_UUID`. A bounded retry covers the short race between a build starting and the hook response being recorded; it cannot claim a later release.
5. Sunny materializes that release's snapshot. Publish performs the existing strict snapshot build; rollback does not build or substitute new site output.
6. Publish uses `wrangler deploy`. Rollback uses Wrangler 4.120's exact, noninteractive `wrangler versions deploy <historical-version>@100% --config wrangler.staging.jsonc --message ... --yes`.
7. After either mutating command exits successfully, the runner uses read-only `wrangler deployments list --json` and requires the expected version to be the sole active version at 100% traffic before reporting `live`.

The remote-mutation boundary is strict: before the mutating command succeeds, a genuine build or command failure can transition the operation to `failed`. Once that command exits successfully, missing or malformed structured output, absent metadata, inconclusive active-version verification, and final callback failure must leave the operation active in `deploying`. The runner must not report `failed` or release `active_slot` because the public Worker may already have changed.

`source_git_sha` identifies the source represented by the deployed release. `runner_source_git_sha` separately identifies the current runner/orchestration code. They are normally identical for publish. Rollback copies `source_git_sha` from the historical release, preserving null when historical provenance is unknown, while recording the current `WORKERS_CI_COMMIT_SHA` only as `runner_source_git_sha`.

The hook URL and runner secret never enter the staff application or public bundle. Error messages stored for staff are bounded and never include request headers or credentials.

## Local setup and verification

```bash
npx wrangler d1 migrations apply focus-lab-operations-local --local --config wrangler.jsonc
npx wrangler d1 execute focus-lab-operations-local --local --config wrangler.jsonc --file seeds/development.sql
npx wrangler d1 migrations apply focus-lab-cms-local --local --config wrangler.jsonc
npm run staff:dev
# In another terminal:
npx wrangler dev --config wrangler.jsonc --var INTERNAL_API_TOKEN:focus-cms-local-test-token
```

From Sunny, initialization remains idempotent:

```bash
OPERATOR_OS_TOKEN=focus-cms-local-test-token OPERATOR_OS_RESPONDER_ID=rsp_dev_b \
  npm run cms:initialize -- --api http://127.0.0.1:8787
```

The release runner is fully testable without Cloudflare mutation through Sunny's `npm run test:lib`; its tests mock both the deploy hook API and Wrangler command. The real Workers Builds commands are documented in Sunny's canonical publication document.

## Remote configuration required before first publication

No remote CMS resource or hook was created by this milestone. A later authorized setup must:

1. Create a Focus-only D1 database (recommended `focuslab-cms-staging`), add its real UUID as `CMS_DB` in `deployments/focus-lab/api.staging.jsonc` with `migrations_dir: "../../cms-migrations"`, and apply all `cms-migrations` independently. Do not add it to Moses or the console Worker.
2. Set `CMS_ENABLED=true` only on the Focus API after the binding exists.
3. Create a Workers Builds project/deploy hook for the reviewed Sunny repository and `feat/focus-cms-foundation` (or the later approved release branch). Set the build command to `npm run cms:release:build` and deploy command to `npm run cms:release:deploy`.
4. Store the hook URL as the Operator-OS secret `CMS_DEPLOY_HOOK_URL`.
5. Generate one strong shared machine credential. Store it as Operator-OS `CMS_RUNNER_SECRET` and as the Sunny Workers Builds secret `CMS_RUNNER_TOKEN`. Set Sunny build variable `OPERATOR_OS_API_URL` to the Focus API origin. Cloudflare supplies `WORKERS_CI_BUILD_UUID` and `WORKERS_CI_COMMIT_SHA`.
6. Verify the external custom-domain attachment and Sunny's explicit production/review hostname indexing variables before the first release.
7. Immediately before activation, re-read and record the then-current active Focus public Worker version as the emergency pre-CMS rollback target. The version observed during development is not a durable activation target and must not be hard-coded.
8. Initialize the CMS from verified current checked-in content, then perform a supervised no-content-change baseline publication before enabling routine staff publishing. Confirm the custom domain and workers.dev endpoint still resolve to the intended Worker during that activation.

As read-only verified on 2026-09-28, `focuslabproductions.com` and `focus-lab-public-staging.freedomgeneration1111.workers.dev` returned byte-identical HTML; the active version observed then was `75917371-275b-4304-a9cd-c3010bf92923`. This is historical inspection evidence only, not the future emergency rollback target. That target must be read again immediately before activation. The custom-domain attachment is not in source-controlled Wrangler config. Wrangler exposed no command for inspecting Workers Builds/Git/deploy-hook association, and no authenticated dashboard browser was available, so the associated repository/branch and any existing hook remain unverified and must be checked manually before configuration. Do not rename the Worker because its name contains `staging`.

Current editorial scope remains pricing and common/pricing FAQs. Broader CMS content is later work.
