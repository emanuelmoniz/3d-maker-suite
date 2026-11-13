import type { Db } from "@3d-maker-suite/db";
import { isDue } from "../integrations/sync.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { listRoots, onDevice } from "./rootFs.ts";
import type { ProjectScanner } from "./scanner.ts";

/**
 * Each root's periodic rescan (its `rescan` schedule), checked on the minute tick. A hub root is
 * rescanned here; a device root's connector is told to index it again, while it's online. The
 * last runs are in memory: after a restart each root is due once, which costs only digests.
 */
export function createRescans(db: Db, scanner: Pick<ProjectScanner, "rescan">, hub: HubChannel) {
  const lastRun = new Map<string, string>();
  let busy = false;
  /** One at a time: a big share's walk may outlast a tick. */
  return async function tick(now = Date.now()) {
    if (busy) return;
    busy = true;
    try {
      for (const root of listRoots(db)) {
        const { enabled, ...schedule } = root.rescan;
        if (!enabled) continue;
        if (!isDue({ ...schedule, lastRunAt: lastRun.get(root.id) ?? null }, now)) continue;
        if (onDevice(root)) {
          // Offline: skipped, its connect indexes it anyway.
          if (!hub.tell(root.location, { type: "roots.rescan", rootId: root.id })) continue;
        } else await scanner.rescan(root);
        lastRun.set(root.id, new Date(now).toISOString());
      }
    } finally {
      busy = false;
    }
  };
}
