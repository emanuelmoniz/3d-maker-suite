import {
  apiErrorSchema,
  headerKeys,
  IMPORT_COLUMNS,
  IMPORT_ENTITIES,
  importApplySchema,
  importPreviewQuerySchema,
  importPreviewSchema,
  importResultSchema,
  importRunSchema,
  importTemplateSchema,
  REVIEW_ENTITIES,
  REVIEWED_TYPES,
  type ReviewedType,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { desc } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createBackup } from "../backup/backup.ts";
import { HttpError } from "../errors.ts";
import { createReview, type Stored } from "../import/review.ts";
import type { Syncer } from "../integrations/sync.ts";
import { buildTemplate, type GridRow, readCsv, readXlsx, XLSX_TYPE } from "../lib/sheet.ts";

const MAX_UPLOAD = 10 * 1024 ** 2;
// The review table pages its rows; the upload limit below is what stops a file first.
const MAX_ROWS = 20000;
const params = z.object({ entity: z.enum(IMPORT_ENTITIES) });
const filled = (v: unknown) => v != null && String(v).trim() !== "";

export const importRoutes =
  (db: Db, dataDir: string, syncer: Syncer): FastifyPluginAsyncZod =>
  async (app) => {
    const review = createReview(db, dataDir);

    app.addContentTypeParser(
      [XLSX_TYPE, "text/csv"],
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD },
      (_req, body, done) => done(null, body),
    );

    // The web sends the translated headers and instructions: the server has no translations.
    app.post(
      "/:entity/template",
      { schema: { params, body: importTemplateSchema } },
      async (req, reply) => {
        const { entity } = req.params;
        const refs = review.handlers[entity].refs?.(db) ?? {};
        return reply
          .header("content-disposition", `attachment; filename="${entity}-template.xlsx"`)
          .type(XLSX_TYPE)
          .send(await buildTemplate(IMPORT_COLUMNS[entity], req.body, refs));
      },
    );

    // The template filled with what you have, plus an id column so an edited file matches by id.
    app.post(
      "/:entity/export",
      { schema: { params, body: importTemplateSchema } },
      async (req, reply) => {
        const { entity } = req.params;
        const handler = review.handlers[entity];
        const rows = handler.targets(db).map((t) => ({ id: t.id, values: t.values }));
        return reply
          .header("content-disposition", `attachment; filename="${entity}-export.xlsx"`)
          .type(XLSX_TYPE)
          .send(
            await buildTemplate(IMPORT_COLUMNS[entity], req.body, handler.refs?.(db) ?? {}, rows),
          );
      },
    );

    app.get("/runs", { schema: { response: { 200: z.array(importRunSchema) } } }, async () =>
      db
        .select()
        .from(schema.importRuns)
        .orderBy(desc(schema.importRuns.createdAt))
        .limit(50)
        .all(),
    );

    // Raw file body (.xlsx or .csv by content type). Nothing is written to the database.
    app.post(
      "/:entity/preview",
      {
        schema: {
          params,
          querystring: importPreviewQuerySchema,
          response: { 200: importPreviewSchema, 400: apiErrorSchema },
        },
      },
      async (req) => {
        const { entity } = req.params;
        if (!Buffer.isBuffer(req.body) || !req.body.length)
          throw new HttpError(415, "unsupported_media_type", "Send an .xlsx or .csv file");
        let grid: GridRow[];
        try {
          grid = req.headers["content-type"]?.startsWith("text/csv")
            ? readCsv(req.body)
            : await readXlsx(req.body);
        } catch {
          throw new HttpError(400, "invalid_file", "Couldn't read the file");
        }
        const [head, ...lines] = grid;
        const headers = head?.cells ?? [];
        const keys = headerKeys(IMPORT_COLUMNS[entity], headers, req.query.labels);
        const idAt = headers.findIndex((h) => String(h).trim().toLowerCase() === "id");
        if (idAt >= 0) keys[idAt] = "id";
        if (!keys.some(Boolean))
          throw new HttpError(400, "no_columns", "The first row has no known column");
        const rows = lines
          .map((r) => ({
            n: r.n,
            raw: Object.fromEntries(keys.flatMap((k, i) => (k ? [[k, r.cells[i] ?? null]] : []))),
          }))
          .filter((r) => Object.values(r.raw).some(filled));
        if (rows.length > MAX_ROWS)
          throw new HttpError(400, "too_many_rows", `At most ${MAX_ROWS} rows per file`);

        const stored: Stored = {
          entity,
          fileName: req.query.fileName,
          ignoredHeaders: headers.filter((h, i) => !keys[i] && filled(h)).map(String),
          rows,
        };
        return { uploadId: review.save(stored), ...review.preview(stored) };
      },
    );

    // What one type of an integration offers right now, read live. Nothing is written.
    app.post(
      "/integration/:id/:type",
      {
        schema: {
          params: z.object({ id: z.uuid(), type: z.enum(REVIEWED_TYPES) }),
          querystring: z.object({ includeSystem: z.enum(["true", "false"]).default("false") }),
          response: { 200: importPreviewSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const { id, type } = req.params;
        const stored = await syncer.offer(id, type, req.query.includeSystem === "true");
        return { uploadId: review.save(stored), ...review.preview(stored) };
      },
    );

    // Decisions only: the rows come from the stored preview and are validated and matched again.
    // Anything wrong rejects the whole request; the writes are one transaction after a backup.
    app.post(
      "/:entity/apply",
      {
        schema: {
          params: z.object({ entity: z.enum(REVIEW_ENTITIES) }),
          body: importApplySchema,
          response: { 200: importResultSchema, 400: apiErrorSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const { uploadId, decisions, policy } = req.body;
        const stored = review.load(uploadId);
        if (!stored || stored.entity !== req.params.entity)
          throw new HttpError(404, "upload_not_found", "Upload not found; preview the file again");
        review.plan(stored, decisions, policy);
        const backup = (await createBackup(db, dataDir, true)).name;
        // A confirmed review of an integration is a manual run of that type, in its sync log too.
        const done =
          stored.from?.kind === "integration"
            ? await syncer.run(
                stored.from.integrationId,
                "manual",
                { type: stored.entity as ReviewedType },
                { stored, decisions, policy, backup },
              )
            : review.write(stored, decisions, policy, backup);
        review.drop(uploadId);
        return { created: done.created, updated: done.updated, backup };
      },
    );
  };
