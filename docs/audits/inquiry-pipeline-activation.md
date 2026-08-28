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

*(Implementation, deploy output, and verification evidence are appended after this section.)*
