import { existsSync } from "node:fs";
import { rmdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  apiErrorSchema,
  headerKeys,
  IMPORT_COLUMNS,
  IMPORT_ENTITIES,
  type ImportApplyDecision,
  importApplySchema,
  importPreviewQuerySchema,
  importPreviewSchema,
  importProjectPrintsResponseSchema,
  importProjectPrintsSchema,
  importResultSchema,
  importRunSchema,
  importTemplateSchema,
  isoDate,
  REVIEW_ENTITIES,
  REVIEWED_TYPES,
  type ReviewedType,
  rootOf,
  SHEET_FORMATS,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { desc } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createBackup } from "../backup/backup.ts";
import { HttpError } from "../errors.ts";
import { createReview, edited, type Stored } from "../import/review.ts";
import type { Syncer } from "../integrations/sync.ts";
import { insideRoots } from "../lib/launcher.ts";
import { numberCell, printTitle } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import {
  buildCsv,
  buildJson,
  buildTemplate,
  type GridRow,
  readCsv,
  readXlsx,
  XLSX_TYPE,
} from "../lib/sheet.ts";
import { parseFolderName } from "../projects/folderName.ts";
import { linkPrints, type MatchProject, suggestPrints } from "../projects/linkPrints.ts";
import { folderName, newProjectFolder } from "../projects/newFolder.ts";
import { safeName } from "../projects/paths.ts";
import { scanFolder } from "../projects/scanFolder.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const MAX_UPLOAD = 10 * 1024 ** 2;
// The review table pages its rows; the upload limit below is what stops a file first.
const MAX_ROWS = 20000;
const params = z.object({ entity: z.enum(IMPORT_ENTITIES) });
const filled = (v: unknown) => v != null && String(v).trim() !== "";

/** A JSON file (a list of objects) as a sheet: the keys in first-seen order are the header row. */
function jsonGrid(body: unknown): GridRow[] | null {
  if (!Array.isArray(body)) return null;
  const items = body.filter((o) => o && typeof o === "object" && !Array.isArray(o));
  const keys = [...new Set(items.flatMap((o) => Object.keys(o)))];
  const cell = (v: unknown) => (v != null && typeof v === "object" ? JSON.stringify(v) : v);
  return [
    { n: 1, cells: keys },
    ...items.map((o, i) => ({ n: i + 2, cells: keys.map((k) => cell(o[k]) ?? null) })),
  ] as GridRow[];
}

export const importRoutes =
  (db: Db, dataDir: string, syncer: Syncer, scanner: ProjectScanner): FastifyPluginAsyncZod =>
  async (app) => {
    const review = createReview(db, dataDir);

    app.addContentTypeParser(
      [XLSX_TYPE, "text/csv"],
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD },
      (_req, body, done) => done(null, body),
    );

    // The web sends the translated headers and instructions: the server has no translations. The
    // export is the template filled with what you have, plus an id column so an edited file
    // matches by id.
    for (const kind of ["template", "export"] as const)
      app.post(
        `/:entity/${kind}`,
        {
          schema: {
            params,
            querystring: z.object({ format: z.enum(SHEET_FORMATS).default("xlsx") }),
            body: importTemplateSchema,
          },
        },
        async (req, reply) => {
          const { entity } = req.params;
          const { format } = req.query;
          const handler = review.handlers[entity];
          const columns = IMPORT_COLUMNS[entity];
          const rows =
            kind === "export"
              ? handler.targets(db).map((t) => ({ id: t.id, values: t.values }))
              : undefined;
          reply.header("content-disposition", `attachment; filename="${entity}-${kind}.${format}"`);
          if (format === "json")
            return reply.type("application/json").send(buildJson(columns, rows));
          if (format === "csv")
            return reply
              .type("text/csv; charset=utf-8")
              .send(buildCsv(columns, req.body.labels, rows));
          return reply
            .type(XLSX_TYPE)
            .send(await buildTemplate(columns, req.body, handler.refs?.(db) ?? {}, rows));
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
        const json = jsonGrid(req.body);
        if (!json && (!Buffer.isBuffer(req.body) || !req.body.length))
          throw new HttpError(415, "unsupported_media_type", "Send an .xlsx, .csv or .json file");
        let grid: GridRow[];
        try {
          grid =
            json ??
            (req.headers["content-type"]?.startsWith("text/csv")
              ? readCsv(req.body as Buffer)
              : await readXlsx(req.body as Buffer));
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
          columns: [...new Set(keys.filter((k) => k !== null))],
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
          querystring: z.object({
            // Prints only: the dates to read; none = since the last sync.
            from: isoDate.optional(),
            to: isoDate.optional(),
          }),
          response: { 200: importPreviewSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const { id, type } = req.params;
        const { from, to } = req.query;
        const stored = await syncer.offer(id, type, { from, to });
        return { uploadId: review.save(stored), ...review.preview(stored) };
      },
    );

    // Decisions only: the rows come from the stored preview and are validated and matched again.
    // Anything wrong rejects the whole request; the writes are one transaction after a backup.
    /**
     * Makes the project folders the review asked for and returns the decisions with their paths.
     * A folder named by the convention takes the number the row's insert will take: its own when
     * free, else its folder's prefix when free, else the next one (as `projectImport.create`).
     */
    async function makeFolders(stored: Stored, decisions: ImportApplyDecision[], made: string[]) {
      if (!decisions.some((d) => d.folder && "create" in d.folder)) return decisions;
      const current = review.preview(edited(stored, decisions));
      const rows = new Map(current.rows.map((r) => [r.row, r.values]));
      const targets = new Map(current.targets.map((t) => [t.id, t.values]));
      const taken = new Set(
        db
          .select({ n: schema.projects.number })
          .from(schema.projects)
          .all()
          .map((p) => p.n ?? 0),
      );
      const out: ImportApplyDecision[] = [];
      for (const d of decisions) {
        const v = rows.get(d.row) ?? {};
        let number = numberCell(targets.get(d.targetId ?? "")?.number);
        if (d.action === "create") {
          const path =
            d.folder === undefined
              ? v.folder
              : d.folder && "path" in d.folder
                ? d.folder.path
                : null;
          const prefix = path ? parseFolderName(basename(String(path))).number : null;
          number = [numberCell(v.number), prefix].find((n) => n && !taken.has(n)) ?? null;
          number ??= Math.max(0, ...taken) + 1;
          taken.add(number);
        }
        if (!d.folder || !("create" in d.folder)) {
          out.push(d);
          continue;
        }
        const name = d.folder.name?.trim();
        const base = name ? safeName(name) : folderName(number ?? 0, String(v.name ?? ""));
        const path = await newProjectFolder(db, d.folder.root, base);
        made.push(path);
        out.push({ ...d, folder: { path } });
      }
      return out;
    }

    // What a project of the review will have for prints: the ones it has, plus the ones linking
    // gives it once the rows are stored with these folders. Folders outside the roots aren't read.
    app.post(
      "/projects/prints",
      {
        schema: {
          body: importProjectPrintsSchema,
          response: { 200: importProjectPrintsResponseSchema },
        },
      },
      async (req) => {
        const { projectRoots, projectScanMaxFiles } = readPreferences(db);
        const paths = projectRoots.map((r) => r.path);
        const resolved = projectRoots.map((r) => ({ ...r, path: resolve(r.path) }));
        const stored = new Map(
          db
            .select({
              id: schema.projects.id,
              folder: schema.projects.folderPath,
              meta: schema.projects.meta,
            })
            .from(schema.projects)
            .all()
            .map((p) => [p.id, p]),
        );
        const rows: (MatchProject & { row: number })[] = [];
        for (const r of req.body.rows) {
          const cur = r.targetId ? stored.get(r.targetId) : undefined;
          const folder = r.folder ? resolve(r.folder) : null;
          const read =
            folder && folder !== cur?.folder && (await insideRoots(folder, paths))
              ? await scanFolder(
                  folder,
                  null,
                  projectScanMaxFiles,
                  rootOf(folder, resolved)?.filesDepth ?? null,
                )
              : null;
          rows.push({
            row: r.row,
            id: r.targetId ?? `row:${r.row}`,
            meta: read
              ? { files: read.files, models: read.models }
              : ((cur && folder === cur.folder ? cur.meta : {}) as MatchProject["meta"]),
          });
        }
        const suggested = suggestPrints(db, rows);
        return {
          suggested: Object.fromEntries(rows.map((r) => [r.row, suggested.get(r.id) ?? []])),
          // ponytail: every print, for the add box; page it if a library outgrows a few MB.
          prints: db
            .select({
              id: schema.prints.id,
              number: schema.prints.number,
              title: schema.prints.title,
            })
            .from(schema.prints)
            .orderBy(desc(schema.prints.number))
            .all()
            .map((p) => ({ id: p.id, label: printTitle(p) })),
        };
      },
    );

    app.post(
      "/:entity/apply",
      {
        schema: {
          params: z.object({ entity: z.enum(REVIEW_ENTITIES) }),
          body: importApplySchema,
          response: {
            200: importResultSchema,
            400: apiErrorSchema,
            404: apiErrorSchema,
            409: apiErrorSchema,
          },
        },
      },
      async (req) => {
        const { uploadId, policy } = req.body;
        let { decisions } = req.body;
        const stored = review.load(uploadId);
        if (!stored || stored.entity !== req.params.entity)
          throw new HttpError(404, "upload_not_found", "Upload not found; preview the file again");
        if (!decisions.length && stored.from?.kind !== "integration")
          throw new HttpError(400, "nothing_to_import", "No rows to import");
        review.plan(stored, decisions, policy);
        // Projects: the folders to make are made now, and removed again if the write fails.
        const made: string[] = [];
        if (stored.entity === "projects") {
          try {
            decisions = await makeFolders(stored, decisions, made);
            review.plan(stored, decisions, policy);
          } catch (e) {
            await Promise.all(made.map((f) => rmdir(f).catch(() => {})));
            throw e;
          }
        }
        const backup = (await createBackup(db, dataDir, "auto")).name;
        // A confirmed review of an integration is a manual run of that type, in its sync log too.
        let done: Awaited<ReturnType<typeof syncer.run>> | ReturnType<typeof review.write>;
        try {
          done =
            stored.from?.kind === "integration"
              ? await syncer.run(
                  stored.from.integrationId,
                  "manual",
                  // A review read for a range applies as that range: it never moves the cursor on.
                  { type: stored.entity as ReviewedType, ...stored.range },
                  { stored, decisions, policy, backup },
                )
              : review.write(stored, decisions, policy, backup);
        } catch (e) {
          await Promise.all(made.map((f) => rmdir(f).catch(() => {})));
          throw e;
        }
        // Projects: the scan reads each folder in (files, cover, names not given), then prints are
        // linked the way the scanner links them, except for projects whose prints were picked.
        if (stored.entity === "projects" && "written" in done) {
          const picked = new Set(decisions.filter((d) => d.prints).map((d) => d.row));
          for (const w of done.written) {
            const folder = w.values.folder;
            if (typeof folder === "string" && existsSync(folder)) await scanner.refresh(folder);
          }
          linkPrints(
            db,
            new Set(done.written.flatMap((w) => (w.id && picked.has(w.row) ? [w.id] : []))),
          );
        }
        // A failed run comes back as a result, not a throw: the person must still see it failed.
        if ("errorCode" in done && done.errorCode)
          throw new HttpError(
            502,
            "sync_failed",
            `The import failed (${done.errorCode}); see the server log`,
          );
        review.drop(uploadId);
        return { created: done.created, updated: done.updated, backup };
      },
    );
  };
