import { defineConfig } from "vitest/config";
import { resolveClientBusinessProfile } from "../business-profiles.mts";
const profile=resolveClientBusinessProfile("focus");
export default defineConfig({
  define:{__BUSINESS_PROFILE__:JSON.stringify(profile)},
  test:{ environment:"jsdom",include:["staff-app/src/**/*.test.{ts,tsx}"] },
});
