type TestMigration = { name: string;queries: string[] };

// Wrangler generates declared bindings from wrangler.jsonc. These declaration
// merges cover secrets/future environment identifiers and test-only bindings.
interface Env {
  INTERNAL_API_TOKEN?: string;
  BUSINESS_PROFILE?: string;
  DEPLOYMENT_KEY?: string;
  PUBLIC_API_ENABLED?: string;
    CMS_ENABLED?: string;
    CMS_DB?: D1Database;
    CMS_DEPLOY_HOOK_URL?: string;
    CMS_RUNNER_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  MESSAGING_PROVIDER?: string;
  MESSAGING_DESTINATION_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  TURNSTILE_EXPECTED_HOSTNAMES?: string;
  TURNSTILE_TEST_BYPASS?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  RESEND_API_KEY?: string;
  CUSTOMER_EMAIL_FROM?: string;
  CUSTOMER_CONVERSATION_ORIGIN?: string;
  OPS_NOTIFY_EMAIL?: string;
  STAFF_CONSOLE_ORIGIN?: string;
  INQUIRY_RATE_LIMITER?: RateLimit;
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY?: string;
  GOOGLE_CALENDAR_ID?: string;
  BUSINESS_TIMEZONE?: string;
  AVAILABILITY_WINDOW_MONTHS?: string;
  AVAILABILITY_CACHE_STALE_MINUTES?: string;
  AVAILABILITY_CACHE?: KVNamespace;
  AVAILABILITY_RATE_LIMITER?: RateLimit;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_WEBHOOK_RATE_LIMITER?: RateLimit;
}
declare namespace Cloudflare {
  interface Env {
    INTERNAL_API_TOKEN?: string;
    BUSINESS_PROFILE?: string;
    DEPLOYMENT_KEY?: string;
    PUBLIC_API_ENABLED?: string;
  CMS_ENABLED?: string;
  CMS_DB?: D1Database;
  CMS_DEPLOY_HOOK_URL?: string;
  CMS_RUNNER_SECRET?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    MESSAGING_PROVIDER?: string;
    MESSAGING_DESTINATION_URL?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_EXPECTED_HOSTNAME?: string;
    TURNSTILE_EXPECTED_HOSTNAMES?: string;
    TURNSTILE_TEST_BYPASS?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    RESEND_API_KEY?: string;
    CUSTOMER_EMAIL_FROM?: string;
    CUSTOMER_CONVERSATION_ORIGIN?: string;
    OPS_NOTIFY_EMAIL?: string;
    STAFF_CONSOLE_ORIGIN?: string;
    INQUIRY_RATE_LIMITER?: RateLimit;
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY?: string;
    GOOGLE_CALENDAR_ID?: string;
    BUSINESS_TIMEZONE?: string;
    AVAILABILITY_WINDOW_MONTHS?: string;
    AVAILABILITY_CACHE_STALE_MINUTES?: string;
    AVAILABILITY_CACHE?: KVNamespace;
    AVAILABILITY_RATE_LIMITER?: RateLimit;
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
    WHATSAPP_APP_SECRET?: string;
    WHATSAPP_WEBHOOK_RATE_LIMITER?: RateLimit;
    TEST_MIGRATIONS: TestMigration[];
    TEST_CMS_MIGRATIONS: TestMigration[];
  }
}
