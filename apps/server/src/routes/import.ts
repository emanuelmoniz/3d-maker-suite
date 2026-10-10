import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  apiErrorSchema,
  headerKeys,
  IMPORT_COLUMNS,
  IMPORT_ENTITIES,
  type ImportEntity,
  type ImportErrorCode,
  type ImportPreview,
  type ImportTarget,
  type ImportValues,
  importApplySchema,
  importPreviewQuerySchema,
  importPreviewSchema,
  importResultSchema,
  importTemplateSchema,
  mergeValues,
  parseRow,
  suggest,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createBackup } from "../backup/backup.ts";
import { HttpError } from "../errors.ts";
import { printerImport } from "../import/printers.ts";
import { printImport } from "../import/prints.ts";
import { spoolImport } from "../import/spools.ts";
import { buildTemplate, type GridRow, readCsv, readXlsx, XLSX_TYPE } from "../lib/sheet.ts";

/** What an entity adds to the import framework: its existing rows, its matcher and its writes. */
type ImportHandler = {
  /** Existing rows a file row can update, in the shape of the import columns. */
  targets: (db: Db) => ImportTarget[];
  /** Per file row: the targets that fit and the one to suggest (pure, in core). */
  match: (
    rows: ImportValues[],
    targets: ImportTarget[],
  ) => { candidates: string[]; targetId: string | null }[];
  /** By `ref`: the names the template's dropdowns offer. */
  refs: (db: Db) => Record<string, string[]>;
  /** By `ref`: names in the rows that apply would create. */
  missing: (db: Db, rows: ImportValues[]) => Record<string, string[]>;
  /** Errors a valid-looking row still has, e.g. a name that must exist and doesn't. */
  check?: (db: Db, values: ImportValues) => { column: string; code: ImportErrorCode }[];
  create: (db: Db, values: ImportValues) => void;
  update: (db: Db, target: ImportTarget, patch: ImportValues) => void;
};
const HANDLERS: Record<ImportEntity, ImportHandler> = {
  spools: spoolImport,
  printers: printerImport,
  prints: printImport,
};

/** A previewed upload, kept until it is applied: the file's rows by column key, still unparsed. */
type Stored = {
  entity: ImportEntity;
  ignoredHeaders: string[];
  rows: { n: number; raw: Record<string, unknown> }[];
};

const UPLOADS = "imports";
const MAX_UPLOAD = 10 * 1024 ** 2;
// The review table pages its rows; the upload limit below is what stops a file first.
const MAX_ROWS = 20000;
const DAY = 24 * 60 * 60 * 1000;
const params = z.object({ entity: z.enum(IMPORT_ENTITIES) });
const filled = (v: unknown) => v != null && String(v).trim() !== "";

/** Validates and matches the stored rows against the database as it is now. */
function preview(db: Db, uploadId: string, stored: Stored): ImportPreview {
  const columns = IMPORT_COLUMNS[stored.entity];
  const handler = HANDLERS[stored.entity];
  const targets = handler.targets(db);
  const byId = new Map(targets.map((t) => [t.id, t]));
  const parsed = stored.rows.map((r) => {
    const p = parseRow(columns, r.raw);
    if (!p.errors.length) p.errors.push(...(handler.check?.(db, p.values) ?? []));
    return { row: r.n, ...p };
  });
  const valid = parsed.filter((p) => !p.errors.length);
  const matches = handler.match(
    valid.map((p) => p.values),
    targets,
  );
  const matchOf = new Map(valid.map((p, i) => [p.row, matches[i]]));
  return {
    uploadId,
    rows: parsed.map((p) => {
      const m = matchOf.get(p.row) ?? { candidates: [], targetId: null };
      const target = (m.targetId && byId.get(m.targetId)?.values) || null;
      return { ...p, ...m, ...suggest(columns, p, { candidates: m.candidates, target }) };
    }),
    targets,
    missing: handler.missing(
      db,
      valid.map((p) => p.values),
    ),
    ignoredHeaders: stored.ignoredHeaders,
  };
}

export const importRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const dir = join(dataDir, UPLOADS);
    // `id` is a validated uuid, so it can't leave the folder.
    const uploadFile = (id: string) => join(dir, `${id}.json`);

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
        return reply
          .header("content-disposition", `attachment; filename="${entity}-template.xlsx"`)
          .type(XLSX_TYPE)
          .send(await buildTemplate(IMPORT_COLUMNS[entity], req.body, HANDLERS[entity].refs(db)));
      },
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
          ignoredHeaders: headers.filter((h, i) => !keys[i] && filled(h)).map(String),
          rows,
        };
        mkdirSync(dir, { recursive: true });
        // Uploads nobody confirmed don't pile up.
        for (const f of readdirSync(dir))
          if (Date.now() - statSync(join(dir, f)).mtimeMs > DAY) rmSync(join(dir, f));
        const uploadId = crypto.randomUUID();
        writeFileSync(uploadFile(uploadId), JSON.stringify(stored));
        return preview(db, uploadId, stored);
      },
    );

    // Decisions only: the rows come from the stored upload and are validated and matched again.
    // Anything wrong rejects the whole request; the writes are one transaction after a backup.
    app.post(
      "/:entity/apply",
      {
        schema: {
          params,
          body: importApplySchema,
          response: { 200: importResultSchema, 400: apiErrorSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const { entity } = req.params;
        const file = uploadFile(req.body.uploadId);
        const stored = existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as Stored);
        if (!stored || stored.entity !== entity)
          throw new HttpError(404, "upload_not_found", "Upload not found; preview the file again");
        const columns = IMPORT_COLUMNS[entity];
        const handler = HANDLERS[entity];
        const current = preview(db, req.body.uploadId, stored);
        const rows = new Map(current.rows.map((r) => [r.row, r]));
        const targets = new Map(current.targets.map((t) => [t.id, t]));

        const used = new Set<string | number>();
        const ops = req.body.decisions.map((d) => {
          const row = rows.get(d.row);
          if (!row || row.status === "invalid")
            throw new HttpError(400, "invalid_row", `Row ${d.row} can't be imported`);
          const target = d.action === "update" ? targets.get(d.targetId ?? "") : undefined;
          if (d.action === "update" && !target)
            throw new HttpError(400, "target_not_found", `Row ${d.row} has no row to update`);
          // One decision per file row, one file row per existing row.
          for (const key of target ? [d.row, target.id] : [d.row]) {
            if (used.has(key))
              throw new HttpError(400, "duplicate_decision", `Row ${d.row} is used twice`);
            used.add(key);
          }
          return { values: row.values, target, policy: d.policy ?? req.body.policy };
        });

        const backup = await createBackup(db, dataDir, true);
        let created = 0;
        let updated = 0;
        db.transaction(() => {
          for (const op of ops) {
            if (!op.target) {
              handler.create(db, op.values);
              created++;
              continue;
            }
            const patch = mergeValues(columns, op.policy, op.values, op.target.values);
            if (!Object.keys(patch).length) continue;
            handler.update(db, op.target, patch);
            updated++;
          }
        });
        rmSync(file, { force: true });
        return { created, updated, backup: backup.name };
      },
    );
  };
