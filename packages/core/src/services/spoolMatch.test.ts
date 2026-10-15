import { describe, expect, it } from "vitest";
import { matchPrint, matchSpool, type SpoolCandidate, usableOn } from "./spoolMatch.ts";

const spool = (id: string, over: Partial<SpoolCandidate> = {}): SpoolCandidate => ({
  id,
  number: null,
  material: "PLA",
  colorHex: "#ff8800",
  status: "new",
  purchasedAt: "2026-01-01T12:00:00.000Z",
  openedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  initialGrams: 1000,
  remainingGrams: 1000,
  ...over,
});
const slot = {
  material: "pla",
  colorHex: "#FF8800",
  grams: 50,
  startedAt: "2026-02-01T08:00:00.000Z",
};
const sure = (id: string) => ({ id, sure: true });
const guess = (id: string | null) => ({ id, sure: false });

describe("matchSpool", () => {
  it("matches a unique type + colour for sure, ignoring case", () => {
    expect(matchSpool(slot, [spool("a"), spool("b", { material: "PETG" })])).toEqual(sure("a"));
  });

  it("picks the oldest of several, not for sure: opened first, then by date and number", () => {
    expect(matchSpool(slot, [spool("a"), spool("b", { status: "in_use" })])).toEqual(guess("b"));
    expect(matchSpool(slot, [spool("a"), spool("b", { remainingGrams: 400 })])).toEqual(guess("b"));
    const open = { status: "in_use" as const };
    expect(
      matchSpool(slot, [
        spool("a", { ...open, openedAt: "2026-01-20T12:00:00.000Z" }),
        spool("b", { ...open, openedAt: "2026-01-10T12:00:00.000Z" }),
        spool("c", open),
      ]),
    ).toEqual(guess("b"));
    expect(
      matchSpool(slot, [
        spool("a", { purchasedAt: "2026-01-05T12:00:00.000Z" }),
        spool("b", { purchasedAt: "2026-01-02T12:00:00.000Z" }),
      ]),
    ).toEqual(guess("b"));
    expect(matchSpool(slot, [spool("a", { number: 7 }), spool("b", { number: 3 })])).toEqual(
      guess("b"),
    );
  });

  it("breaks a tie with the spool the printer last used, still not for sure", () => {
    const two = [spool("a", { status: "in_use" }), spool("b")];
    expect(matchSpool(slot, two, ["b", "a"])).toEqual(guess("b"));
    // Spools that aren't candidates (other colour, archived) are skipped.
    expect(matchSpool(slot, two, ["x", "b"])).toEqual(guess("b"));
    expect(matchSpool(slot, two, ["x"])).toEqual(guess("a"));
    // A single match stays the match, whatever was used last.
    expect(matchSpool(slot, [spool("a")], ["x"])).toEqual(sure("a"));
  });

  it("finds nothing without a material or colour, or on a near colour", () => {
    expect(matchSpool({ ...slot, colorHex: undefined }, [spool("a")])).toEqual(guess(null));
    expect(matchSpool({ ...slot, material: undefined }, [spool("a")])).toEqual(guess(null));
    expect(matchSpool(slot, [spool("a", { colorHex: "#ff8801" })])).toEqual(guess(null));
  });

  it("ignores spools bought or opened after the print's day", () => {
    const later = "2026-03-01T00:00:00.000Z";
    expect(matchSpool(slot, [spool("a", { purchasedAt: later })])).toEqual(guess(null));
    expect(matchSpool(slot, [spool("a", { purchasedAt: "2026-02-01T12:00:00.000Z" })])).toEqual(
      sure("a"),
    );
    expect(matchSpool(slot, [spool("a", { purchasedAt: null })])).toEqual(sure("a"));
    expect(matchSpool(slot, [spool("a", { openedAt: "2026-02-02T12:00:00.000Z" })])).toEqual(
      guess(null),
    );
    expect(matchSpool(slot, [spool("a", { openedAt: "2026-02-01T12:00:00.000Z" })])).toEqual(
      sure("a"),
    );
    // A spool bought later doesn't make an older one ambiguous.
    expect(matchSpool(slot, [spool("a"), spool("b", { purchasedAt: later })])).toEqual(sure("a"));
  });

  it("needs a spool that holds the grams", () => {
    const low = spool("a", { remainingGrams: 40 });
    expect(matchSpool(slot, [low])).toEqual(guess(null));
    expect(matchSpool(slot, [low, spool("b")])).toEqual(sure("b"));
  });
});

describe("matchPrint", () => {
  it("gives two slots of one colour two spools, none of them for sure", () => {
    const spools = [spool("a", { status: "in_use" }), spool("b")];
    expect(matchPrint([slot, { ...slot, grams: 20 }], spools)).toEqual([guess("a"), guess("b")]);
    // Only one spool: the second roll is left for a person.
    expect(matchPrint([slot, slot], [spool("a")])).toEqual([guess("a"), guess(null)]);
  });

  it("matches other colours on their own, with each slot's own history", () => {
    const blue = { ...slot, colorHex: "#0000ff", slot: 2 };
    const spools = [
      spool("a"),
      spool("b", { colorHex: "#0000ff" }),
      spool("c", { colorHex: "#0000ff" }),
    ];
    expect(matchPrint([{ ...slot, slot: 1 }, blue], spools, (s) => (s === 2 ? ["c"] : []))).toEqual(
      [sure("a"), guess("c")],
    );
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
