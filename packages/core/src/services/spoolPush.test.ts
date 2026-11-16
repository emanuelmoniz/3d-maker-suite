import { describe, expect, it } from "vitest";
import { type PushSent, type PushUsage, pushKey, pushTargets } from "./spoolPush.ts";

const use = (o: Partial<PushUsage> = {}): PushUsage => ({
  printId: "p1",
  slot: 0,
  appSpoolId: "a1",
  vendorSpoolId: "3",
  grams: 10,
  ...o,
});
const sent = (o: Partial<PushSent> = {}): PushSent => ({
  key: "p1:0",
  vendorSpoolId: "3",
  appSpoolId: "a1",
  sentGrams: 10,
  ...o,
});
const links: Record<string, string> = { a1: "3", a2: "4" };
const linked = (id: string) => links[id];

describe("pushTargets", () => {
  it("keys a slot by print and slot", () => {
    expect(pushKey("p1", 2)).toBe("p1:2");
    expect(pushKey("p1", null)).toBe("p1:-");
  });

  it("sends a new charge, and nothing once it went through", () => {
    expect(pushTargets([use()], [], linked)).toEqual({
      targets: [{ key: "p1:0", vendorSpoolId: "3", appSpoolId: "a1", grams: 10, sent: 0 }],
      drop: [],
    });
    expect(pushTargets([use()], [sent()], linked)).toEqual({ targets: [], drop: [] });
  });

  it("sends an edit as the slot's new total", () => {
    expect(pushTargets([use({ grams: 12.5 })], [sent()], linked).targets).toEqual([
      { key: "p1:0", vendorSpoolId: "3", appSpoolId: "a1", grams: 12.5, sent: 10 },
    ]);
  });

  it("gives back a deleted print's grams", () => {
    expect(pushTargets([], [sent()], linked).targets).toEqual([
      { key: "p1:0", vendorSpoolId: "3", appSpoolId: "a1", grams: 0, sent: 10 },
    ]);
    // Already given back: nothing more.
    expect(pushTargets([], [sent({ sentGrams: 0 })], linked).targets).toEqual([]);
  });

  it("moves a slot reassigned to another linked spool", () => {
    const { targets } = pushTargets(
      [use({ appSpoolId: "a2", vendorSpoolId: "4" })],
      [sent()],
      linked,
    );
    expect(targets).toEqual([
      { key: "p1:0", vendorSpoolId: "4", appSpoolId: "a2", grams: 10, sent: 0 },
      { key: "p1:0", vendorSpoolId: "3", appSpoolId: "a1", grams: 0, sent: 10 },
    ]);
  });

  it("drops a link that went away without writing", () => {
    const gone = sent({ appSpoolId: "a9" });
    expect(pushTargets([], [gone], linked)).toEqual({ targets: [], drop: [gone] });
  });

  it("adds up slots without a number on one spool", () => {
    const { targets } = pushTargets(
      [use({ slot: null, grams: 1.11 }), use({ slot: null, grams: 2.22 })],
      [],
      linked,
    );
    expect(targets).toEqual([
      { key: "p1:-", vendorSpoolId: "3", appSpoolId: "a1", grams: 3.33, sent: 0 },
    ]);
  });
});
