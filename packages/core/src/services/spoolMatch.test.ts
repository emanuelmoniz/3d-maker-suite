import { describe, expect, it } from "vitest";
import { matchSpool, type SpoolCandidate } from "./spoolMatch.ts";

const spool = (id: string, over: Partial<SpoolCandidate> = {}): SpoolCandidate => ({
  id,
  material: "PLA",
  colorHex: "#ff8800",
  purchasedAt: "2026-01-01T12:00:00.000Z",
  ...over,
});
const slot = {
  material: "pla",
  colorHex: "#FF8800",
  startedAt: "2026-02-01T08:00:00.000Z",
};

describe("matchSpool", () => {
  it("matches a unique type + colour, ignoring case", () => {
    expect(matchSpool(slot, [spool("a"), spool("b", { material: "PETG" })])).toBe("a");
  });

  it("returns null instead of picking one of several candidates", () => {
    expect(matchSpool(slot, [spool("a"), spool("b")])).toBeNull();
  });

  it("returns null without a material or colour, or on a near colour", () => {
    expect(matchSpool({ ...slot, colorHex: undefined }, [spool("a")])).toBeNull();
    expect(matchSpool({ ...slot, material: undefined }, [spool("a")])).toBeNull();
    expect(matchSpool(slot, [spool("a", { colorHex: "#ff8801" })])).toBeNull();
  });

  it("ignores spools bought after the print's day; same day or unknown still match", () => {
    expect(matchSpool(slot, [spool("a", { purchasedAt: "2026-03-01T00:00:00.000Z" })])).toBeNull();
    expect(matchSpool(slot, [spool("a", { purchasedAt: "2026-02-01T12:00:00.000Z" })])).toBe("a");
    expect(matchSpool(slot, [spool("a", { purchasedAt: null })])).toBe("a");
    // A spool bought later doesn't make an older one ambiguous.
    expect(
      matchSpool(slot, [spool("a"), spool("b", { purchasedAt: "2026-03-01T00:00:00.000Z" })]),
    ).toBe("a");
  });
});
