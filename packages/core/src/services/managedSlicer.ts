import type { ManagedSlicer, SlicerSystem } from "../integrations/index.ts";
import { compareVersions, isVersion, type Release, type ReleaseAsset } from "./updates.ts";

/** Linux only: glibc is at least `want` ("2.38"); false without glibc (e.g. musl). */
export function glibcAtLeast(sys: SlicerSystem, want: string) {
  const [a = 0, b = 0] = (sys.glibc ?? "").split(".").map(Number);
  const [x = 0, y = 0] = want.split(".").map(Number);
  return !!sys.glibc && (a !== x ? a > x : b >= y);
}

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
