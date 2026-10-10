import { describe, expect, it } from "vitest";
import { bestMatches } from "./printMatch.ts";

const files = [
  "honda_civic.3mf",
  "honda_civic_kit.3mf",
  "Spice-Rack.gcode.3mf",
  "ab.3mf",
  "草莓蛋糕.3mf",
];
const match = (title: string) => bestMatches(title, files, (f) => f);

describe("bestMatches", () => {
  it("matches a title that is the file name or starts with it at a word boundary", () => {
    expect(match("honda_civic")).toEqual(["honda_civic.3mf"]);
    expect(match("Honda Civic_plate_4")).toEqual(["honda_civic.3mf"]);
    expect(match("spice-rack_Plate 1")).toEqual(["Spice-Rack.gcode.3mf"]);
    expect(match("草莓蛋糕")).toEqual(["草莓蛋糕.3mf"]);
    expect(match("honda_civics")).toEqual([]);
    expect(match("0.2mm layer, 2 walls, 15% infill")).toEqual([]);
  });

  it("prefers the longest name, returns ties and ignores very short names", () => {
    expect(match("honda_civic_kit_plate_1")).toEqual(["honda_civic_kit.3mf"]);
    expect(bestMatches("box", ["a/box.3mf", "b/box.3mf"], (f) => f.slice(2))).toHaveLength(2);
    expect(match("ab_plate_1")).toEqual([]);
  });
});
