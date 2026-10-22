import { createReadStream } from "node:fs";
import { readFile, rmdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { read3mfEntry, read3mfPaint } from "@3d-maker-suite/3mf";
import {
  apiErrorSchema,
  type IntegrationAdapter,
  type Page,
  type Project,
  type ProjectDetail,
  type ProjectListItem,
  pageOf,
  projectDetailSchema,
  projectFolderSchema,
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
import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { capableRows } from "../integrations/capabilities.ts";
import { projectLabel } from "../lib/catalog.ts";
import { insideRoots, openFolder, slicerLauncher } from "../lib/launcher.ts";
import { columnFilter, listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences, rootPaths } from "../lib/preferences.ts";
import { folderName, newProjectFolder } from "../projects/newFolder.ts";
import { projectPath, segments } from "../projects/paths.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const {
  projects,
  collectionProjects,
  printFilamentUsages,
  prints,
  printers,
  projectSlicePlates: plates,
} = schema;
const params = z.object({ id: z.uuid() });
const fileQuery = z.object({ path: z.string().min(1), entry: z.string().optional() });
const notFound = { 404: apiErrorSchema };
// "true" / "false", to filter and sort by the `?multicolor=` select values.
const lastPrintAt = sql`(select max(${prints.startedAt}) from ${prints} where ${prints.projectId} = ${projects.id})`;
const isMulticolor = sql`case when json_extract(${projects.meta}, '$.multicolor') then 'true' else 'false' end`;
/**
 * `PROJECT_SLICING` of a project: a plate never sliced, sliced with other profiles than now, or
 * whose file the last scan saw at another size makes it "needed". ponytail: size only, the project
 * page hashes; a same-size edit shows there first. Store the scanned mtime if that misleads.
 */
// Qualified: bare "id" / "meta" inside the subqueries would be the plate's.
const projectId = sql`${projects}.${sql.identifier("id")}`;
const projectMeta = sql`${projects}.${sql.identifier("meta")}`;
// The print profile a plate slices with, as `plateResolver` (the PUT stores plates resolved).
const plateProfile = sql`coalesce(${plates.printProfileId}, case when ${plates.useDefaultPrintProfile} then (select p.${sql.identifier("print_profile_id")} from ${printers} p where p.${sql.identifier("id")} = ${plates.printerId}) end)`;
const slicing = sql<ProjectListItem["slicing"]>`case
  when not exists (select 1 from ${plates} where ${plates.projectId} = ${projectId}) then 'none'
  when exists (select 1 from ${plates} where ${plates.projectId} = ${projectId} and (
    ${plates.slicedAt} is null
    or ${plates.slicedPrintProfileId} is not ${plateProfile}
    or exists (select 1 from json_each(${projectMeta}, '$.files') f
      where json_extract(f.value, '$.path') = ${plates.file}
        and json_extract(f.value, '$.size') != ${plates.fileSize})
  )) then 'needed'
  else 'done' end`;
const errors = {
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  500: apiErrorSchema,
};
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/**
 * Sets an image's type. An SVG also gets a sandboxing CSP: opened on its own (not through `<img>`,
 * which never runs scripts) it can't run scripts, load anything or reach the app's origin.
 */
export const imageReply = (reply: FastifyReply, path: string) => {
  const ext = extname(path).toLowerCase();
  if (ext === ".svg")
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    );
  return reply
    .header("X-Content-Type-Options", "nosniff")
    .type(IMAGE_TYPES[ext] ?? "application/octet-stream");
};

const FILE_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  ".stl": "model/stl",
  ".3mf": "model/3mf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
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
    // ponytail: an offline root reads as "missing" too; 4.2.0 Step 7 tells them apart.
    const detail = async (id: string): Promise<ProjectDetail> => {
      const p = get(id);
      const there = p.folderPath && (await stat(p.folderPath).catch(() => null))?.isDirectory();
      return { ...p, folderState: p.folderPath ? (there ? "ok" : "missing") : null };
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
            // The name starts with the number: sorting by it sorts the name as shown.
            name: projects.number,
            createdAt: projects.createdAt,
            multicolor: isMulticolor,
            lastPrintAt,
          },
          defaultSort: "-name",
          dateColumn: projects.createdAt,
          filters: {
            name: sql`${projectLabel} || ' ' || coalesce(${projects.description}, '')`,
            multicolor: isMulticolor,
            lastPrintAt,
            slicing,
          },
          where: [
            isNull(projects.archivedAt),
            material &&
              sql`exists (select 1 from json_each(${projects.meta}, '$.materials') where ${columnFilter(sql`value`, material)})`,
            taggedWith(db, "project", projects.id, req.query.tagId),
            req.query.spoolId &&
              inArray(
                projects.id,
                db
                  .select({ id: prints.projectId })
                  .from(prints)
                  .innerJoin(printFilamentUsages, eq(printFilamentUsages.printId, prints.id))
                  .where(inArray(printFilamentUsages.spoolId, req.query.spoolId)),
              ),
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
        const slicingById = new Map(
          ids.length
            ? db
                .select({ id: projects.id, slicing })
                .from(projects)
                .where(inArray(projects.id, ids))
                .all()
                .map((r) => [r.id, r.slicing])
            : [],
        );
        const items = page.items.map((p) => ({
          ...out(p),
          lastPrintAt: last.get(p.id) ?? null,
          slicing: slicingById.get(p.id) ?? "none",
        }));
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
      { schema: { params, response: { 200: projectDetailSchema, ...notFound } } },
      async (req) => detail(req.params.id),
    );

    // Gives a project without a working folder one: links `path`, or makes `<root>/<NNN>_<name>`.
    app.post(
      "/:id/folder",
      {
        schema: {
          params,
          body: projectFolderSchema,
          response: { 200: projectDetailSchema, 400: apiErrorSchema, ...errors },
        },
      },
      async (req) => {
        const p = await detail(req.params.id);
        if (p.folderState === "ok")
          throw new HttpError(409, "has_folder", "Project already has a folder");
        const { path, root } = req.body;
        const folder = path
          ? await scanner.usableFolder(path)
          : await newProjectFolder(db, root, folderName(p.number, p.name));
        const point = (folderPath: string | null) =>
          db.update(projects).set({ folderPath }).where(eq(projects.id, p.id)).run();
        // The plates were of files that are gone: slice again on the new folder if needed.
        db.delete(plates).where(eq(plates.projectId, p.id)).run();
        point(folder);
        try {
          await scanner.refresh(folder);
        } catch (e) {
          point(p.folderPath);
          if (!path) await rmdir(folder).catch(() => {});
          throw e;
        }
        return detail(p.id);
      },
    );

    // Unlinks the folder: the project forgets its files and their slices, the files on disk stay.
    app.delete(
      "/:id/folder",
      { schema: { params, response: { 200: projectDetailSchema, ...notFound } } },
      async (req) => {
        const { id } = req.params;
        if (!get(id).folderPath) throw new HttpError(404, "no_folder", "Project has no folder");
        db.transaction((tx) => {
          tx.delete(plates).where(eq(plates.projectId, id)).run();
          tx.update(projects)
            .set({
              folderPath: null,
              filePath: null,
              descriptionFile: null,
              coverFile: null,
              gallery: { folders: [], images: [] },
              meta: projectMetaSchema.parse({}),
            })
            .where(eq(projects.id, id))
            .run();
        });
        return detail(id);
      },
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
        const { folderPath, number, createFolder, root, ...fields } = req.body;
        assertNumberFree(db, projects, "project", number);
        // Only what the user typed is "edited"; `undefined` means "let the scan decide".
        const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        if (createFolder) {
          const n = number ?? db.get<{ n: number }>(sql`select ${nextNumber(projects)} as n`).n;
          const folder = await newProjectFolder(db, root, folderName(n, fields.name));
          try {
            const row = await scanner.addFolder(folder, { ...given, number: n });
            return reply.status(201).send(out(row));
          } catch (e) {
            await rmdir(folder).catch(() => {});
            throw e;
          }
        }
        const row = folderPath
          ? await scanner.addFolder(folderPath, { ...given, number })
          : db
              .insert(projects)
              .values({
                ...given,
                number: number ?? nextNumber(projects),
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
        schema: {
          params,
          body: projectPatchSchema,
          response: {
            200: projectSchema,
            400: apiErrorSchema,
            403: apiErrorSchema,
            409: apiErrorSchema,
            ...notFound,
          },
        },
      },
      async (req) => {
        const { editedFields, folderPath, meta } = get(req.params.id);
        const { descriptionFile, previewFile, number, gallery, coverFile, autoSlice, ...fields } =
          req.body;
        assertNumberFree(db, projects, "project", number, req.params.id);
        const touched = new Set([...editedFields, ...(Object.keys(fields) as typeof editedFields)]);
        // Not scanned fields, so not tracked in `editedFields`.
        const set: Partial<typeof projects.$inferInsert> = { ...fields, number, autoSlice };
        if (descriptionFile) {
          // Link a doc the scanner listed; its text becomes the description on the refresh below.
          const doc = meta.files.some(
            (f) => f.path === descriptionFile && f.kind === "doc" && !/.pdf$/i.test(f.path),
          );
          if (!folderPath || !doc) throw new HttpError(404, "not_found", "File not found");
          set.descriptionFile = descriptionFile;
          touched.delete("description");
          delete set.description;
        } else if (descriptionFile === null || "description" in fields) {
          // Typing a description (or choosing "None") ends the link; the text stays as edited.
          set.descriptionFile = null;
          touched.add("description");
        }
        if (previewFile) {
          // Stored absolute like the scanner's pick; it must be a model the scanner listed.
          const model = meta.files.some((f) => f.path === previewFile && f.kind === "model");
          if (!folderPath || !model) throw new HttpError(404, "not_found", "File not found");
          set.filePath = join(folderPath, ...previewFile.split("/"));
          touched.add("filePath");
        } else if (previewFile === null) touched.delete("filePath");
        if (gallery || coverFile) {
          // Not scanned fields either: the scanner never writes them, so they survive re-scans.
          // Every path is project-relative; images must be listed, folders pass the path guard.
          if (!folderPath) throw new HttpError(404, "no_folder", "Project has no folder");
          const dir = await insideRoots(folderPath, rootPaths(db));
          if (!dir)
            throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
          const image = (rel: string) => {
            segments(rel);
            if (!meta.files.some((f) => f.path === rel && f.kind === "image"))
              throw new HttpError(404, "not_found", "File not found");
          };
          for (const rel of gallery?.images ?? []) image(rel);
          if (coverFile) image(coverFile);
          for (const rel of gallery?.folders ?? [])
            if (!(await projectPath(dir, rel, "existing")).isDir)
              throw new HttpError(400, "not_a_directory", "Not a folder");
        }
        if (gallery)
          set.gallery = {
            folders: [...new Set(gallery.folders)],
            images: [...new Set(gallery.images)],
          };
        if (coverFile !== undefined) set.coverFile = coverFile;
        db.update(projects)
          .set({ ...set, editedFields: [...touched] })
          .where(eq(projects.id, req.params.id))
          .run();
        if ((descriptionFile || previewFile === null || coverFile !== undefined) && folderPath)
          await scanner.refresh(folderPath);
        return get(req.params.id);
      },
    );

    // Serves a file listed in meta.files (nothing else is reachable), or, with `entry`, a plate
    // preview inside that 3MF.
    app.get("/:id/file", { schema: { params, querystring: fileQuery } }, async (req, reply) => {
      const { folderPath, meta } = get(req.params.id);
      const { path, entry } = req.query;
      const listed = meta.files.some((f) => f.path === path && f.kind !== "shortcut");
      const plate = meta.models
        .find((m) => m.file === path)
        ?.plates.some((p) => p.thumbnail === entry);
      if (!folderPath || !listed || (entry && !plate))
        throw new HttpError(404, "not_found", "File not found");
      const abs = join(folderPath, path);
      if (!entry) {
        const ext = extname(path).toLowerCase();
        if (IMAGE_TYPES[ext]) imageReply(reply, path);
        else reply.type(FILE_TYPES[ext] ?? "application/octet-stream");
        return reply.send(createReadStream(abs));
      }
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
        const dir = folderPath && (await insideRoots(folderPath, rootPaths(db)));
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
      return imageReply(reply, thumbnailPath).send(await readFile(join(dataDir, thumbnailPath)));
    });
  };
