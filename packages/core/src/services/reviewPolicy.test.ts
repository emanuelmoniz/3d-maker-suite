import { describe, expect, it } from "vitest";
import { type ReviewSlot, reviewPolicyOf, slotOutcome } from "./reviewPolicy.ts";

const charged = { action: "charge", spoolId: "a" };
const waits = (suggestedSpoolId: string | null = null) => ({ action: "wait", suggestedSpoolId });
const notTracked = { action: "dismiss" };

const sureReal: ReviewSlot = { spoolId: "a", sure: true, grams: "real" };
const sureEstimated: ReviewSlot = { spoolId: "a", sure: true, grams: "estimated" };
// A guess among several and a loaded spool that contradicts the printer reach here the same way.
const guess: ReviewSlot = { spoolId: "a", sure: false, grams: "real" };
const noSpool: ReviewSlot = { spoolId: null, sure: false, grams: "real" };

describe("slotOutcome: the PLAN 6.0.0 Step 6 table, one case per cell", () => {
  it.each([
    ["sure spool, real grams", "never", sureReal, charged],
    ["sure spool, real grams", "unmatched", sureReal, charged],
    ["sure spool, real grams", "always", sureReal, waits("a")],
    ["sure spool, estimated grams", "never", sureEstimated, charged],
    ["sure spool, estimated grams", "unmatched", sureEstimated, waits("a")],
    ["sure spool, estimated grams", "always", sureEstimated, waits("a")],
    ["a guess, or a contradicting loaded spool", "never", guess, notTracked],
    ["a guess, or a contradicting loaded spool", "unmatched", guess, waits("a")],
    ["a guess, or a contradicting loaded spool", "always", guess, waits("a")],
    ["no spool", "never", noSpool, notTracked],
    ["no spool", "unmatched", noSpool, waits()],
    ["no spool", "always", noSpool, waits()],
  ] as const)("%s under %s", (_slot, policy, slot, expected) => {
    expect(slotOutcome(policy, slot)).toEqual(expected);
  });

  it("never charges a slot with no grams from any source, whatever its spool", () => {
    const slot: ReviewSlot = { spoolId: "a", sure: true, grams: "none" };
    expect(slotOutcome("never", slot)).toEqual(notTracked);
    expect(slotOutcome("unmatched", slot)).toEqual(waits("a"));
    expect(slotOutcome("always", slot)).toEqual(waits("a"));
  });

  it("a guess stays a guess with estimated grams, and sure without a spool is no spool", () => {
    expect(slotOutcome("never", { ...guess, grams: "estimated" })).toEqual(notTracked);
    expect(slotOutcome("unmatched", { ...guess, grams: "estimated" })).toEqual(waits("a"));
    expect(slotOutcome("never", { ...noSpool, sure: true })).toEqual(notTracked);
    expect(slotOutcome("unmatched", { ...noSpool, sure: true })).toEqual(waits());
  });
});

describe("reviewPolicyOf", () => {
  it("each level overrides the one above it; null follows it", () => {
    expect(reviewPolicyOf({ global: "unmatched" })).toBe("unmatched");
    expect(reviewPolicyOf({ printer: null, source: null, global: "always" })).toBe("always");
    expect(reviewPolicyOf({ source: "never", global: "always" })).toBe("never");
    expect(reviewPolicyOf({ printer: "always", source: "never", global: "unmatched" })).toBe(
      "always",
    );
    expect(reviewPolicyOf({ printer: "never", source: null, global: "always" })).toBe("never");
  });
});
