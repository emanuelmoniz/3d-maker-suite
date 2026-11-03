import { describe, expect, it } from "vitest";
import { inRoot, lastFolder } from "./folderPrefix.ts";

describe("folderPrefix", () => {
  it("keeps the last folder", () => {
    expect(lastFolder("C:\\Users\\me\\projects\\001_aqua")).toBe("001_aqua");
    expect(lastFolder("/volume1/projects/001_aqua/")).toBe("001_aqua");
    expect(lastFolder("/")).toBe("");
  });

  it("puts it in another root", () => {
    expect(inRoot("D:\\prints\\", "001_aqua")).toBe("D:\\prints\\001_aqua");
    expect(inRoot("/mnt/p", "001_aqua")).toBe("/mnt/p/001_aqua");
  });
});
