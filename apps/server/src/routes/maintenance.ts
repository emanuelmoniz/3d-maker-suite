import {
  apiErrorSchema,
  archivedFilter,
  hasLevel,
  idList,
  listQuery,
  type MaintenanceTask,
  type MaintenanceType,
  maintenanceDueItemSchema,
  maintenanceLogSchema,
  maintenanceTaskPatchSchema,
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
import { eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { alertTasks, archivedAtOf, archivedWhere, resolveItemAlerts } from "../lib/archive.ts";
import { modelName } from "../lib/catalog.ts";
import { deleteItem } from "../lib/dependents.ts";
import { inIds, listPage } from "../lib/list.ts";
import { accessoryUsageOf, dueItems, usageOf } from "../lib/maintenance.ts";
import type { SessionUser } from "../lib/session.ts";

const { accessories, maintenanceTypes, maintenanceTasks, printers, users } = schema;
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
          where: [archivedWhere(maintenanceTypes.archivedAt, req.query.archived)],
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
        return db.transaction((tx) => {
          const row = tx
            .update(maintenanceTypes)
            .set({ ...fields, archivedAt: archivedAtOf(archived) })
            .where(eq(maintenanceTypes.id, req.params.id))
            .returning()
            .get();
          if (archived) resolveItemAlerts(tx, alertTasks.maintenanceType(row.id));
          return row as MaintenanceType;
        });
      },
    );

    app.delete(
      "/types/:id",
      { schema: { params, response: { 204: z.null(), 409: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        getType(req.params.id);
        deleteItem(db, "maintenanceTypes", req.params.id, { user: req.user });
        return reply.status(204).send(null);
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
      async (req) => {
        const page = listPage(db, maintenanceTasks, req.query, {
          sort: { doneAt: maintenanceTasks.doneAt, createdAt: maintenanceTasks.createdAt },
          dateColumn: maintenanceTasks.doneAt,
          where: [
            inIds(maintenanceTasks.printerId, req.query.printerId),
            inIds(maintenanceTasks.accessoryId, req.query.accessoryId),
            inIds(maintenanceTasks.typeId, req.query.typeId),
          ],
        }) as Page<MaintenanceTask>;
        const ids = [...new Set(page.items.flatMap((t) => (t.doneBy ? [t.doneBy] : [])))];
        const names = new Map(
          ids.length
            ? db
                .select({ id: users.id, name: users.displayName })
                .from(users)
                .where(inArray(users.id, ids))
                .all()
                .map((u) => [u.id, u.name])
            : [],
        );
        const typeIds = [...new Set(page.items.map((t) => t.typeId))];
        const typeNames = new Map(
          typeIds.length
            ? db
                .select({ id: maintenanceTypes.id, name: maintenanceTypes.name })
                .from(maintenanceTypes)
                .where(inArray(maintenanceTypes.id, typeIds))
                .all()
                .map((x) => [x.id, x.name])
            : [],
        );
        return {
          ...page,
          items: page.items.map((t) => ({
            ...t,
            doneByName: t.doneBy ? (names.get(t.doneBy) ?? null) : null,
            typeName: typeNames.get(t.typeId),
          })),
        };
      },
    );

    const getTask = (taskId: string) => {
      const row = db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, taskId)).get();
      if (!row) throw new HttpError(404, "not_found", "Maintenance record not found");
      return row;
    };
    /** Write fixes or deletes the user's own records, Manage any (no users yet: anyone). */
    const assertMayChange = (user: SessionUser | undefined, task: { doneBy: string | null }) => {
      if (!user || user.rights.admin || hasLevel(user.rights.permissions, "maintenance", "manage"))
        return;
      if (task.doneBy !== user.id)
        throw new HttpError(403, "forbidden", "You can only change the records you logged");
    };

    app.patch(
      "/tasks/:id",
      {
        schema: {
          params,
          body: maintenanceTaskPatchSchema,
          response: { 200: maintenanceTaskSchema, 403: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        const task = getTask(req.params.id);
        assertMayChange(req.user, task);
        const patch: Partial<typeof maintenanceTasks.$inferInsert> = { ...req.body };
        if (req.body.doneAt && req.body.doneAt !== task.doneAt) {
          if (new Date(req.body.doneAt).getTime() > Date.now() + 60_000)
            throw new HttpError(400, "future_date", "A record can't be dated in the future");
          const at = task.printerId
            ? usageOf(db, getPrinter(task.printerId), req.body.doneAt)
            : accessoryUsageOf(db, task.accessoryId as string, req.body.doneAt);
          patch.printerRuntimeSecAt = at.runtimeSec;
          patch.printerPrintsAt = at.prints;
        }
        const row = db
          .update(maintenanceTasks)
          .set(patch)
          .where(eq(maintenanceTasks.id, task.id))
          .returning()
          .get();
        return row as MaintenanceTask;
      },
    );

    app.delete(
      "/tasks/:id",
      { schema: { params, response: { 204: z.null(), 403: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        assertMayChange(req.user, getTask(req.params.id));
        db.delete(maintenanceTasks).where(eq(maintenanceTasks.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
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
            doneBy: req.user?.id ?? null,
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
