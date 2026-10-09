import { describe, expect, it } from "vitest";
import { listQuery } from "./list.ts";
import { printFilters, printSortFields } from "./prints.ts";

const q = listQuery(printSortFields, {}, printFilters);

describe("column filters", () => {
  it("parses each kind", () => {
    expect(
      q.parse({
        title: " benchy ",
        outcome: "failed,cancelled",
        printerId: "a,b",
        durationSec: "600..",
        startedAt: "..2026-03-31",
      }),
    ).toMatchObject({
      title: "benchy",
      outcome: ["failed", "cancelled"],
      printerId: ["a", "b"],
      durationSec: { min: 600, max: undefined },
      // date-only `to` includes the whole day
      startedAt: { from: undefined, to: "2026-04-01T00:00:00.000Z" },
    });
  });

  it("rejects bad values", () => {
    for (const bad of [
      { outcome: "nope" },
      { durationSec: "600" },
      { durationSec: "a..b" },
      { startedAt: "2026-13-01.." },
      { title: "  " },
    ])
      expect(q.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
