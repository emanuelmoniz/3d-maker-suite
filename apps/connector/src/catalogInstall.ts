import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CatalogInstallSlicer, CatalogSources, DesktopSlicer } from "@3d-maker-suite/core";
import { extract, zipFolder } from "@3d-maker-suite/host";
import { catalogFingerprint } from "@3d-maker-suite/slicer-presets";
import { isRunningIn, listProcesses } from "./presetInstall.ts";
import { configDirOf } from "./presets.ts";
import type { Request } from "./roots.ts";

/** The fingerprint is cheap (ADR-0019): a look this often, as the catalog source's. */
const POLL_MS = 60_000;
/** What a slicer reads of `system/`; the hub's mark and anything else stay out. */
const PRESET_FILE = /^system\/.+\.(json|opc|png)$/;

/**
 * Receive catalog (ADR-0021): for each library the hub says this device receives, the hub's copy
 * of the catalog source's `system/` when its fingerprint differs from the slicer's own; written
 * only while the slicer is closed, after a zip of the folder. The copy is laid over the folder:
 * nothing is deleted, so the slicer's own files (bed models, textures) stay. A slicer update that
 * recopies `system/` changes its fingerprint, so the copy is written again.
 */
export function createCatalogInstall({
  request,
  slicers,
  dataDir,
  log,
  configDir = configDirOf,
  processes = listProcesses,
  pollMs = POLL_MS,
}: {
  request: Request;
  /** The found slicers, as the hub described them. */
  slicers: () => DesktopSlicer[];
  dataDir: string;
  log: (line: string) => void;
  /** Where a slicer's config is, its processes and the timing (tests). */
  configDir?: (slicer: DesktopSlicer) => string;
  processes?: () => Promise<string>;
  pollMs?: number;
}) {
  /** Library → the hub copy's fingerprint; from the connect's header and `catalog.install`. */
  let installs: CatalogSources = {};
  let poll: NodeJS.Timeout | undefined;
  let looking: Promise<void> | undefined;
  let reported: string | undefined;

  // ponytail: only the last write's backup is kept, as Install's (ADR-0017); keep more if one isn't enough.
  const backupOf = (slicer: DesktopSlicer) => join(dataDir, "catalog-backups", `${slicer.id}.zip`);

  async function write(library: string, slicer: DesktopSlicer, dir: string) {
    const zip = join(dataDir, "catalog-in.zip");
    try {
      const res = await request(`/catalog/${encodeURIComponent(library)}/system`, { long: true });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(
        Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
        createWriteStream(zip),
      );
      // A failed backup stops the write.
      await zipFolder(join(dir, "system"), backupOf(slicer), "system/");
      await extract(zip, dir, (name) => PRESET_FILE.test(name));
    } finally {
      await rm(zip, { force: true });
    }
  }

  async function one(library: string): Promise<CatalogInstallSlicer | null> {
    const slicer = slicers().find((s) => s.library === library);
    if (!slicer) return null;
    const dir = configDir(slicer);
    const hub = installs[library] ?? null;
    let fingerprint = await catalogFingerprint(dir);
    let waiting = false;
    let error: string | null = null;
    if (hub && fingerprint !== hub) {
      if (isRunningIn(await processes(), slicer.process)) waiting = true;
      else
        try {
          await write(library, slicer, dir);
          fingerprint = await catalogFingerprint(dir);
          log(`catalog ${library}: received ${hub}`);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          log(`catalog ${library}: ${error}`);
        }
    }
    const backup = await stat(backupOf(slicer)).then(
      (s) => ({ path: backupOf(slicer), at: s.mtime.toISOString() }),
      () => null,
    );
    return { library, hub, fingerprint, waiting, backup, error };
  }

  /** One look at a time; the hub hears only a report that changed. */
  function look() {
    looking ??= (async () => {
      const report: CatalogInstallSlicer[] = [];
      for (const library of Object.keys(installs)) {
        const s = await one(library);
        if (s) report.push(s);
      }
      const text = JSON.stringify(report);
      if (text === reported) return;
      const res = await request("/catalog-install", { method: "PUT", body: report });
      if (res.ok) reported = text;
    })()
      .catch((e) => log(`catalog install: ${e instanceof Error ? e.message : e}`))
      .finally(() => {
        looking = undefined;
      });
    return looking;
  }

  function stop() {
    clearInterval(poll);
    poll = undefined;
  }

  return {
    stop,
    /** Connected, or the hub changed what it receives: looks now, and on each tick while any is left. */
    set(next: CatalogSources) {
      installs = { ...next };
      reported = undefined;
      stop();
      if (!Object.keys(installs).length) return Promise.resolve();
      poll = setInterval(() => void look(), pollMs);
      poll.unref();
      return looking ? looking.then(look) : look();
    },
  };
}
