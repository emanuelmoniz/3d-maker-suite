import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bambuManaged } from "./index.ts";

// Recorded from the GitHub releases API (2026-10-26), asset names only.
const releases: { tag: string; prerelease: boolean; assets: string[] }[] = JSON.parse(
  readFileSync(new URL("./releases.fixture.json", import.meta.url), "utf8"),
);
const names = (tag: string) => releases.find((r) => r.tag === tag)?.assets ?? [];
const pick = (tag: string, platform: string, arch = "x64", glibc?: string) =>
  bambuManaged.asset(tag, names(tag), { platform, arch, glibc });

describe("bambu managed asset", () => {
  it("Windows: the portable zip, never the installer; no arm64 build", () => {
    expect(pick("v02.08.04.57", "win32")).toBe("Bambu_Studio_win_v02.08.04.57-20260922164607.zip");
    expect(pick("v02.08.02.61", "win32")).toBe("Bambu_Studio_win-v02.08.02.61-20260820225108.zip");
    expect(pick("v02.08.02.61", "win32", "arm64")).toBeUndefined();
  });

  it("macOS: the tag's own dmg, not another build's or a pre_release one", () => {
    expect(pick("v02.08.04.57", "darwin", "arm64")).toBe(
      "Bambu_Studio_mac_v02.08.04.57-20260922164607.dmg",
    );
    expect(pick("v02.07.01.57", "darwin")).toBe("Bambu_Studio_mac-v02.07.01.57-20260601165745.dmg");
  });

  it("Linux: 24.04 build on glibc ≥ 2.38, else 22.04, across the renames; x64 only", () => {
    expect(pick("v02.08.04.57", "linux", "x64", "2.41")).toMatch(/^BambuStudio_ubu24-/);
    expect(pick("v02.08.04.57", "linux", "x64", "2.36")).toMatch(/^BambuStudio_ubu22-/);
    expect(pick("v02.08.02.61", "linux", "x64", "2.41")).toMatch(/^BambuStudio_ubuntu24\.04-/);
    expect(pick("v02.07.01.57", "linux", "x64", "2.36")).toMatch(/^BambuStudio_ubuntu-22\.04-/);
    expect(pick("v02.08.04.57", "linux", "arm64", "2.41")).toBeUndefined();
    expect(pick("v02.08.04.57", "linux", "x64")).toBeUndefined(); // no glibc (musl)
  });

  it("a release whose files carry another version offers nothing", () => {
    // v02.05.03.62 ships the .61 files.
    expect(pick("v02.05.03.62", "win32")).toBeUndefined();
  });

  it("never picks an installer, a flatpak, a PDB or a PR build", () => {
    for (const r of releases)
      for (const [platform, glibc] of [
        ["win32"],
        ["darwin"],
        ["linux", "2.41"],
        ["linux", "2.36"],
      ] as const) {
        const a = bambuManaged.asset(r.tag, r.assets, { platform, arch: "x64", glibc });
        if (a) expect(a).toMatch(/\.(zip|dmg|AppImage)$/);
        if (a) expect(a).not.toMatch(/PR-|PDB|fedora|public/i);
      }
  });
});
