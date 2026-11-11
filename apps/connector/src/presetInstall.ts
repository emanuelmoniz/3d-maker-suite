import { join } from "node:path";
import {
  type DesktopSlicer,
  type PresetInstallItem,
  type PresetInstallSlicer,
  presetInstallItemSchema,
} from "@3d-maker-suite/core";
import { installPresets, listProcesses } from "@3d-maker-suite/host";
import { z } from "zod";
import { configDirOf, type PresetState } from "./presets.ts";
import type { Request } from "./roots.ts";
import { presetsOn, type Store } from "./state.ts";

/** The queue is looked at this often: a closed slicer or a hub change needs nothing sooner. */
const POLL_MS = 30_000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Install hub presets (ADR-0017): the hub's presets go to the user preset folder of the account each
 * found slicer last used, while that slicer is closed. Nothing is queued on disk: what's waiting is
 * the difference between the hub's lists and `installed`, so a restart or a sign-in loses nothing.
 * A preset deleted on this desktop is written back unless the hub acts on that removal, and one
 * deleted on the hub is deleted here, if this copy is the hub's (ADR-0019).
 */
export function createPresetInstall({
  request,
  store,
  state,
  slicers,
  dataDir,
  log,
  beforeWrite = async () => {},
  configDir = configDirOf,
  processes = listProcesses,
  pollMs = POLL_MS,
}: {
  request: Request;
  store: Store;
  state: PresetState;
  /** The found slicers, as the hub described them. */
  slicers: () => DesktopSlicer[];
  dataDir: string;
  log: (line: string) => void;
  /** Runs at the start of each pass: what's unsent goes to the hub first (Share's look). */
  beforeWrite?: () => Promise<void>;
  /** Where a slicer's config is, the process list and the timing (tests). */
  configDir?: (slicer: DesktopSlicer) => string;
  processes?: () => Promise<string>;
  pollMs?: number;
}) {
  let on = false;
  let poll: NodeJS.Timeout | undefined;
  let passing: Promise<void> | undefined;
  let lastReport = "";
  /** Reported as skipped since the last connect, when their parent gets another look. */
  const skipped = new Set<string>();

  const flush = (slicer: DesktopSlicer, live: PresetInstallItem[], deleted: PresetInstallItem[]) =>
    installPresets({
      slicer,
      dir: configDir(slicer),
      live,
      deleted,
      state,
      skipped,
      alive: () => on,
      processes,
      backupFile: join(dataDir, "preset-backups", `${slicer.id}.zip`),
      log,
      async fetch(p) {
        const res = await request(`/presets/${p.id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
      async skip(p) {
        const res = await request("/presets/skipped", {
          method: "POST",
          body: { library: p.library, kind: p.kind, name: p.name, sha256: p.sha256 },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
      // Share knows the file came from the hub, so it has nothing to send back.
      onRecord(p, key, mtimeMs) {
        const files = state.get().files;
        files[key] = { ...files[key], name: p.name, sha: p.sha256, base: p.version, mtimeMs };
      },
      onDelete(key) {
        delete state.get().files[key];
      },
    });

  /** One pass at a time; the next poll takes what's new. Resolves when it's done. */
  function pass(): Promise<void> {
    passing ??= (async () => {
      // What's unsent goes to the hub first: an edit isn't lost, and a removal it just heard of
      // isn't written back from a list read before it (`removedHere`).
      await beforeWrite();
      const list = async (path: string) => {
        const res = await request(path);
        if (res.status === 403) return null; // the switch just went off
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return z.array(presetInstallItemSchema).parse(await res.json());
      };
      const live = await list("/presets");
      const deleted = live && (await list("/presets/deleted"));
      if (!live || !deleted) return;
      const status: PresetInstallSlicer[] = [];
      // Only the slicers Install is on for (ADR-0020); the hub lists only their libraries.
      for (const slicer of slicers().filter((s) => presetsOn(store.get(), "install", s.library))) {
        if (!on) return;
        const one = await flush(slicer, live, deleted);
        if (one) status.push(one);
      }
      const text = JSON.stringify(status);
      if (!on || text === lastReport) return;
      const put = await request("/presets/install", { method: "PUT", body: status });
      if (put.ok) lastReport = text;
    })()
      .catch((e) => log(`presets: ${message(e)}`))
      .finally(() => {
        passing = undefined;
      });
    return passing;
  }

  function stop() {
    on = false;
    clearInterval(poll);
  }

  return {
    stop,
    /** A pass now, if a switch is on (tests). */
    pass: () => (on ? pass() : Promise.resolve()),
    /** Connected, or a switch changed: looks now and keeps looking, if one is on. */
    start() {
      stop();
      if (!presetsOn(store.get(), "install")) return Promise.resolve();
      on = true;
      lastReport = "";
      skipped.clear();
      poll = setInterval(() => void pass(), pollMs);
      poll.unref();
      return pass();
    },
  };
}
