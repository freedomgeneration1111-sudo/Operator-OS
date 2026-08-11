import { cloudflarePool,readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["operations/test/**/*.test.ts"],
    setupFiles: ["operations/test/setup.ts"],
    pool: cloudflarePool(async () => ({
      wrangler: { configPath: "operations/wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("operations/migrations"),
          INTERNAL_API_TOKEN: "development-test-token-00000000",
          MESSAGING_PROVIDER: "test-shared-inbox",
          MESSAGING_DESTINATION_URL: "https://messaging.example.test/shared",
          TURNSTILE_TEST_BYPASS: "true",
        },
      },
    })),
  },
});
