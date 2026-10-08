import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  apiErrorSchema,
  archivedFilter,
  commentInputSchema,
  commentPatchSchema,
  dateRangeQuery,
  idList,
  listQuery,
  type Page,
  type Printer,
  type PrinterComment,
  pageOf,
  printerCommentSchema,
  printerInputSchema,
  printerPatchSchema,
  printerSchema,
  printerSortFields,
  printStatsSchema,
  summarizePrints,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { dateRange, inIds, listPage, taggedWith } from "../lib/list.ts";
import { readPreferences } from "../lib/preferences.ts";

const { printers, printerComments, prints } = schema;
const params = z.object({ id: z.uuid() });
const commentParams = params.extend({ commentId: z.uuid() });
const notFound = { 404: apiErrorSchema };
const PHOTO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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
    const getComment = (printerId: string, commentId: string) => {
      const row = db
        .select()
        .from(printerComments)
        .where(and(eq(printerComments.id, commentId), eq(printerComments.printerId, printerId)))
        .get();
      if (!row) throw new HttpError(404, "not_found", "Comment not found");
      return row;
    };
    const photoFile = (path: string) => join(dataDir, path);

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(printerSortFields, {
            state: idList.optional(),
            tagId: idList.optional(),
            archived: archivedFilter,
          }),
          response: { 200: pageOf(printerSchema) },
        },
      },
      async (req) =>
        listPage(db, printers, req.query, {
          sort: { name: printers.name, createdAt: printers.createdAt },
          dateColumn: printers.createdAt,
          where: [
            inIds(printers.state, req.query.state),
            taggedWith(db, "printer", printers.id, req.query.tagId),
            req.query.archived === "true"
              ? isNotNull(printers.archivedAt)
              : isNull(printers.archivedAt),
          ],
        }) as Page<Printer>,
    );

    app.post(
      "/",
      { schema: { body: printerInputSchema, response: { 201: printerSchema } } },
      async (req, reply) => {
        checkState(req.body.state);
        const row = db.insert(printers).values(req.body).returning().get();
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
        schema: { params, body: printerPatchSchema, response: { 200: printerSchema, ...notFound } },
      },
      async (req) => {
        get(req.params.id);
        const { archived, ...fields } = req.body;
        checkState(fields.state);
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

    // --- Comments: pinned first, then newest first.
    app.get(
      "/:id/comments",
      { schema: { params, response: { 200: z.array(printerCommentSchema), ...notFound } } },
      async (req) => {
        get(req.params.id);
        return db
          .select()
          .from(printerComments)
          .where(eq(printerComments.printerId, req.params.id))
          .orderBy(desc(printerComments.pinned), desc(printerComments.createdAt))
          .all() as PrinterComment[];
      },
    );

    app.post(
      "/:id/comments",
      {
        schema: {
          params,
          body: commentInputSchema,
          response: { 201: printerCommentSchema, ...notFound },
        },
      },
      async (req, reply) => {
        get(req.params.id);
        const row = db
          .insert(printerComments)
          .values({ ...req.body, printerId: req.params.id })
          .returning()
          .get();
        return reply.status(201).send(row as PrinterComment);
      },
    );

    app.patch(
      "/:id/comments/:commentId",
      {
        schema: {
          params: commentParams,
          body: commentPatchSchema,
          response: { 200: printerCommentSchema, ...notFound },
        },
      },
      async (req) => {
        getComment(req.params.id, req.params.commentId);
        return db
          .update(printerComments)
          .set(req.body)
          .where(eq(printerComments.id, req.params.commentId))
          .returning()
          .get() as PrinterComment;
      },
    );

    app.delete(
      "/:id/comments/:commentId",
      { schema: { params: commentParams, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        getComment(req.params.id, req.params.commentId);
        db.delete(printerComments).where(eq(printerComments.id, req.params.commentId)).run();
        return reply.status(204).send(null);
      },
    );

    // --- Photo: raw image body (no multipart dependency), stored under <dataDir>/photos.
    app.addContentTypeParser(
      Object.keys(PHOTO_TYPES),
      { parseAs: "buffer", bodyLimit: PHOTO_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    app.put(
      "/:id/photo",
      { schema: { params, response: { 200: printerSchema, ...notFound } } },
      async (req) => {
        const printer = get(req.params.id);
        const ext = PHOTO_TYPES[req.headers["content-type"] as keyof typeof PHOTO_TYPES];
        if (!ext || !Buffer.isBuffer(req.body) || !req.body.length)
          throw new HttpError(415, "unsupported_media_type", "Send a PNG, JPEG or WebP image");
        const photoPath = `photos/${printer.id}.${ext}`;
        mkdirSync(join(dataDir, "photos"), { recursive: true });
        if (printer.photoPath && printer.photoPath !== photoPath)
          rmSync(photoFile(printer.photoPath), { force: true });
        writeFileSync(photoFile(photoPath), req.body);
        return db
          .update(printers)
          .set({ photoPath })
          .where(eq(printers.id, printer.id))
          .returning()
          .get() as Printer;
      },
    );

    app.get("/:id/photo", { schema: { params } }, async (req, reply) => {
      const { photoPath } = get(req.params.id);
      if (!photoPath) throw new HttpError(404, "not_found", "Printer has no photo");
      const type = Object.entries(PHOTO_TYPES).find(([, ext]) =>
        photoPath.endsWith(`.${ext}`),
      )?.[0];
      return reply
        .type(type ?? "application/octet-stream")
        .send(readFileSync(photoFile(photoPath)));
    });

    app.delete(
      "/:id/photo",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        const { id, photoPath } = get(req.params.id);
        if (photoPath) rmSync(photoFile(photoPath), { force: true });
        db.update(printers).set({ photoPath: null }).where(eq(printers.id, id)).run();
        return reply.status(204).send(null);
      },
    );
  };
