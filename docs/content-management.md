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

Publish and rollback use the existing `website:manage` capability. Rollback creates a new operation referencing a previous successful release and its recorded Worker version. It does not modify either current CMS draft. Releases without a verified Worker version, and releases later marked externally superseded, cannot be rolled back.

An emergency restore performed outside the CMS does not rewrite the release that genuinely reached `live`. An authorized manager records the external supersession on that release with the expected rejected Worker version, the externally active Worker version, and an allow-listed reason. Migration `0004_cms_external_supersession.sql` stores that audit record and atomically clears `current_live_release_id`; release history then shows “published, later externally superseded.” This recovery action is accepted only when the named release is the current CMS live pointer and no publication operation is active.

## Publication protocol

1. `POST /v1/internal/cms/releases/publish` atomically records a queued immutable release.
2. Operator-OS POSTs the server-only `CMS_DEPLOY_HOOK_URL`, then attaches Cloudflare's returned build UUID. Hook failure marks the operation failed.
3. The Workers Builds runner authenticates to `/v1/cms-runner/*` with `Authorization: Bearer <CMS_RUNNER_SECRET>`. It does not use Cloudflare Access or development responder headers. Secret digests are compared with Workers `crypto.subtle.timingSafeEqual`.
4. The runner claims only the queued release assigned to its exact `WORKERS_CI_BUILD_UUID`. A bounded retry covers the short race between a build starting and the hook response being recorded; it cannot claim a later release.
5. Sunny materializes that release's snapshot. Publish performs the existing strict snapshot build; rollback does not build or substitute new site output.
6. Publish uses `wrangler deploy --message "CMS publish <release-id>"`, which durably associates the new Worker version with the immutable release. Rollback uses Wrangler 4.120's exact, noninteractive `wrangler versions deploy <historical-version>@100% --config wrangler.staging.jsonc --message ... --yes`.
7. After either mutating command exits successfully, the runner uses read-only `wrangler deployments list --json` and requires the expected version to be the sole active version at 100% traffic before reporting `live`.

As soon as the assigned runner can safely identify the exact Worker version, it records that version on the still-`deploying` release through an authenticated `version_observed` callback. This does not mark the release live or release the active slot. If final verification or callback is ambiguous, `GET /v1/cms-runner/releases/active` exposes only the authenticated operation metadata needed by the reconciliation runner.

The remote-mutation boundary is strict: before the mutating command succeeds, a genuine build or command failure can transition the operation to `failed`. Once that command exits successfully, missing or malformed structured output, absent metadata, inconclusive active-version verification, and final callback failure must leave the operation active in `deploying`. The runner must not report `failed` or release `active_slot` because the public Worker may already have changed.

`source_git_sha` identifies the source represented by the deployed release. `runner_source_git_sha` separately identifies the current runner/orchestration code. The runner derives its authoritative SHA from `git rev-parse HEAD` in the checked-out Sunny repository and requires a full 40-character hexadecimal value before it can claim a release or mutate the public Worker. A valid 40-character `WORKERS_CI_COMMIT_SHA` is advisory and must equal Git HEAD; branch names, empty values, and other non-SHA values are ignored. The two fields are normally identical for publish. Rollback copies `source_git_sha` from the historical release, preserving null when historical provenance is unknown, while recording current Git HEAD only as `runner_source_git_sha`.

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

After the remote CMS binding and secret are configured, unattended first activation uses the same validation and insert-missing-only application logic through the narrow machine boundary:

```bash
OPERATOR_OS_API_URL=https://<focus-api-origin> CMS_RUNNER_TOKEN=<runner-secret> npm run cms:initialize
```

This records `system:cms-bootstrap` as the actor, never impersonates staff, and never overwrites an existing draft. Initialization creates missing draft documents; publication captures an immutable release; reconciliation only verifies and completes an already-mutated active release. External-supersession recovery records a verified out-of-band restore without rewriting release history or drafts. Direct D1 edits are not the normal initialization or recovery mechanism.

If a successful Wrangler mutation remains active because verification or its final callback was interrupted, run from Sunny:

```bash
OPERATOR_OS_API_URL=https://<focus-api-origin> CMS_RUNNER_TOKEN=<runner-secret> npm run cms:release:reconcile
```

For publish, reconciliation uses a previously recorded assigned-runner version or requires exactly one recent Wrangler version annotated `CMS publish <release-id>`. For rollback it uses the already-recorded historical target. It then requires that exact version to be the sole active version at 100% traffic before sending the normal `live` transition. It never rebuilds, redeploys, rolls back, guesses among candidates, marks an inconclusive operation failed, changes drafts, or clears the active slot directly.

The release runner is fully testable without Cloudflare mutation through Sunny's `npm run test:lib`; its tests mock both the deploy hook API and Wrangler command. The real Workers Builds commands are documented in Sunny's canonical publication document.

## Remote activation state and first-publication gate

Activation Phase 1 completed on 2026-10-15 without publishing Sunny:

- Dedicated D1 `focuslab-cms-staging` (`3e15b3c4-7592-4d1c-a405-babe072c5822`) is bound only to the Focus API as `CMS_DB`. Migrations `0001_cms_foundation.sql`, `0002_cms_publication.sql`, `0003_cms_runner_source_sha.sql`, and `0004_cms_external_supersession.sql` are applied. The CRM database and both console deployments remain separate.
- `CMS_ENABLED=true` is set only on the Focus API. Pricing revision `pricing_init_a0abd8310034cb2becaedb2d` and FAQ revision `faqs_init_956aa932a140086f74ba7787` were machine-bootstrapped from Sunny's checked-in content by `system:cms-bootstrap`; rerunning initialization inserted nothing and did not change either revision.
- Existing Worker `focus-lab-public-staging` (tag `422da36253d04c3fb7813311a9b055ac`) is connected to `freedomgeneration1111-sudo/Sunny` on `feat/focus-cms-foundation`. Production trigger `255c075f-2014-408e-a05e-b90ee7a75c7d` runs `npm run cms:release:build` then `npm run cms:release:deploy`; no preview trigger exists.
- Ordinary push builds are suppressed with the deliberately nonexistent `.focus-cms-deploy-hook-only` include path. Cloudflare evaluates build watch paths for push events, while the branch-specific Deploy Hook starts a manual build. Do not add that sentinel file. Cloudflare documents that empty pushes and unusually large push events can bypass path matching, so those push forms must not be used on the connected branch.
- Deploy Hook `Focus CMS Publish` (`849bd5de-1a1e-4d21-a71c-5d6432144af1`) targets the review branch. Its URL is stored only as API secret `CMS_DEPLOY_HOOK_URL`. One canonical runner credential is stored as API secret `CMS_RUNNER_SECRET` and Builds secret `CMS_RUNNER_TOKEN`; `OPERATOR_OS_API_URL` points to the Focus API origin. Secret values are not committed.
- The first supervised baseline attempt created `release_44f430ed-f026-4a6a-8580-39ab71a92acf` and deployed Worker version `025bd117-eb48-4cb7-9227-7b30030b4600`. A customer-visible footer parity difference was detected, so production was externally restored to pre-CMS Worker version `75917371-275b-4304-a9cd-c3010bf92923`. The release retains its original successful deployment record but is marked externally superseded with reason `baseline_content_parity_failed`; `current_live_release_id` is null, and that rejected release is not a rollback candidate.

Read-only verification on 2026-10-15 confirmed that `focuslabproductions.com` is externally attached to `focus-lab-public-staging`; it and the workers.dev endpoint returned byte-identical HTML with no `X-Robots-Tag`. The active public version remained `75917371-275b-4304-a9cd-c3010bf92923`. This is historical evidence only, not the emergency rollback target. The custom-domain attachment remains outside source-controlled Wrangler configuration. Do not rename the Worker because its name contains `staging`.

Before the supervised baseline publication in Activation Phase 2:

1. Re-read and record the then-current active Focus public Worker version as the emergency pre-CMS rollback target; never hard-code the Phase 1 observation.
2. Reconfirm that the external custom domain and workers.dev endpoint represent the intended Worker and that the explicit production/review hostname variables are correct.
3. Confirm the saved CMS draft still matches the reviewed checked-in pricing and FAQ content.
4. Build Sunny locally from the exact saved snapshot, enumerate every exported public HTML route, and run Sunny's `npm run cms:activation:parity -- --candidate out --live-origin https://focuslabproductions.com --report <path> --report-only`. Review every visible-text, link, media-reference, and relevant metadata difference. Explicitly accept every expected CMS-foundation/build difference and resolve every unintended branch drift before publication. This is a first-activation safety gate, not a rule that later intentional edits must match the old site.
5. Perform one supervised no-content-change baseline publication, verify the exact Worker version at 100% traffic, both hostnames, indexing headers, and customer behavior, then test the recorded rollback path before enabling routine staff publishing.

Current editorial scope remains pricing and common/pricing FAQs. Broader CMS content is later work.
