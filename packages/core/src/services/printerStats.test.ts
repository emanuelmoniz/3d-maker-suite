import { describe, expect, it } from "vitest";
import { summarizePrints } from "./printerStats.ts";

describe("summarizePrints", () => {
  const prints = [
    { durationSec: 3600, outcome: "success", energyWh: 100 },
    { durationSec: 7200, outcome: "failed", energyWh: null },
    { durationSec: null, outcome: "cancelled", energyWh: null },
  ] as const;

  it("counts outcomes, sums time, estimates missing energy from powerW", () => {
    expect(summarizePrints(prints, 150)).toEqual({
      printCount: 3,
      successCount: 1,
      failedCount: 1,
      cancelledCount: 1,
      totalSec: 10800,
      energyWh: 400,
    });
  });

  it("ignores missing energy without powerW; empty set is all zeros", () => {
    expect(summarizePrints(prints, null).energyWh).toBe(100);
    expect(summarizePrints([], 150).printCount).toBe(0);
  });
});
