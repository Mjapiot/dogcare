import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real Supabase project (see TEST_PLAN.md).
 * Required env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY (server-side only, never committed).
 * E2E_BASE_URL targets a deployed URL; otherwise a local server is started.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  projects: [{ name: "iphone", use: { ...devices["iPhone 13"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run build && npx next start -p 3100", url: baseURL, timeout: 240_000, reuseExistingServer: true },
});
