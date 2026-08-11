type TestMigration = { name: string;queries: string[] };

// Wrangler generates declared bindings from wrangler.jsonc. These declaration
// merges cover secrets/future environment identifiers and test-only bindings.
interface Env {
  INTERNAL_API_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  MESSAGING_PROVIDER?: string;
  MESSAGING_DESTINATION_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  TURNSTILE_TEST_BYPASS?: string;
  INQUIRY_RATE_LIMITER?: RateLimit;
}
declare namespace Cloudflare {
  interface Env {
    INTERNAL_API_TOKEN?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    MESSAGING_PROVIDER?: string;
    MESSAGING_DESTINATION_URL?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_EXPECTED_HOSTNAME?: string;
    TURNSTILE_TEST_BYPASS?: string;
    INQUIRY_RATE_LIMITER?: RateLimit;
    TEST_MIGRATIONS: TestMigration[];
  }
}
