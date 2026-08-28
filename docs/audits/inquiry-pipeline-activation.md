# Inquiry Pipeline Activation — `focuslabproductions.com`

**Date:** 2026-08-28
**Goal:** the public inquiry form at `https://focuslabproductions.com/check-availability/` submits a
real inquiry that (a) passes Turnstile verification against the production hostname, (b) persists to
`focuslab-crm-staging` D1, and (c) sends the notification email to `focuslabproductions@gmail.com` —
using the same Resend path the chat system already uses.
**Turnstile site key supplied by the operator:** `0x4AAAAAAEM89GpptQay8UJg`

---

## Part A — Backend audit (read-only, done before any change)

### 1. Where `TURNSTILE_EXPECTED_HOSTNAME(S)` is defined

| Location | Kind | Current value |
|---|---|---|
| `deployments/focus-lab/api.staging.jsonc:22` (`vars` block) | **plaintext var** — NOT a wrangler secret | `"TURNSTILE_EXPECTED_HOSTNAME":"focus-lab-public-staging.freedomgeneration1111.workers.dev"` — **singular key, single value** |
| `deployments/moses-jorgensen/api.staging.jsonc:10` (`vars` block) | plaintext var | `"TURNSTILE_EXPECTED_HOSTNAMES":"mosesjorgensen.com,moses-site-review.freedomgeneration1111.workers.dev"` — **plural key, comma list** (precedent for a list) |
| `wrangler.public-staging.jsonc:47` | plaintext var, legacy/alt config (not the deploy path) | singular, same staging value |
| `secrets.d.ts:15-16` and `:51-52` | TypeScript declaration merge on `Env` / `Cloudflare.Env` | both `TURNSTILE_EXPECTED_HOSTNAME?: string` and `TURNSTILE_EXPECTED_HOSTNAMES?: string` declared |

`wrangler secret list --config deployments/focus-lab/api.staging.jsonc` on `focus-lab-api-staging`
returns: `CUSTOMER_EMAIL_FROM`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`. **`TURNSTILE_EXPECTED_HOSTNAME` is not a secret** — it is a
plaintext `vars` entry, set in the deployment `.jsonc` and applied by `wrangler deploy`. So the
correct mechanism is **edit the `.jsonc` `vars` block + redeploy**, not `wrangler secret put`.

`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, and `CUSTOMER_EMAIL_FROM` are all already present on
`focus-lab-api-staging` (the chat system's ops-notification email already runs through the same
Resend path). `OPS_NOTIFY_EMAIL` is a plaintext var = `focuslabproductions@gmail.com`
(`deployments/focus-lab/api.staging.jsonc:27`).

### 2. Where it is consumed — and does it support a list?

`src/inquiry-protection.ts:76-85`, inside `enforceInquiryProtection()` (called from
`src/index.ts` `publicInquiry()` on `POST /v1/inquiries`):

```ts
const expectedHostnames = (env.TURNSTILE_EXPECTED_HOSTNAMES ?? env.TURNSTILE_EXPECTED_HOSTNAME ?? "")
  .split(",")
  .map((hostname) => hostname.trim().toLowerCase())
  .filter(Boolean);
if (!result.hostname || expectedHostnames.length === 0 || !expectedHostnames.includes(result.hostname.toLowerCase())) {
  throw new InquiryProtectionError(400, "verification_failed", "Please complete the verification and try again");
}
if (result.action !== "inquiry_submit") {
  throw new InquiryProtectionError(400, "verification_failed", "Please complete the verification and try again");
}
```

**Definitive answer: the implementation already supports a list.** It reads
`TURNSTILE_EXPECTED_HOSTNAMES` (plural) first, falls back to `TURNSTILE_EXPECTED_HOSTNAME` (singular),
splits on `,`, trims + lowercases each entry, drops empties, then requires the Turnstile
siteverify `hostname` (lowercased) to be a member of that set. It fails closed: empty set → reject;
no `result.hostname` → reject. It also pins `result.action === "inquiry_submit"`.

This list support was added in commit `69ad652` (the `publicConsultingInquiry` feature — "Turnstile
`TURNSTILE_EXPECTED_HOSTNAMES` hardening") and is **live on `focus-lab-api-staging`**, deployed at
`d36bdc7` during an earlier session. `test/inquiry-protection.test.ts:9` exercises a two-entry list
(`"public.example.test,review.example.test"`) with the verified hostname matching the second entry;
`:11` covers "fails closed when no expected hostname is configured".

### 3. Why the form currently fails on `focuslabproductions.com`

The `TurnstileWidget` (`Sunny-ops/components/forms/TurnstileWidget.tsx`) renders with
`action: "inquiry_submit"`. A token minted on `focuslabproductions.com` verifies with
`hostname: "focuslabproductions.com"`. The backend's allowlist is only
`focus-lab-public-staging.freedomgeneration1111.workers.dev` → `result.hostname` is not a member →
`400 verification_failed`. (The `action` check would pass; only the hostname is wrong.)

There is a second, independent blocker on the frontend: `inquirySubmissionEnabled` in
`Sunny-ops/lib/operations-api.ts` requires `NEXT_PUBLIC_INQUIRY_SUBMISSION_ENABLED === "true"` **and**
a non-empty `NEXT_PUBLIC_TURNSTILE_SITE_KEY` **and** a non-empty `NEXT_PUBLIC_INQUIRY_API_URL`. Only
the API URL is currently set (baked into `public:staging:build`); the other two are unset, so the
form short-circuits to demo mode ("This form is not sending yet").

### 4. Change required (no code change)

- **Backend:** `deployments/focus-lab/api.staging.jsonc` — replace the singular key/single value with
  the plural key holding both hostnames:
  `"TURNSTILE_EXPECTED_HOSTNAME":"focus-lab-public-staging.freedomgeneration1111.workers.dev"` →
  `"TURNSTILE_EXPECTED_HOSTNAMES":"focuslabproductions.com,focus-lab-public-staging.freedomgeneration1111.workers.dev"`.
  Matches the moses config's shape. Keeps the staging `.workers.dev` hostname verifying (not
  removed). Then `wrangler deploy --config deployments/focus-lab/api.staging.jsonc` (config `name` =
  `focus-lab-api-staging`).
- **Frontend (Part B, Sunny-ops):** set `NEXT_PUBLIC_INQUIRY_SUBMISSION_ENABLED=true` and
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAEM89GpptQay8UJg` into the staging build, rebuild + deploy.
- **Dependency outside this repo:** the Turnstile widget behind site key `0x4AAAAAAEM89GpptQay8UJg`
  must list `focuslabproductions.com` in its allowed domains (Cloudflare dashboard), and its secret
  must be the `TURNSTILE_SECRET_KEY` already on `focus-lab-api-staging`. Verified indirectly by the
  end-to-end test below.

---

## Implementation

### operator-os (this repo) — commit `7ff4b91`

- `deployments/focus-lab/api.staging.jsonc`: line 22 changed from
  `"TURNSTILE_EXPECTED_HOSTNAME":"focus-lab-public-staging.freedomgeneration1111.workers.dev"`
  to
  `"TURNSTILE_EXPECTED_HOSTNAMES":"focuslabproductions.com,focus-lab-public-staging.freedomgeneration1111.workers.dev"`.
  No code change (the list parser in `src/inquiry-protection.ts` already exists).
- `npm run test:config-isolation` → 3/3 pass. `test/inquiry-protection.test.ts` → 8/8 pass.

### Sunny-ops — commits `1d53abc` (prior) + `ab75d8f` (this activation)

- `package.json` `public:staging:build`:
  `NEXT_PUBLIC_INQUIRY_API_URL=https://focuslabproductions.com NEXT_PUBLIC_INQUIRY_SUBMISSION_ENABLED=true NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAEM89GpptQay8UJg next build`.
  Command-env has highest precedence in Next, so every `public:staging:deploy` bakes all three
  `NEXT_PUBLIC_*` values in regardless of any local `.env*`.
- `npm run lint` / `npm run typecheck` clean; `npm run public:staging:build` succeeds.

## Deploy evidence

### Backend — `wrangler deploy --config deployments/focus-lab/api.staging.jsonc`

```
Uploaded focus-lab-api-staging (11.72 sec)
Deployed focus-lab-api-staging triggers (7.22 sec)
  https://focus-lab-api-staging.freedomgeneration1111.workers.dev
  schedule: */10 * * * *
Current Version ID: 1837a79d-adc1-4791-a4ec-6a7d025f571b
```

Binding readout from that deploy (confirms the new var is live on the correct Worker):

```
env.DEPLOYMENT_KEY ("focus-lab-api-staging")                                Environment Variable
env.DB (focuslab-crm-staging)                                               D1 Database
env.TURNSTILE_EXPECTED_HOSTNAMES ("focuslabproductions.com,focus-lab-pub...")  Environment Variable
env.OPS_NOTIFY_EMAIL ("focuslabproductions@gmail.com")                      Environment Variable
```

`wrangler secret list` on the same Worker (already present, unchanged): `CUSTOMER_EMAIL_FROM`,
`RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`.

This deploy also carries `main` commits made after the previous API deploy (`d36bdc7`): `28dd37f`
(the `/v1/availability` cache-freshness fix) and doc-only commits. No other code changed.

### Frontend — `npm run public:staging:deploy` (Sunny-ops)

```
Uploaded focus-lab-public-staging (19.05 sec)
Current Version ID: 41014909-601b-487c-8713-583e9a4ab189
```

Built bundle `out/_next/static/chunks/app/check-availability/page-*.js` inspected:
`p="0x4AAAAAAEM89GpptQay8UJg"` (site key inlined); the config object folds to
`{apiUrl:x, enabled:!!x && !!p}` — `NEXT_PUBLIC_INQUIRY_SUBMISSION_ENABLED` was constant-folded to
`true` and dropped, so `enabled` = `!!apiUrl && !!siteKey` = **true**. The `submit()` demo guard
`if(!enabled){setSubmission({kind:"demo"})...}` is now dead code.

## Verification

| Check | Status | Evidence |
|---|---|---|
| Backend redeploy succeeded, correct Worker | **PASS** | Version `1837a79d-adc1-4791-a4ec-6a7d025f571b`; binding readout shows `TURNSTILE_EXPECTED_HOSTNAMES ("focuslabproductions.com,focus-lab-pub...")` on `focus-lab-api-staging` |
| Frontend redeploy succeeded, submissions enabled | **PASS** | Version `41014909-601b-487c-8713-583e9a4ab189`; bundle: `enabled` folds to `!!apiUrl && !!siteKey` = true |
| Turnstile widget renders on `focuslabproductions.com` for the right key | **PASS** | Live-browser screenshot: standard "Verify you are human" Cloudflare checkbox on the step-2 form; challenge iframe URL contains `/0x4AAAAAAEM89GpptQay8UJg/`. It is the normal interactive challenge, **not** a domain-configuration error — indicating the widget's domain allowlist includes `focuslabproductions.com`. |
| Real inquiry submitted through the live form | **BLOCKED — needs a human** | Two automated attempts (headless, then headed under xvfb with a realistic context): the Turnstile widget rendered but never issued a token, the "Send Inquiry" button stayed disabled, and `0` requests reached `/v1/inquiries` (confirmed via `wrangler tail focus-lab-api-staging` — only `/v1/chat/status` seen). Turnstile is doing its job: it will not hand a token to an automated browser. |
| D1 row persisted | **PENDING** — no submission to persist yet | — |
| Notification email to `focuslabproductions@gmail.com` | **PENDING** — no submission to trigger it yet | — |

### The remaining step (one human action) and how it will be verified

A person opens `https://focuslabproductions.com/check-availability/`, fills the two-step form,
checks the Turnstile box, and clicks **Send Inquiry**. On success the form shows
"Thanks — we have your inquiry." Then:

1. **D1 row** — from `~/projects/operator-os`:
   ```
   npx wrangler d1 execute focuslab-crm-staging --remote \
     --config deployments/focus-lab/api.staging.jsonc \
     --command "SELECT i.id,i.created_at,i.source_channel,c.full_name,c.email,e.event_family,e.start_date
                FROM inquiries i JOIN contacts c ON c.id=i.contact_id
                LEFT JOIN events e ON e.id=i.event_id
                ORDER BY i.created_at DESC LIMIT 3;"
   ```
   Expect the just-submitted inquiry as the newest row, with a matching `events` row and an
   `intake_submissions` row (`form_schema_key = 'focus.website.event-inquiry'`).

2. **Notification email** — run `npx wrangler tail --config deployments/focus-lab/api.staging.jsonc
   --format json` during the submission. `POST /v1/inquiries` returns `201`; the
   `dispatchEventInquiryNotificationEmail` path logs **nothing on success** and logs
   `{"message":"event inquiry notification failed",...}` on failure. `201` + persisted row + no
   "notification failed" line = Resend accepted the message. Final confirmation is the email
   arriving in `focuslabproductions@gmail.com` (and/or the Resend dashboard "Sent" log).

## Git

| Repo | Commits | Pushed |
|---|---|---|
| **operator-os** | `7ff4b91` (Turnstile hostname config + this audit doc); plus a follow-up docs commit adding this Implementation/Deploy/Verification section | `main` → `origin/main` |
| **Sunny-ops** | `1d53abc` (check-availability page: no hero/banner, durable API URL, top spacing — from earlier), `ab75d8f` (enable inquiry submission: `NEXT_PUBLIC_INQUIRY_SUBMISSION_ENABLED=true` + site key) | `feat/check-availability-google-calendar` → `origin` (`2ad8d10..ab75d8f`) |

The Sunny-ops working tree still holds the operator's **unrelated, pre-existing hero/media WIP**
(4 modified files + 13 untracked assets under `components/media/`, `lib/media.ts`,
`tests/header-hero.spec.ts`, `public/images/…`, `public/video/…`). It was set aside via a temp
commit for each build and restored byte-identically (verified: `git status`, `git diff`, and
sha256 of every untracked file match the pre-work snapshot). It was **not** committed or pushed.
