import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 10000,
  use: {
    baseURL: "http://localhost:8765",
    headless: true,
  },
  webServer: {
    command: "npx serve samples -p 8765 --no-clipboard",
    url: "http://localhost:8765/bounce/",
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
