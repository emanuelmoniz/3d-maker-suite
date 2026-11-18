import { configDefaults, defineConfig } from "vitest/config";

// The dev data dir sits in the repo; a managed slicer unpacked there ships its own *.test.js.
// 75% of the threads: one worker per thread starves the fs/git/SQLite-heavy tests on a laptop
// (mostly efficiency cores) until they time out.
// TEST_TIMEOUT=<ms> sets the test, hook and expect.poll timeouts (0 = no timeout) and makes
// polling helpers wait as long and wall-clock speed checks skip. Unset = the strict CI run.
const raw = process.env.TEST_TIMEOUT;
const ms = raw === undefined || raw === "" ? undefined : Number(raw) || 2_147_483_647;

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "data/**"],
    maxWorkers: "75%",
    setupFiles: ["./vitest.setup.ts"],
    ...(ms !== undefined && {
      testTimeout: ms,
      hookTimeout: ms,
      expect: { poll: { timeout: ms } },
    }),
  },
});
