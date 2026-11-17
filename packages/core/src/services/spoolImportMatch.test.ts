import { describe, expect, it } from "vitest";
import { matchSpoolRows } from "./spoolImportMatch.ts";

const values = (over = {}) => ({
  brand: "Acme",
  material: "PLA",
  name: "Basic",
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

  it("a row with a number fits that spool only, whatever its filament", () => {
    const spools = [spool("a", { number: 1 }), spool("b", { number: 2, material: "PETG" })];
    expect(matchSpoolRows([values({ number: 2 })], spools)).toEqual([
      { candidates: ["b"], targetId: "b" },
    ]);
  });

  it("a spool another library brought in fits on material and colour, whatever it's called", () => {
    const spools = [
      spool("cloud", { brand: "Bambu Lab", name: "PLA Basic" }),
      spool("other", { brand: "Bambu Lab", name: "PLA Basic", colorHex: "#ffffff" }),
      spool("hand", { brand: "Bambu Lab", name: "PLA Basic", material: "PETG" }),
    ];
    const row = values({ brand: "Bambu", name: "Basic PLA" });
    expect(matchSpoolRows([row], spools, new Set(["cloud", "other", "hand"]))).toEqual([
      { candidates: ["cloud"], targetId: "cloud" },
    ]);
    // A spool entered by hand still needs the same filament.
    expect(matchSpoolRows([row], spools)).toEqual([{ candidates: [], targetId: null }]);
    // Without a colour, a material alone is no fit.
    expect(matchSpoolRows([values({ colorHex: null })], spools, new Set(["cloud"]))).toEqual([
      { candidates: [], targetId: null },
    ]);
  });

  it("doesn't give one spool to two file rows", () => {
    expect(matchSpoolRows([values(), values()], [spool("a")])).toEqual([
      { candidates: ["a"], targetId: null },
      { candidates: ["a"], targetId: null },
    ]);
  });
});
