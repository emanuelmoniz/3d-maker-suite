import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

// A spool's links to the spool libraries it is in (`spool_sources`): one per library, so the
// same physical spool imported from Bambu Cloud and from Spoolman is one spool.

const { spools, spoolSources } = schema;
type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

/** The library of a key (`spoolman` of `spoolman:15`): the part before its first `:`. */
export const libraryOfKey = (source: string) => source.slice(0, Math.max(0, source.indexOf(":")));

const active = isNull(spoolSources.unlinkedAt);

/** `select()` field of a spools query: the keys the spool is linked by. */
export const spoolKeys = sql<string[]>`(
  SELECT json_group_array(${spoolSources.source}) FROM ${spoolSources}
  WHERE ${spoolSources.spoolId} = ${spools.id} AND ${spoolSources.unlinkedAt} IS NULL
)`.mapWith((v: string) => JSON.parse(v));

/**
 * Links the spool to a library's spool, unless it is linked to another one of that library
 * already, or that library spool is another spool's. A library you unlinked is linked again.
 * False when nothing was linked.
 */
export function linkSpool(tx: Tx, spoolId: string, source: string, at = new Date().toISOString()) {
  const library = libraryOfKey(source);
  if (!library) return false;
  const taken = tx
    .select({ spoolId: spoolSources.spoolId })
    .from(spoolSources)
    .where(and(eq(spoolSources.source, source), active))
    .get();
  if (taken) return taken.spoolId === spoolId;
  const row = tx
    .insert(spoolSources)
    .values({ spoolId, library, source, linkedAt: at })
    .onConflictDoUpdate({
      target: [spoolSources.spoolId, spoolSources.library],
      set: { source, linkedAt: at, unlinkedAt: null },
      setWhere: isNotNull(spoolSources.unlinkedAt),
    })
    .returning({ source: spoolSources.source })
    .get();
  return row?.source === source;
}

/** The library spool is no spool's any more (imported as a new spool, which takes it). */
export const releaseSource = (tx: Tx, source: string) =>
  tx
    .delete(spoolSources)
    .where(and(eq(spoolSources.source, source), active))
    .run();

/**
 * You unlinked the library from the spool: the link stays as a mark (`unlinkedAt`), so nothing
 * of that library is suggested for it or made there for it again. Returns the key it had.
 */
export function unlinkSpool(tx: Tx, spoolId: string, library: string) {
  return tx
    .update(spoolSources)
    .set({ unlinkedAt: new Date().toISOString() })
    .where(and(eq(spoolSources.spoolId, spoolId), eq(spoolSources.library, library), active))
    .returning({ source: spoolSources.source })
    .get()?.source;
}

/** The keys a spool is linked by now. */
export const sourcesOf = (db: Tx, spoolId: string) =>
  db
    .select({ source: spoolSources.source })
    .from(spoolSources)
    .where(and(eq(spoolSources.spoolId, spoolId), active))
    .all()
    .map((r) => r.source);

/** Linked spools by key: the active spools, or the archived ones. */
export const spoolsByKey = (db: Db, archived = false) =>
  new Map(
    db
      .select({ source: spoolSources.source, id: spools.id })
      .from(spoolSources)
      .innerJoin(spools, eq(spools.id, spoolSources.spoolId))
      .where(and(active, archived ? isNotNull(spools.archivedAt) : isNull(spools.archivedAt)))
      .all()
      .map((r) => [r.source, r.id] as const),
  );

/** Spools with a link to the library, or that you unlinked from it: none of its rows is theirs. */
export const heldBy = (db: Db, library: string) =>
  new Set(
    db
      .select({ id: spoolSources.spoolId })
      .from(spoolSources)
      .where(eq(spoolSources.library, library))
      .all()
      .map((r) => r.id),
  );

/** A library's links now: spool id -> the library's own spool id, and when each was linked. */
export function libraryLinks(db: Db, library: string) {
  const rows = db
    .select({ id: spoolSources.spoolId, source: spoolSources.source, at: spoolSources.linkedAt })
    .from(spoolSources)
    .where(and(eq(spoolSources.library, library), active))
    .all();
  const prefix = `${library}:`;
  return {
    linked: new Map(rows.map((r) => [r.id, r.source.slice(prefix.length)])),
    /** Null = linked before links had a time (all its prints are history). */
    since: new Map(rows.map((r) => [r.id, r.at])),
  };
}
