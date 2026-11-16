import { configDefaults, defineConfig } from "vitest/config";

// The dev data dir sits in the repo; a managed slicer unpacked there ships its own *.test.js.
// 75% of the threads: one worker per thread starves the fs/git/SQLite-heavy tests on a laptop
// (mostly efficiency cores) until they time out.
// `pnpm test:battery` (--mode battery) is for a laptop on battery: 240s test, hook and
// expect.poll timeouts, and TEST_BATTERY=1 so wall-clock speed checks skip.
export default defineConfig(({ mode }) => {
  const battery = mode === "battery";
  return {
    test: {
      exclude: [...configDefaults.exclude, "data/**"],
      maxWorkers: "75%",
      ...(battery && {
        testTimeout: 240_000,
        hookTimeout: 240_000,
        expect: { poll: { timeout: 240_000 } },
        env: { TEST_BATTERY: "1" },
      }),
    },
  };
});
