import { describe, expect, it } from "vitest";
import { projectRoot, rootOf } from "./preferences.ts";

describe("rootOf", () => {
  const outer = projectRoot("C:\\models\\");
  const inner = projectRoot("C:/models/archive", { autoSlice: false });
  const roots = [outer, inner];

  it("finds the deepest root a path sits in, whatever the slashes", () => {
    expect(rootOf("C:\\models\\Benchy", roots)).toBe(outer);
    expect(rootOf("C:\\models\\archive\\Old", roots)).toBe(inner);
    expect(rootOf("C:/models/archive", roots)).toBe(inner);
  });

  it("needs a whole folder name to match", () => {
    expect(rootOf("C:\\models-old\\x", roots)).toBeUndefined();
    expect(rootOf("C:\\models\\archived", roots)).toBe(outer);
  });
});
