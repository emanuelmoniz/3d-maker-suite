import { defineConfig } from "@playwright/test";
import { testTimeout } from "./test-timeout.ts";

// TEST_TIMEOUT=<ms> sets the test and expect timeouts (0 = none), as vitest.config.ts does;
// unset keeps Playwright's defaults (30 s per test, 5 s per check).
const limited = !!process.env.TEST_TIMEOUT;

// Each test starts its own server on a free port with a fresh data dir (see e2e/fixtures.ts).
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  ...(limited && {
    timeout: testTimeout(30_000, 0),
    expect: { timeout: testTimeout(5_000, 0) },
  }),
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
