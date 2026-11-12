import type { Pick, PickAccessInput, PickLevel } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { HttpError } from "../errors.ts";

const { devicePickAccess, devicePicks, devices, roles, roots, users } = schema;

/** `path` is the pick's folder or inside it ("" = the whole root). */
export const pickCovers = (pick: string, path: string) =>
  pick === "" || path === pick || path.startsWith(`${pick}/`);

/**
 * What a machine receives (ADR-0021): per hub path, the highest level of its unpaused picks that
 * list its user, directly or through their role; null = not picked. Receive off = nothing. The
 * user's own rights still cap it (`HubFiles.changes`).
 */
export function pickLevels(db: Db, deviceId: string) {
  const d = db
    .select({ userId: devices.userId, roleId: users.roleId, receive: devices.receiveProjects })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(eq(devices.id, deviceId))
    .get();
  const rows = !d?.receive
    ? []
    : db
        .select({
          rootId: devicePicks.rootId,
          path: devicePicks.path,
          level: devicePickAccess.level,
        })
        .from(devicePicks)
        .innerJoin(devicePickAccess, eq(devicePickAccess.pickId, devicePicks.id))
        .where(
          and(
            eq(devicePicks.deviceId, deviceId),
            eq(devicePicks.paused, false),
            or(eq(devicePickAccess.userId, d.userId), eq(devicePickAccess.roleId, d.roleId)),
          ),
        )
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

/** A machine's picks with their lists, as Projects settings → Sources shows them. */
export function picksOf(db: Db, deviceId: string): Pick[] {
  const list = db
    .select({
      id: devicePicks.id,
      rootId: devicePicks.rootId,
      rootName: roots.name,
      path: devicePicks.path,
      paused: devicePicks.paused,
    })
    .from(devicePicks)
    .innerJoin(roots, eq(roots.id, devicePicks.rootId))
    .where(eq(devicePicks.deviceId, deviceId))
    .orderBy(asc(roots.position), asc(devicePicks.path))
    .all();
  if (!list.length) return [];
  const access = db
    .select({
      pickId: devicePickAccess.pickId,
      userId: devicePickAccess.userId,
      roleId: devicePickAccess.roleId,
      level: devicePickAccess.level,
      userName: users.displayName,
      roleName: roles.name,
    })
    .from(devicePickAccess)
    .leftJoin(users, eq(users.id, devicePickAccess.userId))
    .leftJoin(roles, eq(roles.id, devicePickAccess.roleId))
    .where(
      inArray(
        devicePickAccess.pickId,
        list.map((p) => p.id),
      ),
    )
    .all();
  return list.map((p) => ({
    ...p,
    access: access
      .filter((a) => a.pickId === p.id)
      .map((a) => ({
        userId: a.userId,
        roleId: a.roleId,
        name: a.userName ?? a.roleName ?? "",
        level: a.level,
      }))
      // People first, then roles; by name.
      .sort((a, b) => Number(!a.userId) - Number(!b.userId) || a.name.localeCompare(b.name)),
  }));
}

/** 400 for a user or role that isn't there (the list comes from the browser). */
function checkAccess(db: Db, access: PickAccessInput[]) {
  const userIds = access.flatMap((a) => (a.userId ? [a.userId] : []));
  const roleIds = access.flatMap((a) => (a.roleId ? [a.roleId] : []));
  const found =
    (userIds.length
      ? db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)).all().length
      : 0) +
    (roleIds.length
      ? db.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds)).all().length
      : 0);
  if (found !== userIds.length + roleIds.length)
    throw new HttpError(400, "validation_error", "Unknown user or role");
}

/** Replaces a pick's list. */
export function setPickAccess(db: Db, pickId: string, access: PickAccessInput[]) {
  checkAccess(db, access);
  db.transaction((tx) => {
    tx.delete(devicePickAccess).where(eq(devicePickAccess.pickId, pickId)).run();
    tx.insert(devicePickAccess)
      .values(access.map((a) => ({ pickId, userId: a.userId, roleId: a.roleId, level: a.level })))
      .run();
  });
}

/**
 * The pick for `path` of a root, made if missing and unpaused; its list gains whoever of `access`
 * isn't on it yet (someone on it keeps their level). Open on a machine and pairing use it.
 */
export function ensurePick(
  db: Db,
  deviceId: string,
  rootId: string,
  path: string,
  access: PickAccessInput[],
) {
  checkAccess(db, access);
  return db.transaction((tx) => {
    const id =
      tx
        .insert(devicePicks)
        .values({ deviceId, rootId, path })
        .onConflictDoUpdate({
          target: [devicePicks.deviceId, devicePicks.rootId, devicePicks.path],
          set: { paused: false, updatedAt: new Date().toISOString() },
        })
        .returning({ id: devicePicks.id })
        .get()?.id ?? "";
    if (access.length)
      tx.insert(devicePickAccess)
        .values(
          access.map((a) => ({ pickId: id, userId: a.userId, roleId: a.roleId, level: a.level })),
        )
        .onConflictDoNothing()
        .run();
    return id;
  });
}
