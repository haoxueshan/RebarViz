import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/print",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/calculator",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
