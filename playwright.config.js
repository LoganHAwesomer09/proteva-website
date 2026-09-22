import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',
  timeout:30000,
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:'http://127.0.0.1:4175',headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || (process.platform==='win32'?'msedge':undefined),screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:4175',env:{PORT:'4175'},reuseExistingServer:false,timeout:30000}
});
