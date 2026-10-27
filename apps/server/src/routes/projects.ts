import { createReadStream } from "node:fs";
import { cp, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { read3mfEntry, read3mfPaint } from "@3d-maker-suite/3mf";
import {
  apiErrorSchema,
  type IntegrationAdapter,
  type Page,
  type Project,
  type ProjectDetail,
  type ProjectFolderRelease,
  type ProjectListItem,
  pageOf,
  pickSlicer,
  projectDetailSchema,
  projectFolderResultSchema,
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
  projectUnlinkQuery,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { capableRows } from "../integrations/capabilities.ts";
import { projectLabel } from "../lib/catalog.ts";
import { openFolder, slicerLauncher } from "../lib/launcher.ts";
import { columnFilter, listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { dropNewFolder, folderName, newProjectFolder } from "../projects/newFolder.ts";
import { projectPath, segments } from "../projects/paths.ts";
import {
  absPath,
  listRoots,
  projectDir,
  projectFile,
  type Root,
  rootFs,
} from "../projects/rootFs.ts";
import type { ProjectScanner } from "../projects/scanner.ts";
import { fsError } from "./fs.ts";

const {
  projects,
  collectionProjects,
  integrations,
  orderProjects,
  printFilamentUsages,
  prints,
  printers,
  projectSlicePlates: plates,
  taggings,
} = schema;
const params = z.object({ id: z.uuid() });
const fileQuery = z.object({ path: z.string().min(1), entry: z.string().optional() });
const notFound = { 404: apiErrorSchema };
// "true" / "false", to filter and sort by the `?multicolor=` select values.
const lastPrintAt = sql`(select max(${prints.startedAt}) from ${prints} where ${prints.projectId} = ${projects.id})`;
const isMulticolor = sql`case when json_extract(${projects.meta}, '$.multicolor') then 'true' else 'false' end`;
/**
 * `PROJECT_SLICING` of a project: a plate never sliced, sliced with other profiles or slicer than now, or
 * whose file the last scan saw at another size makes it "needed". ponytail: size only, the project
 * page hashes; a same-size edit shows there first. Store the scanned mtime if that misleads.
 */
// Qualified: bare "id" / "meta" inside the subqueries would be the plate's.
const projectId = sql`${projects}.${sql.identifier("id")}`;
const projectMeta = sql`${projects}.${sql.identifier("meta")}`;
// The print profile a plate slices with, as `plateResolver` (the PUT stores plates resolved).
const plateProfile = sql`coalesce(${plates.printProfileId}, case when ${plates.useDefaultPrintProfile} then (select p.${sql.identifier("print_profile_id")} from ${printers} p where p.${sql.identifier("id")} = ${plates.printerId}) end)`;
const projectSlicer = sql`${projects}.${sql.identifier("slicer_integration_id")}`;
/** The slicer a plate slices with, as `slicerResolver`: `capable` can slice now, `fallback` = the default's pick. */
const plateSlicer = (capable: string[], fallback: string | undefined) => {
  const can = sql`(select value from json_each(${JSON.stringify(capable)}))`;
  return sql`case when ${plates.slicerIntegrationId} in ${can} then ${plates.slicerIntegrationId}
    when ${projectSlicer} in ${can} then ${projectSlicer} else ${fallback ?? null} end`;
};
type Capable = { id: string; slicerVersion: string | null };
const slicingOf = (slicers: Capable[], fallback: string | undefined) => {
  const capable = slicers.map((s) => s.id);
  // A known version that isn't the resolved slicer's now (`slicedWithOther`).
  const versions = JSON.stringify(Object.fromEntries(slicers.map((s) => [s.id, s.slicerVersion])));
  const version = sql`json_extract(${versions}, '$."' || ${plateSlicer(capable, fallback)} || '"')`;
  return sql<ProjectListItem["slicing"]>`case
  when not exists (select 1 from ${plates} where ${plates.projectId} = ${projectId}) then 'none'
  when exists (select 1 from ${plates} where ${plates.projectId} = ${projectId} and (
    ${plates.slicedAt} is null
    or ${plates.slicedPrintProfileId} is not ${plateProfile}
    or coalesce(${plates.slicedIntegrationId}, ${fallback ?? null}) is not ${plateSlicer(capable, fallback)}
    or (${plates.slicedSlicerVersion} is not null and ${plates.slicedSlicerVersion} is not ${version})
    or exists (select 1 from json_each(${projectMeta}, '$.files') f
      where json_extract(f.value, '$.path') = ${plates.file}
        and json_extract(f.value, '$.size') != ${plates.fileSize})
  )) then 'needed'
  else 'done' end`;
};
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

// OS clutter, which doesn't make a folder one with files.
const JUNK = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);
/** Whether anything but folders and clutter is left below `dir` (a link counts: it isn't followed). */
const hasFiles = async (dir: string) =>
  (await readdir(dir, { recursive: true, withFileTypes: true })).some(
    (e) => !e.isDirectory() && !JUNK.has(e.name.toLowerCase()),
  );

/**
 * Moves everything in `from` into `to`, then removes `from` (now empty). All-or-nothing on names:
 * if anything would overwrite something, nothing moves.
 */
async function moveContents(from: string, to: string) {
  const names = await readdir(from).catch((e) => Promise.reject(fsError(e)));
  for (const n of names)
    if (
      await stat(join(to, n)).then(
        () => true,
        () => false,
      )
    )
      throw new HttpError(409, "folder_exists", `The new folder already has a file named ${n}`);
  for (const n of names) {
    const src = join(from, n);
    const dest = join(to, n);
    // A different volume can't rename: copy, then remove.
    await rename(src, dest).catch(async (e: NodeJS.ErrnoException) => {
      if (e.code !== "EXDEV") return Promise.reject(fsError(e));
      await cp(src, dest, { recursive: true, errorOnExist: true });
      await rm(src, { recursive: true, force: true });
    });
  }
  await rmdir(from).catch(() => {});
}

type Row = typeof projects.$inferSelect;
/** `rel` below the root `rootId` as an absolute path, for showing; null without a folder. */
const shown = (roots: Root[], rootId: string | null, rel: string | null) => {
  const root = rel === null ? undefined : roots.find((r) => r.id === rootId);
  return root && rel !== null ? absPath(root, rel) : null;
};
/**
 * The API's project: the folders also as absolute paths. Rows older than the scanner (e.g. demo
 * data) hold other meta; parsing fills the defaults in.
 */
const out = (r: Row, roots: Root[]): Project => ({
  ...(r as unknown as Project),
  meta: projectMetaSchema.parse(r.meta),
  folderPath: shown(roots, r.rootId, r.folder),
  unlinkedFolder: shown(roots, r.unlinkedRootId, r.unlinkedFolder),
});

export const projectsRoutes =
  (
    db: Db,
    dataDir: string,
    scanner: ProjectScanner,
    adapters: IntegrationAdapter[] = [],
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const row = (id: string) => {
      const r = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!r) throw new HttpError(404, "not_found", "Project not found");
      return r;
    };
    const get = (id: string) => out(row(id), listRoots(db));

    /** Moves a project folder into its root's trash; returns where it went. */
    const toTrash = (own: NonNullable<Awaited<ReturnType<typeof projectDir>>>) =>
      own.fs.trash(
        own.rel,
        `${new Date().toISOString().replace(/[:.]/g, "-")}_${basename(own.dir)}`,
      );

    /** What a project knows about its folder's files, dropped when they aren't its any more. */
    const forget = (id: string) =>
      db.transaction((tx) => {
        tx.delete(plates).where(eq(plates.projectId, id)).run();
        tx.update(projects)
          .set({
            filePath: null,
            descriptionFile: null,
            coverFile: null,
            gallery: { folders: [], images: [] },
            meta: projectMetaSchema.parse({}),
          })
          .where(eq(projects.id, id))
          .run();
      });

    /**
     * Lets go of a project's folder. "keep": the folder and everything the project knows stay as
     * they are, and the folder is remembered so scans skip it (linking it again picks it all
     * up). "trash": the folder moves to its root's trash and the project forgets its files.
     * Returns where a trashed folder went.
     */
    async function release(p: ProjectDetail, how: ProjectFolderRelease) {
      const unlink = (kept?: Pick<Row, "unlinkedRootId" | "unlinkedFolder">) =>
        db
          .update(projects)
          .set({ rootId: null, folder: null, ...kept })
          .where(eq(projects.id, p.id))
          .run();
      if (how === "keep")
        return void unlink({ unlinkedRootId: p.rootId, unlinkedFolder: p.folder });
      let trashedTo: string | undefined;
      if (p.folderState === "ok") {
        const own = await projectDir(db, p);
        if (!own)
          throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
        trashedTo = await toTrash(own);
      }
      unlink();
      forget(p.id);
      return trashedTo;
    }

    // ponytail: an offline root reads as "missing" too; 4.2.0 Step 7 tells them apart.
    const detail = async (id: string): Promise<ProjectDetail> => {
      const p = get(id);
      const own = p.rootId && (await projectDir(db, p));
      const there = own && (await stat(own.dir).catch(() => null))?.isDirectory();
      return { ...p, folderState: p.rootId ? (there ? "ok" : "missing") : null };
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
        const capable = capableRows(db, adapters, "slice").map((r) => r.row);
        const slicing = slicingOf(
          capable,
          pickSlicer(
            capable.map((r) => r.id),
            [readPreferences(db).defaultSlicerId],
          ),
        );
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
        const roots = listRoots(db);
        const items = page.items.map((p) => ({
          ...out(p, roots),
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

    // Gives a project a folder: links `path`, or makes `<root>/<NNN>_<name>`. One whose folder is
    // there lets go of it first, as `previous` says.
    app.post(
      "/:id/folder",
      {
        schema: {
          params,
          body: projectFolderSchema,
          response: { 200: projectFolderResultSchema, 400: apiErrorSchema, ...errors },
        },
      },
      async (req) => {
        const p = await detail(req.params.id);
        const { path, rootId, previous } = req.body;
        if (p.folderState === "ok" && !previous)
          throw new HttpError(409, "has_folder", "Project already has a folder");
        // Checked (or made) before the current folder is let go of.
        const place = path
          ? await scanner.usableFolder(path)
          : await newProjectFolder(db, rootId, folderName(p.number, p.name));
        let trashedTo: string | undefined;
        if (p.folderState === "ok" && previous === "move") {
          const own = await projectDir(db, p);
          const to = await rootFs(place.root).local(place.rel);
          if (!own || !to || !path)
            throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
          // Into itself, or onto the folder being left, would lose or loop files.
          const rel = relative(own.dir, to);
          if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
            throw new HttpError(400, "invalid_folder", "Pick a folder outside the current one");
          await moveContents(own.dir, to);
          // The old folder is gone with its content: nothing to remember or trash.
          db.update(projects)
            .set({ rootId: null, folder: null, unlinkedRootId: null, unlinkedFolder: null })
            .where(eq(projects.id, p.id))
            .run();
        } else if (p.folderState === "ok" && previous && previous !== "move") {
          trashedTo = await release(p, previous);
        }
        const now = row(p.id);
        // The folder it was unlinked from and kept: everything it knew is still right. Anything
        // else (and its plates) was of files that aren't its own: slice again if needed.
        const kept =
          now.rootId === null &&
          now.unlinkedRootId === place.root.id &&
          now.unlinkedFolder === place.rel;
        if (!kept) forget(p.id);
        scanner.claim(place);
        const point = (to: Pick<Row, "rootId" | "folder">) =>
          db.update(projects).set(to).where(eq(projects.id, p.id)).run();
        const linked = { rootId: place.root.id, folder: place.rel };
        point(linked);
        try {
          await scanner.refresh(linked);
        } catch (e) {
          point({ rootId: now.rootId, folder: now.folder });
          if (!path) await dropNewFolder(place);
          throw e;
        }
        return { ...(await detail(p.id)), trashedTo };
      },
    );

    // Whether the folder holds any file, so a switch can offer to move the content along.
    app.get(
      "/:id/folder/content",
      { schema: { params, response: { 200: z.object({ hasFiles: z.boolean() }), ...errors } } },
      async (req) => {
        const p = await detail(req.params.id);
        const own = p.folderState === "ok" && (await projectDir(db, p));
        return { hasFiles: !!own && (await hasFiles(own.dir)) };
      },
    );

    // Deletes a project nothing points at. Its folder goes too, only when no file is left in it: a
    // folder with files in a root would be scanned back in as a project.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const p = get(req.params.id);
        if (db.select({ id: prints.id }).from(prints).where(eq(prints.projectId, p.id)).get())
          throw new HttpError(409, "project_has_prints", "Move or remove its prints first");
        if (db.select().from(orderProjects).where(eq(orderProjects.projectId, p.id)).get())
          throw new HttpError(409, "project_in_order", "Remove it from its orders first");
        // Only a folder below a root is the app's to remove (and only there would a scan find it
        // again); one gone or led out of its root by a link stays as it is.
        const own = (await projectDir(db, p))?.dir;
        if (own && (await hasFiles(own)))
          throw new HttpError(409, "folder_has_files", "Its folder still has files");
        db.transaction((tx) => {
          tx.delete(taggings)
            .where(and(eq(taggings.entityType, "project"), eq(taggings.entityId, p.id)))
            .run();
          tx.delete(projects).where(eq(projects.id, p.id)).run();
        });
        if (own) await rm(own, { recursive: true, force: true });
        if (p.thumbnailPath) await rm(join(dataDir, p.thumbnailPath), { force: true });
        return reply.status(204).send(null);
      },
    );

    // Unlinks the folder: `files` says whether it goes to the trash or stays as it is (`release`).
    app.delete(
      "/:id/folder",
      {
        schema: {
          params,
          querystring: projectUnlinkQuery,
          response: { 200: projectFolderResultSchema, ...errors },
        },
      },
      async (req) => {
        const p = await detail(req.params.id);
        if (!p.rootId) throw new HttpError(404, "no_folder", "Project has no folder");
        const trashedTo = await release(p, req.query.files);
        return { ...(await detail(p.id)), trashedTo };
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
        const { folderPath, number, createFolder, rootId, ...fields } = req.body;
        assertNumberFree(db, projects, "project", number);
        // Only what the user typed is "edited"; `undefined` means "let the scan decide".
        const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        if (createFolder) {
          const n = number ?? db.get<{ n: number }>(sql`select ${nextNumber(projects)} as n`).n;
          const place = await newProjectFolder(db, rootId, folderName(n, fields.name));
          try {
            const made = await scanner.addFolder(place, { ...given, number: n });
            return reply.status(201).send(get(made?.id ?? ""));
          } catch (e) {
            await dropNewFolder(place);
            throw e;
          }
        }
        const made = folderPath
          ? await scanner.addFolder(await scanner.usableFolder(folderPath), { ...given, number })
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
        return reply.status(201).send(get(made?.id ?? ""));
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
        const current = get(req.params.id);
        const { editedFields, folder, meta } = current;
        const {
          descriptionFile,
          previewFile,
          number,
          gallery,
          coverFile,
          autoSlice,
          slicerIntegrationId,
          ...fields
        } = req.body;
        assertNumberFree(db, projects, "project", number, req.params.id);
        if (
          slicerIntegrationId &&
          !db.select().from(integrations).where(eq(integrations.id, slicerIntegrationId)).get()
        )
          throw new HttpError(400, "invalid_reference", "Unknown slicer");
        const touched = new Set([...editedFields, ...(Object.keys(fields) as typeof editedFields)]);
        // Not scanned fields, so not tracked in `editedFields`.
        const set: Partial<typeof projects.$inferInsert> = {
          ...fields,
          number,
          autoSlice,
          slicerIntegrationId,
        };
        if (descriptionFile) {
          // Link a doc the scanner listed; its text becomes the description on the refresh below.
          const doc = meta.files.some(
            (f) => f.path === descriptionFile && f.kind === "doc" && !/.pdf$/i.test(f.path),
          );
          if (folder === null || !doc) throw new HttpError(404, "not_found", "File not found");
          set.descriptionFile = descriptionFile;
          touched.delete("description");
          delete set.description;
        } else if (descriptionFile === null || "description" in fields) {
          // Typing a description (or choosing "None") ends the link; the text stays as edited.
          set.descriptionFile = null;
          touched.add("description");
        }
        if (previewFile) {
          // It must be a model the scanner listed.
          const model = meta.files.some((f) => f.path === previewFile && f.kind === "model");
          if (folder === null || !model) throw new HttpError(404, "not_found", "File not found");
          set.filePath = previewFile;
          touched.add("filePath");
        } else if (previewFile === null) touched.delete("filePath");
        if (gallery || coverFile) {
          // Not scanned fields either: the scanner never writes them, so they survive re-scans.
          // Every path is project-relative; images must be listed, folders pass the path guard.
          if (folder === null) throw new HttpError(404, "no_folder", "Project has no folder");
          const dir = (await projectDir(db, current))?.dir;
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
        if (descriptionFile || previewFile === null || coverFile !== undefined)
          await scanner.refresh(current);
        return get(req.params.id);
      },
    );

    // Serves a file listed in meta.files (nothing else is reachable), or, with `entry`, a plate
    // preview inside that 3MF.
    app.get("/:id/file", { schema: { params, querystring: fileQuery } }, async (req, reply) => {
      const p = get(req.params.id);
      const { path, entry } = req.query;
      const listed = p.meta.files.some((f) => f.path === path && f.kind !== "shortcut");
      const plate = p.meta.models
        .find((m) => m.file === path)
        ?.plates.some((pl) => pl.thumbnail === entry);
      const abs = listed && (!entry || plate) && (await projectFile(db, p, path));
      if (!abs) throw new HttpError(404, "not_found", "File not found");
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
        const p = get(req.params.id);
        const { path } = req.query;
        const abs = p.meta.models.some((m) => m.file === path) && (await projectFile(db, p, path));
        if (!abs) throw new HttpError(404, "not_found", "File not found");
        return read3mfPaint(abs);
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
        const p = get(req.params.id);
        const { target, file, integrationId } = req.body;
        const prefs = readPreferences(db);
        const dir = (await projectDir(db, p))?.dir;
        if (!dir)
          throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
        try {
          if (target === "folder") return await openFolder(dir).then(() => ({ ok: true as const }));
          const listed = file && p.meta.files.some((f) => f.path === file && f.kind === "model");
          const abs = listed ? await projectFile(db, p, file) : null;
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
