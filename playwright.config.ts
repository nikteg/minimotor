import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 10000,
  use: {
    baseURL: "http://localhost:8765",
    headless: true,
  },
  webServer: {
    // Vite serves the samples folder as root: gallery at "/", games at "/<game>/".
    // Vite resolves the local `minimotor` aliases directly to src/.
    command: "pnpm run samples",
    url: "http://localhost:8765/",
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
