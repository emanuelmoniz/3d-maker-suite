import { describe, expect, it } from "vitest";
import { compareVersions, pickRelease } from "./updates.ts";

describe("compareVersions", () => {
  it("orders by semver, numeric pre-release parts as numbers", () => {
    const sorted = [
      "4.0.0",
      "v4.0.0-alpha.10",
      "3.0.0",
      "4.0.0-alpha.9",
      "4.0.0-beta.1",
      "4.0.0-alpha",
      "4.1.0",
      "10.0.0",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "3.0.0",
      "4.0.0-alpha",
      "4.0.0-alpha.9",
      "v4.0.0-alpha.10",
      "4.0.0-beta.1",
      "4.0.0",
      "4.1.0",
      "10.0.0",
    ]);
    expect(compareVersions("v4.0.0", "4.0.0")).toBe(0);
    expect(() => compareVersions("main", "4.0.0")).toThrow();
  });
});

describe("pickRelease", () => {
  const r = (tag: string, prerelease = tag.includes("-")) => ({ tag, prerelease, url: tag });
  const list = [r("v3.0.0"), r("v4.0.0-alpha.3"), r("v4.0.0-alpha.4"), r("nightly", true)];

  it("stable skips pre-releases and never offers a downgrade", () => {
    expect(pickRelease(list, "stable", "2.0.0")?.tag).toBe("v3.0.0");
    expect(pickRelease(list, "stable", "4.0.0-alpha.3")).toBeNull();
  });

  it("dev takes the newest of any kind, newer than the running one", () => {
    expect(pickRelease(list, "dev", "4.0.0-alpha.3")?.tag).toBe("v4.0.0-alpha.4");
    expect(pickRelease(list, "dev", "4.0.0-alpha.4")).toBeNull();
    expect(pickRelease([...list, r("v4.0.0")], "dev", "4.0.0-alpha.4")?.tag).toBe("v4.0.0");
  });
});
