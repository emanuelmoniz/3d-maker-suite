import type { Pick, PickLevel } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq } from "drizzle-orm";

const { devicePicks, devices, roots } = schema;

/** `path` is the pick's folder or inside it ("" = the whole root). */
export const pickCovers = (pick: string, path: string) =>
  pick === "" || path === pick || path.startsWith(`${pick}/`);

/**
 * What a machine receives (ADR-0021): per hub path, the highest level of its unpaused picks that
 * cover it; null = not picked. Receive off = nothing. The machine's user's own rights still cap it
 * (`HubFiles.changes`).
 */
export function pickLevels(db: Db, deviceId: string) {
  const d = db
    .select({ receive: devices.receiveProjects })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  const rows = !d?.receive
    ? []
    : db
        .select({ rootId: devicePicks.rootId, path: devicePicks.path, level: devicePicks.level })
        .from(devicePicks)
        .where(and(eq(devicePicks.deviceId, deviceId), eq(devicePicks.paused, false)))
        .all();
  return {
    roots: new Set(rows.map((r) => r.rootId)),
    level(rootId: string, path: string): PickLevel | null {
      let best: PickLevel | null = null;
      for (const r of rows)
        if (r.rootId === rootId && pickCovers(r.path, path)) {
          if (r.level === "edit") return "edit";
          best = "read";
        }
      return best;
    },
  };
}
export type PickLevels = ReturnType<typeof pickLevels>;

/** A machine's picks, as Projects settings → Sources shows them. */
export const picksOf = (db: Db, deviceId: string): Pick[] =>
  db
    .select({
      id: devicePicks.id,
      rootId: devicePicks.rootId,
      rootName: roots.name,
      path: devicePicks.path,
      level: devicePicks.level,
      paused: devicePicks.paused,
    })
    .from(devicePicks)
    .innerJoin(roots, eq(roots.id, devicePicks.rootId))
    .where(eq(devicePicks.deviceId, deviceId))
    .orderBy(asc(roots.position), asc(devicePicks.path))
    .all();

/**
 * The pick for `path` of a root, made at `level` if missing; an existing one is unpaused and keeps
 * its level. Open on a machine and pairing use it.
 */
export const ensurePick = (
  db: Db,
  deviceId: string,
  rootId: string,
  path: string,
  level: PickLevel,
) =>
  db
    .insert(devicePicks)
    .values({ deviceId, rootId, path, level })
    .onConflictDoUpdate({
      target: [devicePicks.deviceId, devicePicks.rootId, devicePicks.path],
      set: { paused: false, updatedAt: new Date().toISOString() },
    })
    .run();
