import { describe, expect, it } from "vitest";
import { matchSpoolRows } from "./spoolImportMatch.ts";

const values = (over = {}) => ({
  brand: "Acme",
  material: "PLA",
  profile: "Basic",
  colorHex: "#000000",
  ...over,
});
const spool = (id: string, over = {}) => ({ id, label: id, values: values(over) });

describe("matchSpoolRows", () => {
  it("suggests the single spool with that filament and colour, ignoring case", () => {
    const spools = [spool("a"), spool("b", { colorHex: "#ffffff" }), spool("c", { brand: null })];
    expect(matchSpoolRows([values({ brand: "ACME", material: "pla" })], spools)).toEqual([
      { candidates: ["a"], targetId: "a" },
    ]);
  });

  it("has no candidates when nothing fits", () => {
    expect(matchSpoolRows([values({ material: "PETG" })], [spool("a")])).toEqual([
      { candidates: [], targetId: null },
    ]);
  });

  it("leaves several fits to the user", () => {
    expect(matchSpoolRows([values()], [spool("a"), spool("b")])).toEqual([
      { candidates: ["a", "b"], targetId: null },
    ]);
  });

  it("a row without a colour fits every colour of that filament", () => {
    const spools = [spool("a"), spool("b", { colorHex: "#ffffff" })];
    expect(matchSpoolRows([values({ colorHex: null })], spools)[0]?.candidates).toEqual(["a", "b"]);
  });

  it("doesn't give one spool to two file rows", () => {
    expect(matchSpoolRows([values(), values()], [spool("a")])).toEqual([
      { candidates: ["a"], targetId: null },
      { candidates: ["a"], targetId: null },
    ]);
  });
});
