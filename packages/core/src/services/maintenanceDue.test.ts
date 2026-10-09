import { describe, expect, it } from "vitest";
import { appliesToPrinter, maintenanceDue } from "./maintenanceDue.ts";

const none = { intervalSec: null, intervalPrints: null, intervalDays: null };
const since = { at: "2026-01-01T00:00:00.000Z", runtimeSec: 1000, prints: 10 };
const at = (days: number, runtimeSec = 1000, prints = 10) => ({
  at: new Date(Date.parse(since.at) + days * 86_400_000).toISOString(),
  runtimeSec,
  prints,
});

describe("maintenanceDue", () => {
  it("no interval is never due", () => {
    expect(maintenanceDue(none, since, at(999, 1e9, 1e6))).toMatchObject({
      status: "ok",
      dueBy: null,
      dueAt: null,
    });
  });

  it("hours: counts runtime since last done", () => {
    const i = { ...none, intervalSec: 3600 * 100 };
    expect(maintenanceDue(i, since, at(1, 1000 + 3600 * 50)).status).toBe("ok");
    const near = maintenanceDue(i, since, at(1, 1000 + 3600 * 95));
    expect(near).toMatchObject({ status: "upcoming", dueBy: "hours", remainingSec: 3600 * 5 });
    expect(maintenanceDue(i, since, at(1, 1000 + 3600 * 100)).status).toBe("overdue");
  });

  it("count: counts prints since last done", () => {
    const i = { ...none, intervalPrints: 20 };
    expect(maintenanceDue(i, since, at(1, 1000, 25)).status).toBe("ok");
    expect(maintenanceDue(i, since, at(1, 1000, 29))).toMatchObject({
      status: "upcoming",
      remainingPrints: 1,
    });
    expect(maintenanceDue(i, since, at(1, 1000, 35))).toMatchObject({
      status: "overdue",
      remainingPrints: -5,
    });
  });

  it("days: due date and overdue", () => {
    const i = { ...none, intervalDays: 30 };
    expect(maintenanceDue(i, since, at(10))).toMatchObject({
      status: "ok",
      remainingDays: 20,
      dueAt: "2026-01-31T00:00:00.000Z",
    });
    expect(maintenanceDue(i, since, at(31)).status).toBe("overdue");
  });

  it("whichever comes first wins", () => {
    const i = { intervalSec: 3600 * 100, intervalPrints: 20, intervalDays: 365 };
    // 10 days, 10 h, 30 prints: only the print count is exceeded.
    const d = maintenanceDue(i, since, at(10, 1000 + 3600 * 10, 40));
    expect(d).toMatchObject({ status: "overdue", dueBy: "count", remainingPrints: -10 });
    expect(d.remainingSec).toBe(3600 * 90);
  });
});

describe("appliesToPrinter", () => {
  const p1s = { id: "a", modelId: "p1s" };
  const none = { appliesToModelIds: [], appliesToPrinterIds: [] };
  it("empty = all printers", () => {
    expect(appliesToPrinter(none, p1s)).toBe(true);
  });
  it("matches the printer's model", () => {
    expect(appliesToPrinter({ ...none, appliesToModelIds: ["x1c", "p1s"] }, p1s)).toBe(true);
    expect(appliesToPrinter({ ...none, appliesToModelIds: ["x1c"] }, p1s)).toBe(false);
  });
  it("applies to the union of models and printers", () => {
    const t = { appliesToModelIds: ["x1c"], appliesToPrinterIds: ["a"] };
    expect(appliesToPrinter(t, p1s)).toBe(true);
    expect(appliesToPrinter(t, { id: "b", modelId: "x1c" })).toBe(true);
    expect(appliesToPrinter(t, { id: "b", modelId: "a1" })).toBe(false);
    expect(appliesToPrinter(t, { id: "b", modelId: null })).toBe(false);
  });
});
