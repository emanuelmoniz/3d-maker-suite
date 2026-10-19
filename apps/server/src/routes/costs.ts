import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse3mf, read3mfEntry } from "@3d-maker-suite/3mf";
import {
  apiErrorSchema,
  costContextSchema,
  type IntegrationAdapter,
  listQuery,
  type Page,
  type ProjectModel,
  pageOf,
  projectMetaSchema,
  QUOTE_UPLOAD_PREFIX,
  type Quote,
  type QuoteSlice,
  quoteFilters,
  quoteInputSchema,
  quotePatchSchema,
  quoteSchema,
  quoteSliceInputSchema,
  quoteSliceSchema,
  quoteSortFields,
  quoteUploadSchema,
  type SliceResultInfo,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { projectLabel } from "../lib/catalog.ts";
import { costContext } from "../lib/cost.ts";
import { insideRoots } from "../lib/launcher.ts";
import { listPage } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import {
  plateResolver,
  type SliceQueue,
  sliceErrorText,
  sliceIntegration,
  slicePlate,
} from "../projects/sliceQueue.ts";

const { quotes, projects, clients, projectSlicePlates } = schema;
/** "001-Vase", the same as the web's `quoteName`. */
const quoteLabel = sql<string>`printf('%03d', ${quotes.number}) || '-' || ${quotes.name}`;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };
/** Uploaded 3MFs, by sha256, in the data folder (backed up with it). */
export const QUOTE_FILES = "quote-files";
const UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
const uploadId = z.string().regex(/^[0-9a-f]{64}$/);
// ponytail: slices of quote plates live in memory (the quote keeps its results once saved);
// the oldest go past this many. A table if they should survive a restart.
const SLICES_KEPT = 500;

export const costsRoutes =
  (
    db: Db,
    dataDir: string,
    adapters: IntegrationAdapter[],
    queue: SliceQueue,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const uploadPath = (id: string) => join(dataDir, QUOTE_FILES, `${id}.3mf`);
    // Content-addressed, so a parsed upload never changes.
    const uploads = new Map<string, ProjectModel>();
    const uploadModel = async (id: string) => {
      if (!uploads.has(id) && existsSync(uploadPath(id)))
        uploads.set(id, {
          file: `${QUOTE_UPLOAD_PREFIX}${id}`,
          ...(await parse3mf(uploadPath(id))),
        });
      return uploads.get(id);
    };
    const sliced = new Map<string, { result: SliceResultInfo | null; error: string | null }>();
    const get = (id: string) => {
      const row = db.select().from(quotes).where(eq(quotes.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Quote not found");
      return row as Quote;
    };
    const checkProject = (projectId?: string | null) => {
      if (projectId && !db.select().from(projects).where(eq(projects.id, projectId)).get())
        throw new HttpError(400, "invalid_project", "Project not found");
    };
    const checkClient = (clientId?: string | null) => {
      if (clientId && !db.select().from(clients).where(eq(clients.id, clientId)).get())
        throw new HttpError(400, "invalid_client", "Client not found");
    };

    app.get("/context", { schema: { response: { 200: costContextSchema } } }, async () =>
      costContext(db),
    );

    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: UPLOAD_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    // A 3MF for the calculator, outside any project. Stored once per content.
    app.post(
      "/files",
      {
        schema: {
          querystring: z.object({ name: z.string().min(1) }),
          response: { 201: quoteUploadSchema, 400: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const { name } = req.query;
        if (!name.toLowerCase().endsWith(".3mf") || !Buffer.isBuffer(req.body) || !req.body.length)
          throw new HttpError(400, "invalid_file", "Send a .3mf file");
        const id = createHash("sha256").update(req.body).digest("hex");
        await mkdir(join(dataDir, QUOTE_FILES), { recursive: true });
        if (!existsSync(uploadPath(id))) await writeFile(uploadPath(id), req.body);
        const model = await uploadModel(id).catch(() => undefined);
        if (!model) throw new HttpError(400, "invalid_file", "Not a readable 3MF");
        return reply.status(201).send({ id, name, model });
      },
    );

    // A plate preview inside an uploaded 3MF.
    app.get(
      "/files/:id",
      {
        schema: {
          params: z.object({ id: uploadId }),
          querystring: z.object({ entry: z.string() }),
        },
      },
      async (req, reply) => {
        const model = await uploadModel(req.params.id).catch(() => undefined);
        if (!model?.plates.some((p) => p.thumbnail === req.query.entry))
          throw new HttpError(404, "not_found", "File not found");
        const png = await read3mfEntry(uploadPath(req.params.id), req.query.entry);
        if (!png) throw new HttpError(404, "not_found", "File not found");
        return reply.type("image/png").send(png);
      },
    );

    // Slices of the calculator's plates (a project's or uploaded): reported, and queued on `run`.
    app.post(
      "/slice",
      {
        schema: {
          body: quoteSliceInputSchema,
          response: { 200: quoteSliceSchema, 400: apiErrorSchema },
        },
      },
      async (req): Promise<QuoteSlice> => {
        const { projectId, plates, run } = req.body;
        const project = projectId
          ? db.select().from(projects).where(eq(projects.id, projectId)).get()
          : undefined;
        if (projectId && !project) throw new HttpError(400, "invalid_project", "Project not found");
        const meta = projectMetaSchema.parse(project?.meta ?? {});
        const { projectRoots } = readPreferences(db);
        const resolve = plateResolver(db);
        const out: QuoteSlice["plates"] = [];
        for (const p of plates) {
          // Only uploads and files the scanner listed; nothing the client invents is read.
          const upload = p.file.startsWith(QUOTE_UPLOAD_PREFIX)
            ? uploadId.safeParse(p.file.slice(QUOTE_UPLOAD_PREFIX.length)).data
            : undefined;
          const model = upload
            ? await uploadModel(upload).catch(() => undefined)
            : meta.models.find((m) => m.file === p.file);
          const abs = !model
            ? null
            : upload
              ? uploadPath(upload)
              : project?.folderPath
                ? await insideRoots(join(project.folderPath, p.file), projectRoots)
                : null;
          const s = abs && (await stat(abs).catch(() => null));
          if (!abs || !s || !model?.plates.some((x) => x.index === p.plate))
            throw new HttpError(400, "invalid_reference", `Unknown plate ${p.plate} of ${p.file}`);
          // Same file (size, mtime) and the same printer and profiles once resolved: same slice.
          const { printer, profileId } = resolve(p, model);
          const key = `quote:${JSON.stringify([abs, s.size, s.mtimeMs, p.plate, printer?.id ?? null, profileId, p.filaments])}`;
          // The project's own slice when it sliced exactly this: the slicer's time estimate moves by
          // a few seconds between runs of the same input, so slicing again would not match it.
          const own =
            project && !upload
              ? db
                  .select()
                  .from(projectSlicePlates)
                  .where(
                    and(
                      eq(projectSlicePlates.projectId, project.id),
                      eq(projectSlicePlates.file, p.file),
                      eq(projectSlicePlates.plate, p.plate),
                    ),
                  )
                  .get()
              : undefined;
          const ownResult =
            own?.slicedAt &&
            own.printTimeSeconds != null &&
            own.weightGrams != null &&
            own.fileSize === s.size &&
            own.fileMtimeMs === s.mtimeMs &&
            own.printerId === (printer?.id ?? null) &&
            own.slicedPrintProfileId === profileId &&
            JSON.stringify(own.filaments) === JSON.stringify(p.filaments)
              ? {
                  printTimeSeconds: own.printTimeSeconds,
                  weightGrams: own.weightGrams,
                  filaments: own.slicedFilaments ?? [],
                  slicedAt: own.slicedAt,
                }
              : null;
          if (ownResult) sliced.set(key, { result: ownResult, error: null });
          let done = sliced.get(key);
          // Run: slices what has no result yet, failed ones again.
          if (run && !done?.result) {
            sliced.delete(key);
            done = undefined;
            queue.add([
              {
                key,
                async run(signal) {
                  let entry: { result: SliceResultInfo | null; error: string | null };
                  try {
                    const { result } = await slicePlate(db, adapters, { ...p, abs, model }, signal);
                    entry = {
                      result: {
                        printTimeSeconds: result.printTimeSeconds,
                        weightGrams: result.weightGrams,
                        filaments: result.filaments,
                        slicedAt: new Date().toISOString(),
                      },
                      error: null,
                    };
                  } catch (e) {
                    entry = { result: null, error: sliceErrorText(e, app.log, { file: p.file }) };
                  }
                  sliced.set(key, entry);
                  if (sliced.size > SLICES_KEPT)
                    sliced.delete(sliced.keys().next().value as string);
                },
              },
            ]);
          }
          out.push({
            file: p.file,
            plate: p.plate,
            job: queue.state(key),
            result: done?.result ?? null,
            error: done?.error ?? null,
          });
        }
        return { canSlice: !!sliceIntegration(db, adapters), plates: out };
      },
    );

    app.get(
      "/quotes",
      {
        schema: {
          querystring: listQuery(quoteSortFields, {}, quoteFilters),
          response: { 200: pageOf(quoteSchema) },
        },
      },
      async (req) =>
        listPage(db, quotes, req.query, {
          sort: {
            // The name starts with the number: sorting by it sorts the name as shown.
            name: quotes.number,
            client: sql`(SELECT ${clients.name} FROM ${clients} WHERE ${clients.id} = ${quotes.clientId})`,
            project: sql`(SELECT ${projectLabel} FROM ${projects} WHERE ${projects.id} = ${quotes.projectId})`,
            quantity: sql`json_extract(${quotes.quote}, '$.quantity')`,
            total: sql`json_extract(${quotes.quote}, '$.total')`,
            createdAt: quotes.createdAt,
          },
          defaultSort: "-name",
          filters: {
            name: quoteLabel,
            clientId: quotes.clientId,
            projectId: quotes.projectId,
            createdAt: quotes.createdAt,
          },
        }) as Page<Quote>,
    );

    app.post(
      "/quotes",
      {
        schema: {
          body: quoteInputSchema,
          response: { 201: quoteSchema, 400: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        checkProject(req.body.projectId);
        checkClient(req.body.clientId);
        assertNumberFree(db, quotes, "quote", req.body.number);
        const { id } = db
          .insert(quotes)
          .values({ ...req.body, number: req.body.number ?? nextNumber(quotes) })
          .returning()
          .get();
        return reply.status(201).send(get(id));
      },
    );

    app.get(
      "/quotes/:id",
      { schema: { params, response: { 200: quoteSchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    app.patch(
      "/quotes/:id",
      {
        schema: {
          params,
          body: quotePatchSchema,
          response: { 200: quoteSchema, 400: apiErrorSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        checkProject(req.body.projectId);
        checkClient(req.body.clientId);
        assertNumberFree(db, quotes, "quote", req.body.number, req.params.id);
        if (Object.keys(req.body).length)
          db.update(quotes).set(req.body).where(eq(quotes.id, req.params.id)).run();
        return get(req.params.id);
      },
    );

    app.delete(
      "/quotes/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        db.delete(quotes).where(eq(quotes.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );
  };
