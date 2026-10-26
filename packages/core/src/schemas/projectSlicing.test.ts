import { describe, expect, it } from "vitest";
import { foreignFilaments, pickSlicer, presetMisfit } from "./projectSlicing.ts";

it("picks the plate's slicer, then the project's, the default, the first", () => {
  const capable = ["a", "b", "c"];
  expect(pickSlicer(capable, ["c", "b", "a"])).toBe("c");
  expect(pickSlicer(capable, [null, "b", "a"])).toBe("b");
  expect(pickSlicer(capable, ["off", "b", "a"])).toBe("b"); // removed or switched off: skipped
  expect(pickSlicer(capable, ["off", undefined, "c"])).toBe("c");
  expect(pickSlicer(capable, [null, null, "off"])).toBe("a");
  expect(pickSlicer([], ["a"])).toBeUndefined();
});

describe("presetMisfit", () => {
  const bambu = (name: string) => ({ name, sourcePreset: `bambu-studio:system/${name}` });
  const orca = (name: string) => ({ name, sourcePreset: `orca-slicer:user/${name}` });
  const handMade = (name: string) => ({ name, sourcePreset: null });

  it("fits a slicer of the presets' library", () => {
    const plate = { print: bambu("0.20mm"), machines: [bambu("A1")] };
    expect(presetMisfit("bambu-studio", plate)).toBeUndefined();
    expect(presetMisfit("orca-slicer", plate)).toBe("0.20mm");
  });

  it("names the printer when none of its machine presets is the slicer's", () => {
    const plate = { machines: [bambu("A1"), handMade("Mine")], printer: "My A1" };
    expect(presetMisfit("bambu-studio", plate)).toBeUndefined();
    expect(presetMisfit("orca-slicer", plate)).toBe("My A1");
  });

  it("refuses any hand-made process; filaments never block", () => {
    expect(presetMisfit("bambu-studio", { print: handMade("Mine") })).toBe("Mine");
    expect(presetMisfit("bambu-studio", {})).toBeUndefined();
  });

  it("lists another slicer's filaments, not hand-made or own ones", () => {
    const list = [bambu("PLA"), handMade("Cheap"), orca("Silk")];
    expect(foreignFilaments("bambu-studio", list).map((f) => f.name)).toEqual(["Silk"]);
    expect(foreignFilaments("orca-slicer", list).map((f) => f.name)).toEqual(["PLA"]);
  });
});
