import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull, like, ne, or } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { HttpError } from "../errors.ts";

const { alerts } = schema;

/** A `PATCH`'s `archived` as the value to set; left out, the column stays as it is. */
export const archivedAtOf = (archived?: boolean) =>
  archived === undefined ? undefined : archived ? new Date().toISOString() : null;

/** A list's `?archived=`: only archived rows, both, or (the default) only active ones. */
export const archivedWhere = (column: SQLiteColumn, archived?: string) =>
  archived === "all" ? undefined : archived === "true" ? isNotNull(column) : isNull(column);

/**
 * A new reference has to be a row that exists and isn't archived. The one the row already has
 * (`was`) is always fine, so a row with an archived parent can still be edited (ADR-0018).
 */
export function canReference(
  db: Db,
  table: SQLiteTable & { id: SQLiteColumn; archivedAt: SQLiteColumn },
  id: string,
  was?: string | null,
) {
  if (id === was) return true;
  // Loosely typed on purpose: one lookup for every archivable table.
  const t = table as unknown as typeof schema.brands;
  return !!db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.id, id), isNull(t.archivedAt)))
    .get();
}

/** The `task` patterns of an item's alerts (a `maintenance:` task is `<target>:<type>`). */
export const alertTasks = {
  spool: (id: string) => [`spool:${id}`],
  printer: (id: string) => [`printer:${id}`, `maintenance:${id}:%`],
  accessory: (id: string) => [`maintenance:${id}:%`],
  maintenanceType: (id: string) => [`maintenance:%:${id}`],
  project: (id: string) => [`project:${id}`],
};

/**
 * An archived item's open alerts leave everyone's list now: condition alerts would wait for the
 * next evaluation and one-shots never resolve. A restored item's come back as new (ADR-0018).
 */
export function resolveItemAlerts(tx: Pick<Db, "update">, tasks: string[]) {
  const now = new Date().toISOString();
  tx.update(alerts)
    .set({ resolvedAt: now, updatedAt: now })
    .where(and(isNull(alerts.resolvedAt), or(...tasks.map((t) => like(alerts.task, t)))))
    .run();
}

/**
 * `*_source_uq` holds one current row per preset, so an old version can't come back beside it. A
 * hand-made preset stays archived (ADR-0020): no slicer has its file, so it can't slice.
 */
export function assertPresetFree(
  db: Db,
  table:
    | typeof schema.machinePresets
    | typeof schema.processPresets
    | typeof schema.filamentPresets,
  row: { id: string; sourcePreset: string | null },
) {
  if (!row.sourcePreset)
    throw new HttpError(409, "hand_made", "A preset made by hand can't be restored");
  // Loosely typed on purpose: one lookup for three tables.
  const t = table as typeof schema.machinePresets;
  const current = db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.sourcePreset, row.sourcePreset), isNull(t.archivedAt), ne(t.id, row.id)))
    .get();
  if (current)
    throw new HttpError(409, "preset_newer_exists", "A newer version of this preset exists");
}
