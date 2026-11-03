import { describe, expect, it } from "vitest";
import { commonStart, replaceStart } from "./folderPrefix.ts";

describe("folderPrefix", () => {
  it("finds the common start by whole folders", () => {
    expect(commonStart(["/volume1/projects/a/x", "/volume1/projects/b"])).toBe("/volume1/projects");
    expect(commonStart(["/vol/ab", "/vol/abc"])).toBe("/vol");
    expect(commonStart(["C:\\p\\a", "C:\\p\\b"])).toBe("C:\\p");
    expect(commonStart([])).toBe("");
  });

  it("replaces the start and keeps subfolders", () => {
    expect(replaceStart("/volume1/projects/a/x", "/volume1/projects", "D:\\prints")).toBe(
      "D:\\prints\\a\\x",
    );
    expect(replaceStart("C:\\p\\a", "C:\\p", "/mnt/p/")).toBe("/mnt/p/a");
    expect(replaceStart("/volume1/projectsX/a", "/volume1/projects", "/n")).toBeNull();
    expect(replaceStart("/other/a", "/volume1", "/n")).toBeNull();
  });
});
