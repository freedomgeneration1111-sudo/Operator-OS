import { defineConfig,devices } from "@playwright/test";

const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browserOverride=executablePath?{ launchOptions:{ executablePath } }:{};
export default defineConfig({
  testDir:"./e2e",
  timeout:30_000,
  fullyParallel:false,
  reporter:"line",
  use:{ baseURL:"http://127.0.0.1:5173",trace:"retain-on-failure" },
  webServer:{
    command:"VITE_APP_STAGE=development VITE_AUTH_MODE=development VITE_OPERATIONS_API_URL=http://127.0.0.1:8787 npm run staff:dev -- --host 127.0.0.1",
    url:"http://127.0.0.1:5173",
    reuseExistingServer:!process.env.CI,
  },
  projects:[
    { name:"staff-desktop",use:{ ...devices["Desktop Chrome"],...browserOverride,viewport:{ width:1280,height:900 } } },
    { name:"staff-mobile",use:{ ...devices["Pixel 5"],...browserOverride,viewport:{ width:390,height:844 } } },
  ],
});
