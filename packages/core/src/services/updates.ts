import type { UPDATE_CHANNELS } from "../schemas/enums.ts";

/** A release tag the updater may check out: `vX.Y.Z` or `vX.Y.Z-pre.N`. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

/**
 * Semver order (sign only): a release beats its pre-releases, and numeric pre-release parts
 * compare as numbers (`alpha.10` > `alpha.9`). A leading `v` is ignored.
 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => {
    const m = VERSION.exec(v);
    if (!m) throw new Error(`Not a version: ${v}`);
    return { core: [m[1], m[2], m[3]].map(Number), pre: m[4]?.split(".") ?? [] };
  }) as [{ core: number[]; pre: string[] }, { core: number[]; pre: string[] }];
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d) return Math.sign(d);
  }
  // A release beats its own pre-releases.
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const m = /^\d+$/.test(p);
    const n = /^\d+$/.test(q);
    if (m && n && +p !== +q) return Math.sign(+p - +q);
    if (m !== n) return m ? -1 : 1;
    if (!m && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export type Release = { tag: string; prerelease: boolean; url: string };

/** The newest release on the channel that is newer than `current`, or null. */
export function pickRelease(
  releases: Release[],
  channel: (typeof UPDATE_CHANNELS)[number],
  current: string,
): Release | null {
  let best: Release | null = null;
  for (const r of releases)
    if (
      RELEASE_TAG.test(r.tag) &&
      (channel === "dev" || !r.prerelease) &&
      compareVersions(r.tag, current) > 0 &&
      (!best || compareVersions(r.tag, best.tag) > 0)
    )
      best = r;
  return best;
}
