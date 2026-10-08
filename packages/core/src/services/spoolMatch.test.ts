import { describe, expect, it } from "vitest";
import { matchSpool, type SpoolCandidate } from "./spoolMatch.ts";

const spool = (id: string, over: Partial<SpoolCandidate> = {}): SpoolCandidate => ({
  id,
  material: "PLA",
  colorHex: "#ff8800",
  remainingGrams: 500,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const slot = {
  material: "pla",
  colorHex: "#FF8800",
  grams: 20,
  startedAt: "2026-02-01T00:00:00.000Z",
};

describe("matchSpool", () => {
  it("matches a unique type + colour, ignoring case", () => {
    expect(matchSpool(slot, [spool("a"), spool("b", { material: "PETG" })])).toBe("a");
  });

  it("returns null instead of picking one of several candidates", () => {
    expect(matchSpool(slot, [spool("a"), spool("b")])).toBeNull();
    // Even if only one of them could cover the grams.
    expect(matchSpool(slot, [spool("a"), spool("b", { remainingGrams: 5 })])).toBeNull();
  });

  it("returns null without a material or colour, or on a near colour", () => {
    expect(matchSpool({ ...slot, colorHex: undefined }, [spool("a")])).toBeNull();
    expect(matchSpool({ ...slot, material: undefined }, [spool("a")])).toBeNull();
    expect(matchSpool(slot, [spool("a", { colorHex: "#ff8801" })])).toBeNull();
  });

  it("ignores spools added after the print and refuses a spool with too little left", () => {
    expect(matchSpool(slot, [spool("a", { createdAt: "2026-03-01T00:00:00.000Z" })])).toBeNull();
    expect(matchSpool(slot, [spool("a", { remainingGrams: 10 })])).toBeNull();
  });
});
