import {
  appliesToPrinter,
  type MaintenanceDueItem,
  maintenanceDue,
  type UsageSnapshot,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq, isNull, lte, sum } from "drizzle-orm";

const { maintenanceTypes, maintenanceTasks, printers, prints } = schema;

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

/** Every active printer x applicable type, unsorted. */
export function dueItems(db: Db, printerId?: string): MaintenanceDueItem[] {
  const types = db.select().from(maintenanceTypes).where(isNull(maintenanceTypes.archivedAt)).all();
  const active = db
    .select()
    .from(printers)
    .where(and(isNull(printers.archivedAt), printerId ? eq(printers.id, printerId) : undefined))
    .all();
  // Oldest first, so the last task seen per printer x type is the latest.
  const lastDone = new Map<string, typeof maintenanceTasks.$inferSelect>();
  for (const t of db.select().from(maintenanceTasks).orderBy(asc(maintenanceTasks.doneAt)).all())
    lastDone.set(`${t.printerId}:${t.typeId}`, t);

  const items: MaintenanceDueItem[] = [];
  for (const p of active) {
    const now = usageOf(db, p);
    for (const type of types) {
      if (!appliesToPrinter(type.appliesToModel, p.model)) continue;
      const last = lastDone.get(`${p.id}:${type.id}`);
      // Never done: counts from purchase (or from when the printer was added).
      const since: UsageSnapshot = last
        ? { at: last.doneAt, runtimeSec: last.printerRuntimeSecAt, prints: last.printerPrintsAt }
        : { at: p.purchasedAt ?? p.createdAt, runtimeSec: 0, prints: 0 };
      items.push({
        printerId: p.id,
        printerName: p.name,
        typeId: type.id,
        typeName: type.name,
        lastDoneAt: last?.doneAt ?? null,
        ...maintenanceDue(type, since, now),
      });
    }
  }
  return items;
}
