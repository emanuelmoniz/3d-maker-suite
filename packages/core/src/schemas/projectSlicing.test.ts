import { describe, expect, it } from "vitest";
import { pickSlicer, presetMisfit } from "./projectSlicing.ts";

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
    const plate = { print: bambu("0.20mm"), machines: [bambu("A1")], filaments: [bambu("PLA")] };
    expect(presetMisfit("bambu-studio", plate)).toBeUndefined();
    expect(presetMisfit("orca-slicer", plate)).toBe("0.20mm");
  });

  it("names the printer when none of its machine presets is the slicer's", () => {
    const plate = { machines: [bambu("A1"), handMade("Mine")], printer: "My A1", filaments: [] };
    expect(presetMisfit("bambu-studio", plate)).toBeUndefined();
    expect(presetMisfit("orca-slicer", plate)).toBe("My A1");
  });

  it("refuses another library's filament but keeps a hand-made one, and any hand-made process", () => {
    expect(presetMisfit("bambu-studio", { filaments: [handMade("Cheap"), orca("Silk")] })).toBe(
      "Silk",
    );
    expect(presetMisfit("bambu-studio", { filaments: [handMade("Cheap")] })).toBeUndefined();
    expect(presetMisfit("bambu-studio", { print: handMade("Mine"), filaments: [] })).toBe("Mine");
  });
});
