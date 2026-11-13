import {
  apiErrorSchema,
  appliesToAccessory,
  appliesToPrinter,
  type MaintenanceDueItem,
  maintenanceDue,
  type UsageSnapshot,
  usageCorrectionInputSchema,
  usageCorrectionSchema,
  usageTotalsSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, desc, eq, isNull, lte, type SQL, sql, sum } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { accessoryTitle, printerTitle } from "./numbers.ts";

const { accessories, maintenanceTypes, maintenanceTasks, printers, prints } = schema;

type Target = "printer_id" | "accessory_id";
/** The sum of a target's usage corrections (`delta_sec` or `delta_prints`), up to a date. */
const corrected = (
  target: Target,
  id: SQL | string,
  what: "delta_sec" | "delta_prints",
  upTo?: string,
) =>
  sql<number>`(SELECT coalesce(sum(c.${sql.raw(what)}), 0) FROM usage_corrections c
    WHERE c.${sql.raw(target)} = ${id}${upTo ? sql` AND c.created_at <= ${upTo}` : sql``})`;

/** Lifetime runtime and print count (corrections + logged prints), optionally up to a date. */
export const usageOf = (db: Db, p: { id: string }, upTo?: string): UsageSnapshot => {
  const row = db
    .select({
      sec: sum(prints.durationSec),
      n: count(),
      fixSec: corrected("printer_id", p.id, "delta_sec", upTo),
      fixPrints: corrected("printer_id", p.id, "delta_prints", upTo),
    })
    .from(prints)
    .where(and(eq(prints.printerId, p.id), upTo ? lte(prints.startedAt, upTo) : undefined))
    .get();
  return {
    at: upTo ?? new Date().toISOString(),
    runtimeSec: Number(row?.fixSec ?? 0) + Number(row?.sec ?? 0),
    prints: Number(row?.fixPrints ?? 0) + (row?.n ?? 0),
  };
};

/** `usageOf` as SQL for a select (list sort/filter). Qualified: "id" in the subquery is the print's. */
export const printerUsageColumns = () => {
  const of = (column: string) => sql.raw(`"printers"."${column}"`);
  const logged = (what: SQL) =>
    sql<number>`(SELECT coalesce(${what}, 0) FROM prints p WHERE p.printer_id = ${of("id")})`;
  return {
    runtimeSec: sql<number>`${corrected("printer_id", of("id"), "delta_sec")} + ${logged(sql`sum(p.duration_sec)`)}`,
    prints: sql<number>`${corrected("printer_id", of("id"), "delta_prints")} + ${logged(sql`count(*)`)}`,
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
  runtimeSec: sql<number>`${corrected("accessory_id", accessoryId, "delta_sec")} + ${accessoryPrints(accessoryId, undefined, sql`sum(p.duration_sec)`)}`,
  prints: sql<number>`${corrected("accessory_id", accessoryId, "delta_prints")} + ${accessoryPrints(accessoryId)}`,
});

/** Like `usageOf`, for an accessory. */
export const accessoryUsageOf = (db: Db, accessoryId: string, upTo?: string): UsageSnapshot => {
  const row = db.get<{ sec: number; n: number }>(
    sql`SELECT ${corrected("accessory_id", accessoryId, "delta_sec", upTo)} + ${accessoryPrints(accessoryId, upTo, sql`sum(p.duration_sec)`)} AS sec,
      ${corrected("accessory_id", accessoryId, "delta_prints", upTo)} + ${accessoryPrints(accessoryId, upTo)} AS n`,
  );
  return { at: upTo ?? new Date().toISOString(), runtimeSec: row.sec, prints: row.n };
};

/**
 * `GET /:id/usage` (the totals now), `POST /:id/usage` (the real totals now; the difference from the current ones is stored) and
 * `GET /:id/usage/history`, newest first, for printers and accessories.
 */
export function usageRoutes(
  app: Parameters<FastifyPluginAsyncZod>[0],
  db: Db,
  o: {
    target: "printerId" | "accessoryId";
    /** Throws 404 when the target doesn't exist. */
    get: (id: string) => unknown;
  },
) {
  const { usageCorrections: c } = schema;
  const of = (id: string) =>
    o.target === "printerId" ? usageOf(db, { id }) : accessoryUsageOf(db, id);
  const params = z.object({ id: z.uuid() });
  const notFound = { 404: apiErrorSchema };

  app.get(
    "/:id/usage",
    { schema: { params, response: { 200: usageTotalsSchema, ...notFound } } },
    async (req) => {
      o.get(req.params.id);
      const { runtimeSec, prints } = of(req.params.id);
      return { runtimeSec, prints };
    },
  );

  app.post(
    "/:id/usage",
    {
      schema: {
        params,
        body: usageCorrectionInputSchema,
        response: { 200: usageTotalsSchema, ...notFound },
      },
    },
    async (req) => {
      o.get(req.params.id);
      const now = of(req.params.id);
      const deltaSec = req.body.runtimeSec - now.runtimeSec;
      const deltaPrints = req.body.prints - now.prints;
      if (deltaSec || deltaPrints)
        db.insert(c)
          .values({
            [o.target]: req.params.id,
            deltaSec,
            deltaPrints,
            note: req.body.note ?? null,
            createdAt: now.at,
          })
          .run();
      const { runtimeSec, prints } = of(req.params.id);
      return { runtimeSec, prints };
    },
  );

  app.get(
    "/:id/usage/history",
    { schema: { params, response: { 200: z.array(usageCorrectionSchema), ...notFound } } },
    async (req) => {
      o.get(req.params.id);
      return db
        .select({
          id: c.id,
          deltaSec: c.deltaSec,
          deltaPrints: c.deltaPrints,
          note: c.note,
          createdAt: c.createdAt,
        })
        .from(c)
        .where(eq(c[o.target], req.params.id))
        .orderBy(desc(c.createdAt), desc(sql`rowid`))
        .all();
    },
  );
}

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
