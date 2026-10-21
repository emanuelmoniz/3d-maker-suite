import {
  appliesToAccessory,
  appliesToPrinter,
  type MaintenanceDueItem,
  maintenanceDue,
  type UsageSnapshot,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq, isNull, lte, type SQL, sql, sum } from "drizzle-orm";
import { accessoryTitle, printerTitle } from "./numbers.ts";

const { accessories, maintenanceTypes, maintenanceTasks, printers, prints } = schema;

/** Lifetime runtime and print count (offsets + logged prints), optionally up to a date. */
export const usageOf = (db: Db, p: typeof printers.$inferSelect, upTo?: string): UsageSnapshot => {
  const row = db
    .select({ sec: sum(prints.durationSec), n: count() })
    .from(prints)
    .where(and(eq(prints.printerId, p.id), upTo ? lte(prints.startedAt, upTo) : undefined))
    .get();
  return {
    at: upTo ?? new Date().toISOString(),
    runtimeSec: p.runtimeOffsetSec + Number(row?.sec ?? 0),
    prints: p.printsOffset + (row?.n ?? 0),
  };
};

/** `usageOf` as SQL for a select (list sort/filter). Qualified: "id" in the subquery is the print's. */
export const printerUsageColumns = () => {
  const of = (column: string) => sql.raw(`"printers"."${column}"`);
  const logged = (what: SQL) =>
    sql<number>`(SELECT coalesce(${what}, 0) FROM prints p WHERE p.printer_id = ${of("id")})`;
  return {
    runtimeSec: sql<number>`${of("runtime_offset_sec")} + ${logged(sql`sum(p.duration_sec)`)}`,
    prints: sql<number>`${of("prints_offset")} + ${logged(sql`count(*)`)}`,
    // Whole percent of logged prints that succeeded (same as printer page and stats); null without prints.
    successRate: sql<
      number | null
    >`(SELECT round(100.0 * sum(p.outcome = 'success') / count(*)) FROM prints p WHERE p.printer_id = ${of("id")})`,
  };
};

/**
 * Prints of the printer an accessory was on, started inside an install period `[installedAt,
 * removedAt)`. Periods never overlap, so a print matches at most one. Aliased plain SQL: the
 * columns are spliced into other queries, where Drizzle would leave them unqualified.
 */
const accessoryPrints = (accessoryId: SQL | string, upTo?: string, what = sql`count(*)`) =>
  sql<number>`(SELECT coalesce(${what}, 0) FROM prints p JOIN accessory_installs i
    ON i.printer_id = p.printer_id AND p.started_at >= i.installed_at
    AND (i.removed_at IS NULL OR p.started_at < i.removed_at)
    WHERE i.accessory_id = ${accessoryId}${upTo ? sql` AND p.started_at <= ${upTo}` : sql``})`;

/** Runtime and print count of an accessory, as SQL for a select (list sort/filter). */
export const accessoryUsageColumns = (accessoryId: SQL) => ({
  runtimeSec: accessoryPrints(accessoryId, undefined, sql`sum(p.duration_sec)`),
  prints: accessoryPrints(accessoryId),
});

/** Like `usageOf`, for an accessory (no offsets: it starts at 0). */
export const accessoryUsageOf = (db: Db, accessoryId: string, upTo?: string): UsageSnapshot => {
  const row = db.get<{ sec: number; n: number }>(
    sql`SELECT ${accessoryPrints(accessoryId, upTo, sql`sum(p.duration_sec)`)} AS sec, ${accessoryPrints(accessoryId, upTo)} AS n`,
  );
  return { at: upTo ?? new Date().toISOString(), runtimeSec: row.sec, prints: row.n };
};

/** Every active printer and accessory x applicable type, unsorted. */
export function dueItems(
  db: Db,
  only: { printerId?: string; accessoryId?: string } = {},
): MaintenanceDueItem[] {
  const types = db.select().from(maintenanceTypes).where(isNull(maintenanceTypes.archivedAt)).all();
  // Oldest first, so the last task seen per target x type is the latest.
  const lastDone = new Map<string, typeof maintenanceTasks.$inferSelect>();
  for (const t of db.select().from(maintenanceTasks).orderBy(asc(maintenanceTasks.doneAt)).all())
    lastDone.set(`${t.printerId ?? t.accessoryId}:${t.typeId}`, t);

  const items: MaintenanceDueItem[] = [];
  const add = (
    target: MaintenanceDueItem["target"],
    t: { id: string; purchasedAt: string | null; createdAt: string },
    targetName: string,
    type: typeof maintenanceTypes.$inferSelect,
    now: UsageSnapshot,
  ) => {
    const last = lastDone.get(`${t.id}:${type.id}`);
    // Never done: counts from purchase (or from when it was added).
    const since: UsageSnapshot = last
      ? { at: last.doneAt, runtimeSec: last.printerRuntimeSecAt, prints: last.printerPrintsAt }
      : { at: t.purchasedAt ?? t.createdAt, runtimeSec: 0, prints: 0 };
    items.push({
      target,
      targetId: t.id,
      targetName,
      typeId: type.id,
      typeName: type.name,
      lastDoneAt: last?.doneAt ?? null,
      ...maintenanceDue(type, since, now),
    });
  };

  if (!only.accessoryId)
    for (const p of db
      .select()
      .from(printers)
      .where(
        and(
          isNull(printers.archivedAt),
          only.printerId ? eq(printers.id, only.printerId) : undefined,
        ),
      )
      .all()) {
      const applicable = types.filter((type) => appliesToPrinter(type, p));
      if (!applicable.length) continue;
      const now = usageOf(db, p);
      for (const type of applicable) add("printer", p, printerTitle(p), type, now);
    }

  if (!only.printerId)
    for (const a of db
      .select()
      .from(accessories)
      .where(
        and(
          isNull(accessories.archivedAt),
          only.accessoryId ? eq(accessories.id, only.accessoryId) : undefined,
        ),
      )
      .all()) {
      const applicable = types.filter((type) => appliesToAccessory(type, a));
      if (!applicable.length) continue;
      const now = accessoryUsageOf(db, a.id);
      for (const type of applicable) add("accessory", a, accessoryTitle(a), type, now);
    }
  return items;
}
