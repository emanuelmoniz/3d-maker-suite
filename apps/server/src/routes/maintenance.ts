import {
  apiErrorSchema,
  appliesToPrinter,
  archivedFilter,
  idList,
  listQuery,
  type MaintenanceDueItem,
  type MaintenanceTask,
  type MaintenanceType,
  maintenanceDue,
  maintenanceDueItemSchema,
  maintenanceLogSchema,
  maintenanceTaskSchema,
  maintenanceTaskSortFields,
  maintenanceTypeInputSchema,
  maintenanceTypePatchSchema,
  maintenanceTypeSchema,
  maintenanceTypeSortFields,
  type Page,
  pageOf,
  type UsageSnapshot,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq, isNotNull, isNull, lte, sum } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { inIds, listPage } from "../lib/list.ts";

const { maintenanceTypes, maintenanceTasks, printers, prints } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

export const maintenanceRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const getType = (id: string) => {
      const row = db.select().from(maintenanceTypes).where(eq(maintenanceTypes.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Maintenance type not found");
      return row;
    };
    const getPrinter = (id: string) => {
      const row = db.select().from(printers).where(eq(printers.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Printer not found");
      return row;
    };

    /** Lifetime runtime and print count (offsets + logged prints), optionally up to a date. */
    const usageOf = (p: typeof printers.$inferSelect, upTo?: string): UsageSnapshot => {
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

    // --- Types
    app.get(
      "/types",
      {
        schema: {
          querystring: listQuery(maintenanceTypeSortFields, { archived: archivedFilter }),
          response: { 200: pageOf(maintenanceTypeSchema) },
        },
      },
      async (req) =>
        listPage(db, maintenanceTypes, req.query, {
          sort: { name: maintenanceTypes.name, createdAt: maintenanceTypes.createdAt },
          dateColumn: maintenanceTypes.createdAt,
          where: [
            req.query.archived === "true"
              ? isNotNull(maintenanceTypes.archivedAt)
              : isNull(maintenanceTypes.archivedAt),
          ],
        }) as Page<MaintenanceType>,
    );

    app.post(
      "/types",
      { schema: { body: maintenanceTypeInputSchema, response: { 201: maintenanceTypeSchema } } },
      async (req, reply) =>
        reply
          .status(201)
          .send(db.insert(maintenanceTypes).values(req.body).returning().get() as MaintenanceType),
    );

    // Tasks point at types, so there is no DELETE: send `{ archived: true }`.
    app.patch(
      "/types/:id",
      {
        schema: {
          params,
          body: maintenanceTypePatchSchema,
          response: { 200: maintenanceTypeSchema, ...notFound },
        },
      },
      async (req) => {
        getType(req.params.id);
        const { archived, ...fields } = req.body;
        const archivedAt =
          archived === undefined ? undefined : archived ? new Date().toISOString() : null;
        return db
          .update(maintenanceTypes)
          .set({ ...fields, archivedAt })
          .where(eq(maintenanceTypes.id, req.params.id))
          .returning()
          .get() as MaintenanceType;
      },
    );

    // --- Tasks (history of maintenance done)
    app.get(
      "/tasks",
      {
        schema: {
          querystring: listQuery(maintenanceTaskSortFields, {
            printerId: idList.optional(),
            typeId: idList.optional(),
          }),
          response: { 200: pageOf(maintenanceTaskSchema) },
        },
      },
      async (req) =>
        listPage(db, maintenanceTasks, req.query, {
          sort: { doneAt: maintenanceTasks.doneAt, createdAt: maintenanceTasks.createdAt },
          dateColumn: maintenanceTasks.doneAt,
          where: [
            inIds(maintenanceTasks.printerId, req.query.printerId),
            inIds(maintenanceTasks.typeId, req.query.typeId),
          ],
        }) as Page<MaintenanceTask>,
    );

    app.post(
      "/tasks",
      {
        schema: {
          body: maintenanceLogSchema,
          response: { 201: maintenanceTaskSchema, ...notFound },
        },
      },
      async (req, reply) => {
        const printer = getPrinter(req.body.printerId);
        if (getType(req.body.typeId).archivedAt)
          throw new HttpError(400, "type_archived", "Maintenance type is archived");
        const doneAt = req.body.doneAt ?? new Date().toISOString();
        const at = usageOf(printer, doneAt);
        const row = db
          .insert(maintenanceTasks)
          .values({
            ...req.body,
            doneAt,
            printerRuntimeSecAt: at.runtimeSec,
            printerPrintsAt: at.prints,
          })
          .returning()
          .get();
        return reply.status(201).send(row as MaintenanceTask);
      },
    );

    // --- Due: every active printer x applicable type, most urgent first.
    app.get(
      "/due",
      {
        schema: {
          querystring: z.object({
            printerId: z.uuid().optional(),
            /** `true` keeps only upcoming and overdue items. */
            attention: z.enum(["true", "false"]).default("false"),
          }),
          response: { 200: z.array(maintenanceDueItemSchema) },
        },
      },
      async (req) => {
        const types = db
          .select()
          .from(maintenanceTypes)
          .where(isNull(maintenanceTypes.archivedAt))
          .all();
        const active = db
          .select()
          .from(printers)
          .where(
            and(
              isNull(printers.archivedAt),
              req.query.printerId ? eq(printers.id, req.query.printerId) : undefined,
            ),
          )
          .all();
        // Oldest first, so the last task seen per printer x type is the latest.
        const lastDone = new Map<string, typeof maintenanceTasks.$inferSelect>();
        for (const t of db
          .select()
          .from(maintenanceTasks)
          .orderBy(asc(maintenanceTasks.doneAt))
          .all())
          lastDone.set(`${t.printerId}:${t.typeId}`, t);

        const items: MaintenanceDueItem[] = [];
        for (const p of active) {
          const now = usageOf(p);
          for (const type of types) {
            if (!appliesToPrinter(type.appliesToModel, p.model)) continue;
            const last = lastDone.get(`${p.id}:${type.id}`);
            // Never done: counts from purchase (or from when the printer was added).
            const since: UsageSnapshot = last
              ? {
                  at: last.doneAt,
                  runtimeSec: last.printerRuntimeSecAt,
                  prints: last.printerPrintsAt,
                }
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
        return items
          .filter((i) => req.query.attention === "false" || i.status !== "ok")
          .sort((a, b) => b.progress - a.progress);
      },
    );
  };
