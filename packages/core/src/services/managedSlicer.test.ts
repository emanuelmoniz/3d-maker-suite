import { describe, expect, it } from "vitest";
import type { ManagedSlicer } from "../integrations/index.ts";
import { glibcAtLeast, installable, slicingSupported } from "./managedSlicer.ts";

const slicer: ManagedSlicer = {
  repo: "a/b",
  licenceUrl: "",
  minVersion: "2.0.0-alpha",
  asset: (tag, names) => names.find((n) => n === `app-${tag}.zip`),
  exe: () => "app",
  profiles: () => "profiles",
};
const sys = { platform: "win32", arch: "x64" };
const rel = (tag: string, prerelease = false, digest: string | null = "sha256:x") => ({
  tag,
  prerelease,
  url: tag,
  assets: [{ name: `app-${tag}.zip`, size: 1, digest: digest ?? undefined, url: tag }],
});

describe("installable", () => {
  const list = [
    rel("v1.9.0"),
    rel("v2.0.0-alpha", true),
    rel("v2.1.0"),
    rel("v2.0.0"),
    rel("nightly-builds", true),
    rel("v2.2.0", false, null),
  ];

  it("newest first, from minVersion, only with a digest, pre-releases when asked", () => {
    expect(installable(list, slicer, sys, false).map((r) => r.tag)).toEqual(["v2.1.0", "v2.0.0"]);
    expect(installable(list, slicer, sys, true).map((r) => r.tag)).toEqual([
      "v2.1.0",
      "v2.0.0",
      "v2.0.0-alpha",
    ]);
  });

  it("skips a release with no asset for this system", () => {
    expect(installable([{ ...rel("v2.0.0"), assets: [] }], slicer, sys, true)).toEqual([]);
  });
});

it("slicingSupported: Linux on ARM runs no slicer, the other ARM systems do (ADR-0024)", () => {
  expect(slicingSupported({ platform: "linux", arch: "arm64" })).toBe(false);
  expect(slicingSupported({ platform: "linux", arch: "x64" })).toBe(true);
  expect(slicingSupported({ platform: "darwin", arch: "arm64" })).toBe(true);
  expect(slicingSupported({ platform: "win32", arch: "arm64" })).toBe(true);
  // Even an asset that matches isn't offered there.
  expect(
    installable(
      [rel("v2.0.0")],
      { ...slicer, asset: (_t, names) => names[0] },
      {
        platform: "linux",
        arch: "arm64",
        glibc: "2.41",
      },
      true,
    ),
  ).toEqual([]);
});

it("glibcAtLeast", () => {
  expect(glibcAtLeast({ ...sys, glibc: "2.41" }, "2.38")).toBe(true);
  expect(glibcAtLeast({ ...sys, glibc: "2.38" }, "2.38")).toBe(true);
  expect(glibcAtLeast({ ...sys, glibc: "2.36" }, "2.38")).toBe(false);
  expect(glibcAtLeast({ ...sys, glibc: "3.1" }, "2.38")).toBe(true);
  expect(glibcAtLeast(sys, "2.38")).toBe(false);
});
