import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { read3mfEntry, read3mfPaint } from "@3d-maker-suite/3mf";
import {
  apiErrorSchema,
  type IntegrationAdapter,
  type Page,
  type Project,
  type ProjectListItem,
  pageOf,
  projectInputSchema,
  projectListItemSchema,
  projectListQuery,
  projectMetaSchema,
  projectOpenSchema,
  projectPaintSchema,
  projectPatchSchema,
  projectScanStatusSchema,
  projectSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { capableRows } from "../integrations/capabilities.ts";
import { insideRoots, openFolder, slicerLauncher } from "../lib/launcher.ts";
import { columnFilter, listPage, taggedWith } from "../lib/list.ts";
import { readPreferences } from "../lib/preferences.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { projects, collectionProjects, prints } = schema;
const params = z.object({ id: z.uuid() });
const fileQuery = z.object({ path: z.string().min(1), entry: z.string().optional() });
const notFound = { 404: apiErrorSchema };
// "true" / "false", to filter and sort by the `?multicolor=` select values.
const lastPrintAt = sql`(select max(${prints.startedAt}) from ${prints} where ${prints.projectId} = ${projects.id})`;
const isMulticolor = sql`case when json_extract(${projects.meta}, '$.multicolor') then 'true' else 'false' end`;
const errors = {
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  500: apiErrorSchema,
};
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const FILE_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  ".stl": "model/stl",
  ".3mf": "model/3mf",
};

// Rows older than the scanner (e.g. demo data) hold other meta; parsing fills the defaults in.
const out = (row: unknown) => {
  const r = row as Project;
  return { ...r, meta: projectMetaSchema.parse(r.meta) };
};

export const projectsRoutes =
  (
    db: Db,
    dataDir: string,
    scanner: ProjectScanner,
    adapters: IntegrationAdapter[] = [],
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Project not found");
      return out(row);
    };

    // Scan: POST starts a background scan (or queues another pass), GET reports progress.
    app.get("/scan", { schema: { response: { 200: projectScanStatusSchema } } }, async () =>
      scanner.status(),
    );
    app.post(
      "/scan",
      { schema: { response: { 202: projectScanStatusSchema } } },
      async (_, reply) => reply.status(202).send(scanner.start()),
    );

    app.get(
      "/",
      {
        schema: {
          querystring: projectListQuery,
          response: { 200: pageOf(projectListItemSchema) },
        },
      },
      async (req) => {
        const { material } = req.query;
        const page = listPage(db, projects, req.query, {
          sort: {
            name: projects.name,
            createdAt: projects.createdAt,
            multicolor: isMulticolor,
            lastPrintAt,
          },
          dateColumn: projects.createdAt,
          filters: {
            name: sql`${projects.name} || ' ' || coalesce(${projects.description}, '')`,
            multicolor: isMulticolor,
            lastPrintAt,
          },
          where: [
            isNull(projects.archivedAt),
            material &&
              sql`exists (select 1 from json_each(${projects.meta}, '$.materials') where ${columnFilter(sql`value`, material)})`,
            taggedWith(db, "project", projects.id, req.query.tagId),
            req.query.collectionId &&
              inArray(
                projects.id,
                db
                  .select({ id: collectionProjects.projectId })
                  .from(collectionProjects)
                  .where(inArray(collectionProjects.collectionId, req.query.collectionId)),
              ),
          ],
        });
        const ids = page.items.map((p) => p.id);
        const last = new Map(
          ids.length
            ? db
                .select({ id: prints.projectId, at: max(prints.startedAt) })
                .from(prints)
                .where(inArray(prints.projectId, ids))
                .groupBy(prints.projectId)
                .all()
                .map((r) => [r.id, r.at])
            : [],
        );
        const items = page.items.map((p) => ({ ...out(p), lastPrintAt: last.get(p.id) ?? null }));
        return { ...page, items } as Page<ProjectListItem>;
      },
    );

    /** Every material used by a project, for the material filter. */
    app.get("/materials", { schema: { response: { 200: z.array(z.string()) } } }, async () =>
      db
        .all<{ value: string }>(
          sql`select distinct value from ${projects}, json_each(${projects.meta}, '$.materials') where ${projects.archivedAt} is null order by value`,
        )
        .map((r) => r.value),
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: projectSchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    app.post(
      "/",
      {
        schema: {
          body: projectInputSchema,
          response: { 201: projectSchema, 400: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const { folderPath, ...fields } = req.body;
        // Only what the user typed is "edited"; `undefined` means "let the scan decide".
        const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const row = folderPath
          ? await scanner.addFolder(folderPath, given)
          : db
              .insert(projects)
              .values({
                ...given,
                name: fields.name,
                editedFields: Object.keys(given) as Project["editedFields"],
              })
              .returning()
              .get();
        return reply.status(201).send(out(row));
      },
    );

    app.patch(
      "/:id",
      {
        schema: { params, body: projectPatchSchema, response: { 200: projectSchema, ...notFound } },
      },
      async (req) => {
        const { editedFields } = get(req.params.id);
        const touched = Object.keys(req.body) as Project["editedFields"];
        const row = db
          .update(projects)
          .set({ ...req.body, editedFields: [...new Set([...editedFields, ...touched])] })
          .where(eq(projects.id, req.params.id))
          .returning()
          .get();
        return out(row);
      },
    );

    // Serves a model/image listed in meta.files (nothing else is reachable), or, with `entry`,
    // a plate preview inside that 3MF.
    app.get("/:id/file", { schema: { params, querystring: fileQuery } }, async (req, reply) => {
      const { folderPath, meta } = get(req.params.id);
      const { path, entry } = req.query;
      const listed = meta.files.some((f) => f.path === path && f.kind !== "doc");
      const plate = meta.models
        .find((m) => m.file === path)
        ?.plates.some((p) => p.thumbnail === entry);
      if (!folderPath || !listed || (entry && !plate))
        throw new HttpError(404, "not_found", "File not found");
      const abs = join(folderPath, path);
      if (!entry)
        return reply
          .type(FILE_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream")
          .send(createReadStream(abs));
      const png = await read3mfEntry(abs, entry);
      if (!png) throw new HttpError(404, "not_found", "File not found");
      return reply.type("image/png").send(png);
    });

    // Painted triangles of one listed 3MF, read on demand because they need the mesh files.
    app.get(
      "/:id/paint",
      {
        schema: {
          params,
          querystring: z.object({ path: z.string().min(1) }),
          response: { 200: projectPaintSchema, ...notFound },
        },
      },
      async (req) => {
        const { folderPath, meta } = get(req.params.id);
        const { path } = req.query;
        const listed = meta.models.some((m) => m.file === path);
        if (!folderPath || !listed) throw new HttpError(404, "not_found", "File not found");
        return read3mfPaint(join(folderPath, path));
      },
    );

    // Launches a local program, so everything is checked here: the project folder must be inside a
    // configured root, and a file must be one the scanner listed (nothing the client invents).
    app.post(
      "/:id/open",
      {
        schema: {
          params,
          body: projectOpenSchema,
          response: { 200: z.object({ ok: z.literal(true) }), ...errors },
        },
      },
      async (req) => {
        const { folderPath, meta } = get(req.params.id);
        const { target, file, integrationId } = req.body;
        const prefs = readPreferences(db);
        const dir = folderPath && (await insideRoots(folderPath, prefs.projectRoots));
        if (!dir)
          throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
        try {
          if (target === "folder") return await openFolder(dir).then(() => ({ ok: true as const }));
          const listed = file && meta.files.some((f) => f.path === file && f.kind === "model");
          const abs = listed ? await insideRoots(join(dir, file), [dir]) : null;
          if (!abs) throw new HttpError(403, "not_allowed", "File is not part of this project");
          // The picked slicer, else the default one, else the first.
          const slicers = capableRows(db, adapters, "openInSlicer");
          const pick = integrationId ?? prefs.defaultSlicerId;
          const chosen =
            slicers.find((s) => s.row.id === pick) ?? (integrationId ? undefined : slicers[0]);
          const slicer = slicerLauncher(chosen?.row.slicerPath ?? "");
          if (!slicer.canOpen(abs)) throw new HttpError(409, "no_slicer", "No slicer configured");
          await slicer.open(abs);
          return { ok: true as const };
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(500, "launch_failed", "Could not start the program");
        }
      },
    );

    app.get("/:id/thumbnail", { schema: { params } }, async (req, reply) => {
      const { thumbnailPath } = get(req.params.id);
      if (!thumbnailPath) throw new HttpError(404, "not_found", "Project has no thumbnail");
      return reply
        .type(IMAGE_TYPES[extname(thumbnailPath)] ?? "application/octet-stream")
        .send(await readFile(join(dataDir, thumbnailPath)));
    });
  };
