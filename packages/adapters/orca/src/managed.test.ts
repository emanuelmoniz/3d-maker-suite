import { readFileSync } from "node:fs";
import { installable } from "@3d-maker-suite/core";
import { describe, expect, it } from "vitest";
import { orcaManaged } from "./index.ts";

// Recorded from the GitHub releases API (2026-10-26), asset names only.
const releases: { tag: string; prerelease: boolean; assets: string[] }[] = JSON.parse(
  readFileSync(new URL("./releases.fixture.json", import.meta.url), "utf8"),
);
const names = (tag: string) => releases.find((r) => r.tag === tag)?.assets ?? [];
const pick = (tag: string, platform: string, arch = "x64", glibc?: string) =>
  orcaManaged.asset(tag, names(tag), { platform, arch, glibc });

describe("orca managed asset", () => {
  it("picks the portable zip per arch, the universal dmg, the 24.04 AppImage", () => {
    expect(pick("v2.5.0-alpha", "win32")).toBe("OrcaSlicer_Windows_V2.5.0-alpha_x64_portable.zip");
    expect(pick("v2.5.0-alpha", "win32", "arm64")).toBe(
      "OrcaSlicer_Windows_V2.5.0-alpha_arm64_portable.zip",
    );
    expect(pick("v2.5.0-alpha", "darwin", "arm64")).toBe(
      "OrcaSlicer_Mac_universal_V2.5.0-alpha.dmg",
    );
    expect(pick("v2.5.0-alpha", "linux", "x64", "2.41")).toBe(
      "OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.5.0-alpha.AppImage",
    );
  });

  it("nothing on old glibc or Linux arm64 (untested)", () => {
    expect(pick("v2.5.0-alpha", "linux", "x64", "2.36")).toBeUndefined();
    expect(pick("v2.5.0-alpha", "linux", "arm64", "2.41")).toBeUndefined();
  });

  it("offers 2.5 and newer only, nightly never, pre-releases only when asked", () => {
    const withAssets = releases.map((r) => ({
      ...r,
      url: r.tag,
      assets: r.assets.map((name) => ({ name, size: 1, digest: "sha256:x", url: name })),
    }));
    const sys = { platform: "win32", arch: "x64" };
    expect(installable(withAssets, orcaManaged, sys, false)).toEqual([]);
    expect(installable(withAssets, orcaManaged, sys, true).map((r) => r.tag)).toEqual([
      "v2.5.0-alpha",
    ]);
  });
});
