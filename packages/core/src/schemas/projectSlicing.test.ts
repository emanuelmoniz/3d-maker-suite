import { expect, it } from "vitest";
import { pickSlicer } from "./projectSlicing.ts";

it("picks the plate's slicer, then the project's, the default, the first", () => {
  const capable = ["a", "b", "c"];
  expect(pickSlicer(capable, ["c", "b", "a"])).toBe("c");
  expect(pickSlicer(capable, [null, "b", "a"])).toBe("b");
  expect(pickSlicer(capable, ["off", "b", "a"])).toBe("b"); // removed or switched off: skipped
  expect(pickSlicer(capable, ["off", undefined, "c"])).toBe("c");
  expect(pickSlicer(capable, [null, null, "off"])).toBe("a");
  expect(pickSlicer([], ["a"])).toBeUndefined();
});
