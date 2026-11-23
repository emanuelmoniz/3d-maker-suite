import type { ManagedSlicer, SlicerSystem } from "../integrations/index.ts";
import { compareVersions, isVersion, type Release, type ReleaseAsset } from "./updates.ts";

/** Linux only: glibc is at least `want` ("2.38"); false without glibc (e.g. musl). */
export function glibcAtLeast(sys: SlicerSystem, want: string) {
  const [a = 0, b = 0] = (sys.glibc ?? "").split(".").map(Number);
  const [x = 0, y = 0] = want.split(".").map(Number);
  return !!sys.glibc && (a !== x ? a > x : b >= y);
}

/**
 * A system that can run a managed slicer (ADR-0024). Linux on ARM can't in 6.3.0: Bambu Studio has no
 * build for it, and OrcaSlicer's was left out of the plan. Apple silicon and Windows on ARM are unchanged.
 */
export const slicingSupported = (sys: SlicerSystem) =>
  !(sys.platform === "linux" && sys.arch === "arm64");

/**
 * The system a connector reports as `os` (`Linux 6.1.0 arm64`: `os.type()`, release, `os.arch()`),
 * or null for text that isn't that (a bare `win32`, nothing). The arch is "" when it isn't there.
 */
export function deviceSystem(os: string | null | undefined): SlicerSystem | null {
  const [type = "", ...rest] = (os ?? "").trim().toLowerCase().split(/\s+/);
  const platform = type.startsWith("win")
    ? "win32"
    : type === "darwin"
      ? "darwin"
      : type === "linux"
        ? "linux"
        : null;
  return platform ? { platform, arch: rest.length >= 2 ? (rest.at(-1) ?? "") : "" } : null;
}

/** A connector's machine can be a slice worker (not Linux on ARM, ADR-0024); unknown = yes. */
export const deviceCanSlice = (os: string | null | undefined) => {
  const sys = deviceSystem(os);
  return !sys || slicingSupported(sys);
};

/** `v2.5.0-alpha` → `2\.5\.0-alpha`, for asset name patterns. */
export const tagPattern = (tag: string) =>
  tag.replace(/^v/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first name that matches `re`. */
export const pickAsset = (names: string[], re: RegExp | undefined) =>
  re ? names.find((n) => re.test(n)) : undefined;

export type InstallableRelease = Omit<Release, "assets"> & { asset: ReleaseAsset };

/**
 * The releases a managed slicer can install on this system, newest first: a version tag (no
 * `nightly-builds`), at least `minVersion`, pre-releases only if asked, and a matching asset with
 * a digest (ADR-0013: never install what we can't check).
 */
export function installable(
  releases: Release[],
  slicer: ManagedSlicer,
  sys: SlicerSystem,
  pre: boolean,
): InstallableRelease[] {
  const out: InstallableRelease[] = [];
  if (!slicingSupported(sys)) return out;
  for (const { assets = [], ...r } of releases) {
    if (!isVersion(r.tag) || (r.prerelease && !pre)) continue;
    if (slicer.minVersion && compareVersions(r.tag, slicer.minVersion) < 0) continue;
    const name = slicer.asset(
      r.tag,
      assets.map((a) => a.name),
      sys,
    );
    const asset = assets.find((a) => a.name === name);
    if (asset?.digest) out.push({ ...r, asset });
  }
  return out.sort((a, b) => compareVersions(b.tag, a.tag));
}
