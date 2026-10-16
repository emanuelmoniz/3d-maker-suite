import { defineConfig } from "@playwright/test";

// README screenshots (`pnpm screenshots`). Not part of `pnpm test:e2e` or CI: that config only matches *.e2e.ts.
export default defineConfig({
  testDir: "scripts",
  testMatch: "screenshots.shot.ts",
  reporter: "list",
  use: { viewport: { width: 1280, height: 800 }, colorScheme: "light" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
