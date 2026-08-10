type TestMigration = { name: string;queries: string[] };

// Wrangler generates declared bindings from wrangler.jsonc. These declaration
// merges cover secrets (which must not be in config) and the test-only binding.
interface Env {
  INTERNAL_API_TOKEN?: string;
  MESSAGING_PROVIDER?: string;
  MESSAGING_DESTINATION_URL?: string;
}
declare namespace Cloudflare {
  interface Env {
    INTERNAL_API_TOKEN?: string;
    MESSAGING_PROVIDER?: string;
    MESSAGING_DESTINATION_URL?: string;
    TEST_MIGRATIONS: TestMigration[];
  }
}
