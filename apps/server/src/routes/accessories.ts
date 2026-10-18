import {
  type Accessory,
  type AccessoryInstall,
  accessoryCommentSchema,
  accessoryFilters,
  accessoryInputSchema,
  accessoryInstallSchema,
  accessoryPatchSchema,
  accessorySchema,
  accessorySortFields,
  apiErrorSchema,
  archivedFilter,
  installInputSchema,
  installPatchSchema,
  listQuery,
  type Page,
  pageOf,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { printerLabel } from "../lib/catalog.ts";
import { commentRoutes } from "../lib/comments.ts";
import { imageRoutes } from "../lib/images.ts";
import { listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";

const { accessories, accessoryComments, accessoryInstalls: installs, printers } = schema;
const params = z.object({ id: z.uuid() });
const installParams = params.extend({ installId: z.uuid() });
const notFound = { 404: apiErrorSchema };

/** "01-AMS", the same as the web's `accessoryName`. */
const accessoryLabel = sql<string>`printf('%02d', ${accessories.number}) || '-' || ${accessories.name}`;
/** The printer the accessory is on now (its open install). */
// Drizzle leaves single-table columns unqualified, and a bare "id" here would be the install's.
const outerId = sql`${accessories}.${sql.identifier("id")}`;
const openInstall = (column: AnyColumn) =>
  sql<
    string | null
  >`(SELECT ${column} FROM ${installs} WHERE ${installs.accessoryId} = ${outerId} AND ${installs.removedAt} IS NULL)`;
const currentPrinter = openInstall(installs.printerId);
const withPrinter = {
  ...getTableColumns(accessories),
  printerId: currentPrinter,
  installId: openInstall(installs.id),
  installedAt: openInstall(installs.installedAt),
};
const installColumns = {
  ...getTableColumns(installs),
  printerLabel: sql<string>`(SELECT ${printerLabel} FROM ${printers} WHERE ${printers.id} = ${installs.printerId})`,
};

export const accessoriesRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select(withPrinter).from(accessories).where(eq(accessories.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Accessory not found");
      return row as Accessory;
    };
    const checkState = (state?: string) => {
      if (state !== undefined && !readPreferences(db).printerStates.includes(state))
        throw new HttpError(400, "invalid_state", `Unknown state "${state}"`);
    };
    const archive = (id: string, archived: boolean) => {
      if (archived && get(id).printerId)
        throw new HttpError(
          409,
          "accessory_installed",
          "Remove the accessory from its printer first",
        );
      db.update(accessories)
        .set({ archivedAt: archived ? new Date().toISOString() : null })
        .where(eq(accessories.id, id))
        .run();
    };
    const getInstall = (accessoryId: string, installId: string) => {
      const row = db
        .select()
        .from(installs)
        .where(and(eq(installs.id, installId), eq(installs.accessoryId, accessoryId)))
        .get();
      if (!row) throw new HttpError(404, "not_found", "Install record not found");
      return row;
    };
    /** Refuses a period `[start, end)` (end null = still on) that overlaps another of the accessory. */
    const assertNoOverlap = (
      accessoryId: string,
      start: string,
      end: string | null,
      exceptId?: string,
    ) => {
      if (end !== null && end < start)
        throw new HttpError(400, "invalid_dates", "Removal is before the install");
      const other = db
        .select({ id: installs.id })
        .from(installs)
        .where(
          and(
            eq(installs.accessoryId, accessoryId),
            exceptId ? ne(installs.id, exceptId) : undefined,
            end === null ? undefined : lt(installs.installedAt, end),
            or(isNull(installs.removedAt), gt(installs.removedAt, start)),
          ),
        )
        .get();
      if (other)
        throw new HttpError(409, "install_overlap", "It is on a printer during that period");
    };
    const getFull = (installId: string) =>
      db
        .select(installColumns)
        .from(installs)
        .where(eq(installs.id, installId))
        .get() as AccessoryInstall;

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(
            accessorySortFields,
            { archived: archivedFilter },
            accessoryFilters,
          ),
          response: { 200: pageOf(accessorySchema) },
        },
      },
      async (req) =>
        listPage(db, accessories, req.query, {
          select: withPrinter,
          sort: {
            // The name starts with the number: sorting by it sorts the name as shown (2 before 10).
            name: accessories.number,
            type: accessories.type,
            state: accessories.state,
            printer: sql`(SELECT ${printerLabel} FROM ${printers} WHERE ${printers.id} = ${currentPrinter})`,
            powerW: accessories.powerW,
            createdAt: accessories.createdAt,
          },
          dateColumn: accessories.createdAt,
          filters: {
            name: accessoryLabel,
            type: accessories.type,
            state: accessories.state,
            printerId: currentPrinter,
            powerW: accessories.powerW,
          },
          where: [
            taggedWith(db, "accessory", accessories.id, req.query.tagId),
            req.query.archived === "true"
              ? isNotNull(accessories.archivedAt)
              : isNull(accessories.archivedAt),
          ],
        }) as Page<Accessory>,
    );

    // Types already in use, for the form's suggestions.
    app.get("/types", { schema: { response: { 200: z.array(z.string()) } } }, async () =>
      db
        .selectDistinct({ type: accessories.type })
        .from(accessories)
        .orderBy(asc(accessories.type))
        .all()
        .map((r) => r.type),
    );

    app.post(
      "/",
      {
        schema: {
          body: accessoryInputSchema,
          response: { 201: accessorySchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        checkState(req.body.state);
        assertNumberFree(db, accessories, "accessory", req.body.number);
        const { id } = db
          .insert(accessories)
          .values({ ...req.body, number: req.body.number ?? nextNumber(accessories) })
          .returning()
          .get();
        return reply.status(201).send(get(id));
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: accessorySchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    // `archived` archives/restores; DELETE below is the same as `{ archived: true }`.
    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: accessoryPatchSchema,
          response: { 200: accessorySchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        const { archived, ...fields } = req.body;
        checkState(fields.state);
        assertNumberFree(db, accessories, "accessory", fields.number, req.params.id);
        if (archived !== undefined) archive(req.params.id, archived);
        if (Object.keys(fields).length)
          db.update(accessories).set(fields).where(eq(accessories.id, req.params.id)).run();
        return get(req.params.id);
      },
    );

    // Accessories have history (installs), so deleting means archiving.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), 409: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        archive(req.params.id, true);
        return reply.status(204).send(null);
      },
    );

    // --- Install history, newest first. Checks and writes are synchronous, so nothing interleaves.
    app.get(
      "/:id/installs",
      { schema: { params, response: { 200: z.array(accessoryInstallSchema), ...notFound } } },
      async (req) => {
        get(req.params.id);
        return db
          .select(installColumns)
          .from(installs)
          .where(eq(installs.accessoryId, req.params.id))
          .orderBy(desc(installs.installedAt))
          .all() as AccessoryInstall[];
      },
    );

    app.post(
      "/:id/installs",
      {
        schema: {
          params,
          body: installInputSchema,
          response: {
            201: accessoryInstallSchema,
            400: apiErrorSchema,
            409: apiErrorSchema,
            ...notFound,
          },
        },
      },
      async (req, reply) => {
        get(req.params.id);
        const { printerId, installedAt, removedAt = null } = req.body;
        if (!db.select().from(printers).where(eq(printers.id, printerId)).get())
          throw new HttpError(400, "invalid_printer", "Unknown printer");
        assertNoOverlap(req.params.id, installedAt, removedAt);
        const { id } = db
          .insert(installs)
          .values({ accessoryId: req.params.id, printerId, installedAt, removedAt })
          .returning()
          .get();
        return reply.status(201).send(getFull(id));
      },
    );

    // Sets (or corrects) the removal date.
    app.patch(
      "/:id/installs/:installId",
      {
        schema: {
          params: installParams,
          body: installPatchSchema,
          response: {
            200: accessoryInstallSchema,
            400: apiErrorSchema,
            409: apiErrorSchema,
            ...notFound,
          },
        },
      },
      async (req) => {
        const row = getInstall(req.params.id, req.params.installId);
        assertNoOverlap(req.params.id, row.installedAt, req.body.removedAt, row.id);
        db.update(installs)
          .set({ removedAt: req.body.removedAt })
          .where(eq(installs.id, row.id))
          .run();
        return getFull(row.id);
      },
    );

    app.delete(
      "/:id/installs/:installId",
      { schema: { params: installParams, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        getInstall(req.params.id, req.params.installId);
        db.delete(installs).where(eq(installs.id, req.params.installId)).run();
        return reply.status(204).send(null);
      },
    );

    imageRoutes(app, dataDir, {
      name: "photo",
      dir: "photos",
      response: accessorySchema,
      get: (id) => get(id).photoPath,
      set: (id, photoPath) => {
        db.update(accessories).set({ photoPath }).where(eq(accessories.id, id)).run();
        return get(id);
      },
    });

    commentRoutes(app, db, {
      table: accessoryComments,
      parentKey: "accessoryId",
      response: accessoryCommentSchema,
      getParent: get,
    });
  };
