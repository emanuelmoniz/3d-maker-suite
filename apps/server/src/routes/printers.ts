import {
  apiErrorSchema,
  archivedFilter,
  dateRangeQuery,
  listQuery,
  type Page,
  type Printer,
  pageOf,
  printerCommentSchema,
  printerFilters,
  printerInputSchema,
  printerPatchSchema,
  printerSchema,
  printerSortFields,
  printStatsSchema,
  summarizePrints,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { modelName, printerLabel } from "../lib/catalog.ts";
import { commentRoutes } from "../lib/comments.ts";
import { imageRoutes } from "../lib/images.ts";
import { dateRange, listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";

const { printers, printerComments, printerModels, prints } = schema;
const params = z.object({ id: z.uuid() });
const brandModel = modelName(printers.modelId);
const notFound = { 404: apiErrorSchema };

export const printersRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(printers).where(eq(printers.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Printer not found");
      return row;
    };
    const checkState = (state?: string) => {
      if (state !== undefined && !readPreferences(db).printerStates.includes(state))
        throw new HttpError(400, "invalid_state", `Unknown printer state "${state}"`);
    };
    const checkModel = (modelId?: string) => {
      if (modelId && !db.select().from(printerModels).where(eq(printerModels.id, modelId)).get())
        throw new HttpError(400, "invalid_model", "Unknown printer model");
    };

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(printerSortFields, { archived: archivedFilter }, printerFilters),
          response: { 200: pageOf(printerSchema) },
        },
      },
      async (req) =>
        listPage(db, printers, req.query, {
          sort: {
            // The name starts with the number: sorting by it sorts the name as shown (2 before 10).
            name: printers.number,
            createdAt: printers.createdAt,
            model: brandModel,
            state: printers.state,
            powerW: printers.powerW,
          },
          dateColumn: printers.createdAt,
          filters: {
            name: printerLabel,
            model: brandModel,
            state: printers.state,
            powerW: printers.powerW,
          },
          where: [
            taggedWith(db, "printer", printers.id, req.query.tagId),
            req.query.archived === "true"
              ? isNotNull(printers.archivedAt)
              : isNull(printers.archivedAt),
          ],
        }) as Page<Printer>,
    );

    app.post(
      "/",
      {
        schema: {
          body: printerInputSchema,
          response: { 201: printerSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        checkState(req.body.state);
        checkModel(req.body.modelId);
        assertNumberFree(db, printers, "printer", req.body.number);
        const row = db
          .insert(printers)
          .values({ ...req.body, number: req.body.number ?? nextNumber(printers) })
          .returning()
          .get();
        return reply.status(201).send(row as Printer);
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: printerSchema, ...notFound } } },
      async (req) => get(req.params.id) as Printer,
    );

    // `archived` archives/restores; DELETE below is the same as `{ archived: true }`.
    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: printerPatchSchema,
          response: { 200: printerSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        const { archived, ...fields } = req.body;
        checkState(fields.state);
        checkModel(fields.modelId);
        assertNumberFree(db, printers, "printer", fields.number, req.params.id);
        const archivedAt =
          archived === undefined ? undefined : archived ? new Date().toISOString() : null;
        return db
          .update(printers)
          .set({ ...fields, archivedAt })
          .where(eq(printers.id, req.params.id))
          .returning()
          .get() as Printer;
      },
    );

    // Printers have history (prints, maintenance), so deleting means archiving.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        db.update(printers)
          .set({ archivedAt: new Date().toISOString() })
          .where(eq(printers.id, req.params.id))
          .run();
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/:id/stats",
      {
        schema: {
          params,
          querystring: dateRangeQuery,
          response: { 200: printStatsSchema, ...notFound },
        },
      },
      async (req) => {
        const printer = get(req.params.id);
        const rows = db
          .select({
            durationSec: prints.durationSec,
            outcome: prints.outcome,
            energyWh: prints.energyWh,
          })
          .from(prints)
          .where(and(eq(prints.printerId, printer.id), dateRange(prints.startedAt, req.query)))
          .all();
        return summarizePrints(rows, printer.powerW);
      },
    );

    commentRoutes(app, db, {
      table: printerComments,
      parentKey: "printerId",
      response: printerCommentSchema,
      getParent: get,
    });

    imageRoutes(app, dataDir, {
      name: "photo",
      dir: "photos",
      response: printerSchema,
      get: (id) => get(id).photoPath,
      set: (id, photoPath) =>
        db
          .update(printers)
          .set({ photoPath })
          .where(eq(printers.id, id))
          .returning()
          .get() as Printer,
    });
  };
