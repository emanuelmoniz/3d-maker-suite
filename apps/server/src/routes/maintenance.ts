import {
  apiErrorSchema,
  archivedFilter,
  idList,
  listQuery,
  type MaintenanceTask,
  type MaintenanceType,
  maintenanceDueItemSchema,
  maintenanceLogSchema,
  maintenanceTaskSchema,
  maintenanceTaskSortFields,
  maintenanceTypeFilters,
  maintenanceTypeInputSchema,
  maintenanceTypePatchSchema,
  maintenanceTypeSchema,
  maintenanceTypeSortFields,
  type Page,
  pageOf,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { modelName } from "../lib/catalog.ts";
import { inIds, listPage } from "../lib/list.ts";
import { accessoryUsageOf, dueItems, usageOf } from "../lib/maintenance.ts";

const { accessories, maintenanceTypes, maintenanceTasks, printers } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
// "Brand Model, Brand Model" of the models a type applies to (accessory types for accessory
// types), for sort/filter.
const modelNames = sql`CASE WHEN ${maintenanceTypes.target} = 'accessory'
  THEN (SELECT group_concat(j.value, ', ') FROM json_each(${maintenanceTypes.appliesToAccessoryTypes}) j)
  ELSE (SELECT group_concat(${modelName(sql`j.value`)}, ', ') FROM json_each(${maintenanceTypes.appliesToModelIds}) j) END`;

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
    const getAccessory = (id: string) => {
      const row = db.select().from(accessories).where(eq(accessories.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Accessory not found");
      return row;
    };

    // --- Types
    app.get(
      "/types",
      {
        schema: {
          querystring: listQuery(
            maintenanceTypeSortFields,
            { archived: archivedFilter },
            maintenanceTypeFilters,
          ),
          response: { 200: pageOf(maintenanceTypeSchema) },
        },
      },
      async (req) =>
        listPage(db, maintenanceTypes, req.query, {
          sort: {
            name: maintenanceTypes.name,
            createdAt: maintenanceTypes.createdAt,
            appliesToModels: modelNames,
          },
          dateColumn: maintenanceTypes.createdAt,
          filters: {
            name: maintenanceTypes.name,
            appliesToModels: modelNames,
          },
          where: [
            req.query.archived === "true"
              ? isNotNull(maintenanceTypes.archivedAt)
              : isNull(maintenanceTypes.archivedAt),
          ],
        }) as Page<MaintenanceType>,
    );

    app.get(
      "/types/:id",
      { schema: { params, response: { 200: maintenanceTypeSchema, ...notFound } } },
      async (req) => getType(req.params.id) as MaintenanceType,
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
            accessoryId: idList.optional(),
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
            inIds(maintenanceTasks.accessoryId, req.query.accessoryId),
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
        const { printerId, accessoryId } = req.body;
        const printer = printerId ? getPrinter(printerId) : null;
        if (!printer) getAccessory(accessoryId as string);
        const type = getType(req.body.typeId);
        if (type.archivedAt)
          throw new HttpError(400, "type_archived", "Maintenance type is archived");
        if (type.target !== (printer ? "printer" : "accessory"))
          throw new HttpError(400, "wrong_target", `This maintenance type is for ${type.target}s`);
        const doneAt = req.body.doneAt ?? new Date().toISOString();
        const at = printer
          ? usageOf(db, printer, doneAt)
          : accessoryUsageOf(db, accessoryId as string, doneAt);
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

    // --- Due: every active printer and accessory x applicable type, most urgent first.
    app.get(
      "/due",
      {
        schema: {
          querystring: z.object({
            printerId: z.uuid().optional(),
            accessoryId: z.uuid().optional(),
            /** `true` keeps only upcoming and overdue items. */
            attention: z.enum(["true", "false"]).default("false"),
          }),
          response: { 200: z.array(maintenanceDueItemSchema) },
        },
      },
      async (req) => {
        const { printerId, accessoryId } = req.query;
        const items = dueItems(db, { printerId, accessoryId });
        return items
          .filter((i) => req.query.attention === "false" || i.status !== "ok")
          .sort((a, b) => b.progress - a.progress);
      },
    );
  };
