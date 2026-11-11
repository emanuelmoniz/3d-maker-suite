import { join } from "node:path";
import type { IntegrationAdapter, PresetInstallSaved } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { installPresets, listProcesses } from "@3d-maker-suite/host";
import { and, eq } from "drizzle-orm";
import { readPreferences } from "../lib/preferences.ts";
import { presetLibrary, slicerConfigDir } from "./capabilities.ts";
import { presetInstallList, presetSkipped } from "./presetLibrary.ts";

const { integrations, slicerPresets } = schema;
/** As a connector's poll: a closed slicer or a hub change needs nothing sooner. */
const POLL_MS = 30_000;

/**
 * This server's own install receives the hub's user presets (5.5.0 Step 11i), as a machine does
 * (`apps/connector/src/presetInstall.ts`): a local slicer with Receive on gets every user preset
 * of its library, only while it's closed, a backup first. Its state is kept on the row.
 */
export function createServerPresets(
  db: Db,
  adapters: IntegrationAdapter[],
  dataDir: string,
  log: (line: string) => void,
  {
    processes = listProcesses,
    pollMs = POLL_MS,
  }: {
    /** The server's processes and the timing (tests). */
    processes?: () => Promise<string>;
    pollMs?: number;
  } = {},
) {
  let poll: NodeJS.Timeout | undefined;
  let passing: Promise<void> | undefined;
  /** Reported as skipped since the start, when their parent gets another look. */
  const skipped = new Set<string>();

  const receiving = (id: string) =>
    !!db
      .select({ on: integrations.presetReceive })
      .from(integrations)
      .where(eq(integrations.id, id))
      .get()?.on;

  async function one(row: typeof integrations.$inferSelect, adapter: IntegrationAdapter) {
    const dir = slicerConfigDir(row, adapter);
    if (!adapter.desktop || !dir) return null;
    const library = presetLibrary(adapter);
    const libraries = new Set([library]);
    const saved: PresetInstallSaved = row.presetState ?? {};
    let changed = false;
    const status = await installPresets({
      slicer: { id: row.id, library, ...adapter.desktop },
      dir,
      live: presetInstallList(db, libraries, null, false),
      deleted: presetInstallList(db, libraries, null, true),
      state: {
        get: () => saved,
        touch: () => {
          changed = true;
        },
        persist() {
          if (!changed) return;
          db.update(integrations)
            .set({ presetState: saved })
            .where(eq(integrations.id, row.id))
            .run();
          changed = false;
        },
      },
      skipped,
      alive: () => receiving(row.id),
      processes,
      backupFile: join(dataDir, "preset-backups", `${row.id}.zip`),
      log,
      async fetch(p) {
        const found = db
          .select({ json: slicerPresets.json, deleted: slicerPresets.deleted })
          .from(slicerPresets)
          .where(eq(slicerPresets.id, p.id))
          .get();
        if (!found || found.deleted) throw new Error("not found");
        return found.json;
      },
      async skip(p) {
        presetSkipped(db, p, { id: `server:${row.id}`, name: adapter.id });
      },
    });
    return status;
  }

  /** One pass at a time, over every local slicer with Receive on. Resolves when it's done. */
  function pass(): Promise<void> {
    passing ??= (async () => {
      if (!readPreferences(db).hubEnabled) return;
      for (const row of db.select().from(integrations).all()) {
        const adapter = adapters.find((a) => a.id === row.adapterId);
        if (!row.presetReceive || adapter?.kind !== "local" || !adapter.library) continue;
        const status = await one(row, adapter).catch((e) => {
          log(`presets: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        });
        if (status === undefined) continue;
        // Turned off during the pass: its state stays cleared.
        db.update(integrations)
          .set({ presetInstall: status })
          .where(and(eq(integrations.id, row.id), eq(integrations.presetReceive, true)))
          .run();
      }
    })().finally(() => {
      passing = undefined;
    });
    return passing;
  }

  return {
    pass,
    start() {
      poll ??= setInterval(() => void pass(), pollMs);
      poll.unref();
    },
    stop() {
      clearInterval(poll);
      poll = undefined;
    },
  };
}
export type ServerPresets = ReturnType<typeof createServerPresets>;
