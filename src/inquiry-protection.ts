import { z } from "zod";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const inquiryProtectionSchema = z.object({
  turnstileToken: z.string().trim().min(1).max(2048),
  website: z.string().trim().max(300).optional().default(""),
}).strict();

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export class InquiryProtectionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function enforceInquiryProtection(
  request: Request,
  env: Env,
  protection: z.infer<typeof inquiryProtectionSchema>,
  fetcher: typeof fetch = fetch,
) {
  if (protection.website) {
    throw new InquiryProtectionError(400, "submission_rejected", "The inquiry could not be verified");
  }

  if (!env.INQUIRY_RATE_LIMITER) {
    if (env.ENVIRONMENT !== "development") {
      throw new InquiryProtectionError(503, "submission_unavailable", "Inquiry submission is temporarily unavailable");
    }
  } else {
    const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const key = await sha256(`inquiry:${address}`);
    const result = await env.INQUIRY_RATE_LIMITER.limit({ key });
    if (!result.success) {
      throw new InquiryProtectionError(429, "rate_limited", "Too many attempts. Please wait a minute and try again");
    }
  }

  if (env.ENVIRONMENT === "development" && env.TURNSTILE_TEST_BYPASS === "true") {
    if (protection.turnstileToken === "test-turnstile-pass") return;
    throw new InquiryProtectionError(400, "verification_failed", "Please complete the verification and try again");
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    throw new InquiryProtectionError(503, "submission_unavailable", "Inquiry submission is temporarily unavailable");
  }

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", protection.turnstileToken);
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) form.set("remoteip", remoteIp);
  form.set("idempotency_key", crypto.randomUUID());

  let response: Response;
  try {
    response = await fetcher(SITEVERIFY_URL, { method: "POST", body: form });
  } catch {
    throw new InquiryProtectionError(503, "verification_unavailable", "Verification is temporarily unavailable. Please try again");
  }
  if (!response.ok) {
    throw new InquiryProtectionError(503, "verification_unavailable", "Verification is temporarily unavailable. Please try again");
  }

  const result = await response.json<SiteverifyResponse>().catch(() => null);
  if (!result?.success) {
    throw new InquiryProtectionError(400, "verification_failed", "Please complete the verification and try again");
  }
  if (env.TURNSTILE_EXPECTED_HOSTNAME && result.hostname !== env.TURNSTILE_EXPECTED_HOSTNAME) {
    throw new InquiryProtectionError(400, "verification_failed", "Please complete the verification and try again");
  }
  if (result.action && result.action !== "inquiry_submit") {
    throw new InquiryProtectionError(400, "verification_failed", "Please complete the verification and try again");
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
