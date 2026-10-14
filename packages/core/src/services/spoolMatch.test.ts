import { describe, expect, it } from "vitest";
import { matchSpool, type SpoolCandidate, usableOn } from "./spoolMatch.ts";

const spool = (id: string, over: Partial<SpoolCandidate> = {}): SpoolCandidate => ({
  id,
  material: "PLA",
  colorHex: "#ff8800",
  purchasedAt: "2026-01-01T12:00:00.000Z",
  openedAt: null,
  initialGrams: 1000,
  remainingGrams: 1000,
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
    const opened = { remainingGrams: 400 };
    expect(matchSpool(slot, [spool("a", opened), spool("b", opened)])).toBeNull();
  });

  it("breaks a tie with the spool the printer last used, else the only opened one", () => {
    const two = [spool("a", { remainingGrams: 400 }), spool("b")];
    expect(matchSpool(slot, two, ["b", "a"])).toBe("b");
    // Spools that aren't candidates (other colour, archived) are skipped.
    expect(matchSpool(slot, two, ["x", "b"])).toBe("b");
    expect(matchSpool(slot, two, ["x"])).toBe("a");
    expect(matchSpool(slot, two)).toBe("a");
    // A single match stays the match, whatever was used last.
    expect(matchSpool(slot, [spool("a")], ["x"])).toBe("a");
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

  it("ignores spools opened after the print's day", () => {
    expect(matchSpool(slot, [spool("a", { openedAt: "2026-02-02T12:00:00.000Z" })])).toBeNull();
    expect(matchSpool(slot, [spool("a", { openedAt: "2026-02-01T12:00:00.000Z" })])).toBe("a");
  });
});

describe("usableOn", () => {
  it("allows the opening day and later, or any day when not opened", () => {
    const at = "2026-02-01T08:00:00.000Z";
    expect(usableOn({ openedAt: null }, at)).toBe(true);
    expect(usableOn({ openedAt: "2026-02-01T12:00:00.000Z" }, at)).toBe(true);
    expect(usableOn({ openedAt: "2026-02-02T12:00:00.000Z" }, at)).toBe(false);
  });
});
