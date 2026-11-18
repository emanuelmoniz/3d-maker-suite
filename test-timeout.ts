// Shared by unit tests and e2e: a test or check with its own time limit follows TEST_TIMEOUT,
// as vitest.config.ts and playwright.config.ts do. Unset keeps `ms` (the strict CI run),
// 0 lifts the limit, any other value is used when it is larger than `ms`.
const raw = process.env.TEST_TIMEOUT;
const set = raw !== undefined && raw !== "";
const asked = Number(raw) || 0;

/** Vitest has no "none": the largest timer delay stands in for it. */
export const NO_LIMIT = 2_147_483_647;

/** `ms`, or the `TEST_TIMEOUT` override; `none` is what 0 means (vitest: NO_LIMIT, Playwright: 0). */
export function testTimeout(ms: number, none = NO_LIMIT): number {
  if (!set) return ms;
  return asked === 0 ? none : Math.max(ms, asked);
}
