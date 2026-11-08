import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogSources, DesktopSlicer } from "@3d-maker-suite/core";
import { zipFolder } from "@3d-maker-suite/host";
import { catalogFingerprint } from "@3d-maker-suite/slicer-presets";
import { configDirOf } from "./presets.ts";
import type { Request } from "./roots.ts";

/** The fingerprint is cheap (ADR-0019): a look this often, as the hub's own tick does. */
const POLL_MS = 60_000;

/**
 * The catalog source's side (ADR-0020): for each library the hub says this device is the source of,
 * a look at the fingerprint of the slicer's `system/` on each tick, and the folder, zipped, when it
 * differs from the hub's copy. Nothing else of the config folder is sent.
 */
export function createCatalogSend({
  request,
  slicers,
  dataDir,
  log,
  configDir = configDirOf,
  pollMs = POLL_MS,
}: {
  request: Request;
  /** The found slicers, as the hub described them. */
  slicers: () => DesktopSlicer[];
  dataDir: string;
  log: (line: string) => void;
  /** Where a slicer's config is, and the timing (tests). */
  configDir?: (slicer: DesktopSlicer) => string;
  pollMs?: number;
}) {
  /** Library → the hub copy's fingerprint; from the connect's header and `catalog.sources`. */
  let sources: CatalogSources = {};
  let poll: NodeJS.Timeout | undefined;
  let looking: Promise<void> | undefined;

  async function send(library: string) {
    const slicer = slicers().find((s) => s.library === library);
    if (!slicer) return;
    const dir = configDir(slicer);
    const now = await catalogFingerprint(dir);
    if (!now || now === sources[library]) return;
    const file = join(dataDir, "catalog.zip");
    try {
      await zipFolder(join(dir, "system"), file, "system/");
      const res = await request(`/catalog/${encodeURIComponent(library)}`, {
        method: "PUT",
        file: { stream: createReadStream(file) },
      });
      // No longer the source: the hub says so too, with the next `catalog.sources`.
      if (res.status === 403) delete sources[library];
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else {
        sources[library] = now;
        log(`catalog ${library}: sent ${now}`);
      }
    } finally {
      await rm(file, { force: true });
    }
  }

  /** One look at a time. */
  function look() {
    looking ??= (async () => {
      for (const library of Object.keys(sources))
        await send(library).catch((e) =>
          log(`catalog ${library}: ${e instanceof Error ? e.message : e}`),
        );
    })().finally(() => {
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
    /** Connected, or the hub changed the sources: looks now, and on each tick while any is left. */
    set(next: CatalogSources) {
      sources = { ...next };
      stop();
      if (!Object.keys(sources).length) return Promise.resolve();
      poll = setInterval(() => void look(), pollMs);
      poll.unref();
      return looking ? looking.then(look) : look();
    },
  };
}
