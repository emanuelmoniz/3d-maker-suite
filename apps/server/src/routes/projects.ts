import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, posix, relative } from "node:path";
import { read3mfEntry, read3mfPaint } from "@3d-maker-suite/3mf";
import {
  apiErrorSchema,
  galleryImages,
  hubFileLockQuerySchema,
  hubFileLockSchema,
  hubFileVersionQuerySchema,
  hubFileVersionSchema,
  type IntegrationAdapter,
  openTargetsSchema,
  type Page,
  type Project,
  type ProjectDetail,
  type ProjectFolderRelease,
  type ProjectListItem,
  pageOf,
  projectDetailSchema,
  projectFolderResultSchema,
  projectFolderRowSchema,
  projectFolderSchema,
  projectInputSchema,
  projectListItemSchema,
  projectListQuery,
  projectMetaSchema,
  projectOpenSchema,
  projectPaintSchema,
  projectPatchSchema,
  projectRelinkResultSchema,
  projectRelinkSchema,
  projectScanStatusSchema,
  projectSchema,
  projectUnlinkQuery,
  ROOT_HUB,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq, inArray, isNotNull, max, type SQL, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { capableRows, presetLibrary } from "../integrations/capabilities.ts";
import { alertTasks, archivedAtOf, archivedWhere, resolveItemAlerts } from "../lib/archive.ts";
import {
  assertRootEditable,
  fromThisPc,
  projectAccessOf,
  rootRule,
  visibleProjects,
} from "../lib/auth.ts";
import { projectLabel } from "../lib/catalog.ts";
import { assertFree, deleteItem } from "../lib/dependents.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { openFolder, slicerLauncher } from "../lib/launcher.ts";
import { columnFilter, listPage, taggedWith } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import type { HubFiles } from "../projects/hubFiles.ts";
import { dropNewFolder, folderName, newProjectFolder } from "../projects/newFolder.ts";
import { projectPath, segments } from "../projects/paths.ts";
import {
  absPath,
  listRoots,
  onDevice,
  onDeviceRoot,
  projectDir,
  projectFile,
  type Root,
  type RootFs,
  rootFs,
} from "../projects/rootFs.ts";
import type { ProjectScanner } from "../projects/scanner.ts";
import { plateResolver, slicerResolver } from "../projects/sliceQueue.ts";
import { fsError } from "./fs.ts";

const {
  projects,
  collectionProjects,
  deviceProjects,
  deviceRootFolders,
  devices,
  integrations,
  printFilamentUsages,
  prints,
  projectSlicePlates: plates,
  slicerPresets,
  users,
} = schema;
const params = z.object({ id: z.uuid() });
const fileQuery = z.object({ path: z.string().min(1), entry: z.string().optional() });
const notFound = { 404: apiErrorSchema };
/** Open on a device waits this long at most: a project that isn't there yet downloads first. */
const DEVICE_OPEN_MS = 10 * 60_000;
// "true" / "false", to filter and sort by the `?multicolor=` select values.
const lastPrintAt = sql`(select max(${prints.startedAt}) from ${prints} where ${prints.projectId} = ${projects.id})`;
const isMulticolor = sql`case when json_extract(${projects.meta}, '$.multicolor') then 'true' else 'false' end`;
/**
 * `PROJECT_SLICING` of a project: a plate never sliced, sliced with other presets or slicer than now, or
 * whose file the last scan saw at another size makes it "needed". ponytail: size only, the project
 * page hashes; a same-size edit shows there first. Store the scanned mtime if that misleads.
 */
// Qualified: bare "id" / "meta" inside the subqueries would be the plate's.
const projectId = sql`${projects}.${sql.identifier("id")}`;
const projectMeta = sql`${projects}.${sql.identifier("meta")}`;
/**
 * Every plate's process preset now, by plate id, as JSON (`plateResolver`; the PUT stores plates
 * resolved, so `useDefaultProcessPreset` says whether it is the file's). ponytail: all plates per
 * list read; key the map by the page's projects if that gets slow.
 */
function platePresets(db: Db, adapters: IntegrationAdapter[]) {
  const resolve = plateResolver(db);
  const slicerOf = slicerResolver(db, adapters);
  const rows = db
    .select({
      id: plates.id,
      printerId: plates.printerId,
      machinePresetId: plates.machinePresetId,
      processPresetId: plates.processPresetId,
      useDefaultProcessPreset: plates.useDefaultProcessPreset,
      slicer: plates.slicerIntegrationId,
      projectSlicer: projects.slicerIntegrationId,
    })
    .from(plates)
    .innerJoin(projects, eq(projects.id, plates.projectId))
    .all();
  return JSON.stringify(
    Object.fromEntries(
      rows.map((r) => {
        const found = slicerOf([r.slicer, r.projectSlicer]);
        const { defaultPresetId } = resolve(r, undefined, found && presetLibrary(found.adapter));
        return [r.id, r.processPresetId ?? (r.useDefaultProcessPreset ? defaultPresetId : null)];
      }),
    ),
  );
}
const projectSlicer = sql`${projects}.${sql.identifier("slicer_integration_id")}`;
/**
 * The slicer a plate slices with, as `slicerResolver`: a pick's library's hub's slicer (`toHub`),
 * else `fallback` = the default's.
 */
const plateSlicer = (toHub: Record<string, string>, fallback: string | undefined) => {
  const map = JSON.stringify(toHub);
  const hubOf = (pick: SQL) => sql`json_extract(${map}, '$."' || ${pick} || '"')`;
  return sql`coalesce(${hubOf(sql`${plates.slicerIntegrationId}`)}, ${hubOf(projectSlicer)}, ${fallback ?? null})`;
};
type Capable = { id: string; slicerVersion: string | null };
const slicingOf = (
  slicers: Capable[],
  toHub: Record<string, string>,
  fallback: string | undefined,
  presets: string,
) => {
  const platePreset = sql`json_extract(${presets}, '$."' || ${plates.id} || '"')`;
  // A known version that isn't the resolved slicer's now (`slicedWithOther`).
  const versions = JSON.stringify(Object.fromEntries(slicers.map((s) => [s.id, s.slicerVersion])));
  const version = sql`json_extract(${versions}, '$."' || ${plateSlicer(toHub, fallback)} || '"')`;
  return sql<ProjectListItem["slicing"]>`case
  when not exists (select 1 from ${plates} where ${plates.projectId} = ${projectId}) then 'none'
  when exists (select 1 from ${plates} where ${plates.projectId} = ${projectId} and (
    ${plates.slicedAt} is null
    or ${plates.slicedProcessPresetId} is not ${platePreset}
    or coalesce(${plates.slicedIntegrationId}, ${fallback ?? null}) is not ${plateSlicer(toHub, fallback)}
    or (${plates.slicedSlicerVersion} is not null and ${plates.slicedSlicerVersion} is not ${version})
    or exists (select 1 from json_each(coalesce(${plates.slicedPresets}, '{}')) j
      where j.value is not (select s.${sql.identifier("sha256")} from ${slicerPresets} s
        where s.${sql.identifier("id")} = j.key and s.${sql.identifier("deleted")} = 0))
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
    hub: HubChannel,
    hubFiles: HubFiles,
    adapters: IntegrationAdapter[] = [],
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const row = (id: string) => {
      const r = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!r) throw new HttpError(404, "not_found", "Project not found");
      return r;
    };
    const get = (id: string) => out(row(id), listRoots(db));

    /** Moves a project folder into its root's trash (on a device: there); returns where it went. */
    const toTrash = (own: { fs: RootFs; rel: string }) =>
      own.fs.trash(
        own.rel,
        `${new Date().toISOString().replace(/[:.]/g, "-")}_${posix.basename(own.rel)}`,
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
        const root = listRoots(db).find((r) => r.id === p.rootId);
        const own =
          root && onDevice(root) && p.folder !== null
            ? { fs: rootFs(db, root), rel: p.folder }
            : await projectDir(db, p);
        if (!own)
          throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
        trashedTo = await toTrash(own);
      }
      unlink();
      forget(p.id);
      return trashedTo;
    }

    /**
     * Roots on a device that isn't connected, or outside its shared folders: their projects show
     * their last known data.
     */
    const away = (r: Root) =>
      onDevice(r) && (!hub.online(r.location) || scanner.unsharedOnDevice(r.id));
    const offlineRoots = () =>
      new Set(
        listRoots(db)
          .filter(away)
          .map((r) => r.id),
      );

    const detail = async (id: string, user: FastifyRequest["user"]): Promise<ProjectDetail> => {
      const stored = get(id);
      const owner = stored.ownerId
        ? (db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, stored.ownerId))
            .get() ?? null)
        : null;
      const p = { ...stored, owner, canEdit: projectAccessOf(db, user, id) === "edit" };
      const root = p.rootId ? listRoots(db).find((r) => r.id === p.rootId) : undefined;
      const galleryLeftOut: string[] = [];
      if (!root || p.folder === null)
        return { ...p, folderState: p.rootId ? "missing" : null, galleryLeftOut };
      if (onDevice(root)) {
        const state = away(root)
          ? "offline"
          : scanner.deviceFolder(root.id, p.folder)
            ? "ok"
            : "missing";
        // Only current picks: one dropped since the device's last scan isn't left out.
        const leftOut = new Set(scanner.deviceGalleryLeftOut(root.id, p.folder));
        return {
          ...p,
          folderState: state,
          galleryLeftOut: galleryImages(p).flatMap((f) => (leftOut.has(f.path) ? [f.path] : [])),
        };
      }
      const own = await projectDir(db, p);
      const there = own && (await stat(own.dir).catch(() => null))?.isDirectory();
      return { ...p, folderState: there ? "ok" : "missing", galleryLeftOut };
    };

    // Scan: POST starts a background scan (or queues another pass), GET reports progress.
    app.get("/scan", { schema: { response: { 200: projectScanStatusSchema } } }, async () =>
      scanner.status(),
    );
    app.post(
      "/scan",
      { schema: { response: { 202: projectScanStatusSchema } } },
      async (_, reply) => {
        // Devices index their own roots: ask each to send everything again.
        for (const location of new Set(
          listRoots(db)
            .filter(onDevice)
            .map((r) => r.location),
        ))
          if (hub.online(location)) hub.publish(location, { type: "roots.changed" });
        return reply.status(202).send(scanner.start());
      },
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
        const slicerOf = slicerResolver(db, adapters);
        const slicing = slicingOf(
          capableRows(db, adapters, "slice").map((r) => r.row),
          slicerOf.toHub,
          slicerOf()?.row.id,
          platePresets(db, adapters),
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
            archivedWhere(projects.archivedAt, req.query.archived),
            visibleProjects(req.user),
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
        const offline = offlineRoots();
        const items = page.items.map((p) => ({
          ...out(p, roots),
          lastPrintAt: last.get(p.id) ?? null,
          slicing: slicingById.get(p.id) ?? "none",
          offline: !!p.rootId && offline.has(p.rootId),
          canEdit: projectAccessOf(db, req.user, p.id) === "edit",
        }));
        return { ...page, items } as Page<ProjectListItem>;
      },
    );

    /** Every material used by a project, for the material filter. */
    app.get("/materials", { schema: { response: { 200: z.array(z.string()) } } }, async (req) => {
      const visible = visibleProjects(req.user);
      return db
        .all<{ value: string }>(
          sql`select distinct value from ${projects}, json_each(${projects.meta}, '$.materials') where ${projects.archivedAt} is null ${visible ? sql`and ${visible}` : sql``} order by value`,
        )
        .map((r) => r.value);
    });

    app.get(
      "/:id",
      { schema: { params, response: { 200: projectDetailSchema, ...notFound } } },
      async (req) => detail(req.params.id, req.user),
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
        const p = await detail(req.params.id, req.user);
        const { path, rootId, previous } = req.body;
        if (p.folderState === "ok" && !previous)
          throw new HttpError(409, "has_folder", "Project already has a folder");
        // Checked (or made) before the current folder is let go of.
        const editable = (root: Root) => assertRootEditable(db, req.user, root);
        const place = path
          ? await scanner.usableFolder(path)
          : await newProjectFolder(db, rootId, folderName(p.number, p.name), editable);
        if (path) editable(place.root);
        let trashedTo: string | undefined;
        if (p.folderState === "ok" && previous === "move") {
          const own = await projectDir(db, p);
          const to = await rootFs(db, place.root).local(place.rel);
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
        const point = (to: Partial<Pick<Row, "rootId" | "folder" | "ownerId">>) =>
          db.update(projects).set(to).where(eq(projects.id, p.id)).run();
        const linked = { rootId: place.root.id, folder: place.rel };
        // A device root's projects are its user's (ADR-0014).
        const deviceUser = onDevice(place.root) ? rootRule(db, place.root).deviceUserId : null;
        point(deviceUser ? { ...linked, ownerId: deviceUser } : linked);
        try {
          await scanner.refresh(linked);
        } catch (e) {
          point({ rootId: now.rootId, folder: now.folder, ownerId: now.ownerId });
          if (!path) await dropNewFolder(db, place);
          throw e;
        }
        return { ...(await detail(p.id, req.user)), trashedTo };
      },
    );

    // Every project with a folder, archived ones too: they also keep a root in use.
    app.get(
      "/folders",
      { schema: { response: { 200: z.array(projectFolderRowSchema) } } },
      async (req) => {
        const rows = db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(isNotNull(projects.rootId), isNotNull(projects.folder), visibleProjects(req.user)),
          )
          .orderBy(asc(projects.number))
          .all();
        return Promise.all(rows.map((r) => detail(r.id, req.user)));
      },
    );

    // Points projects at another root, same relative folder, and the project keeps what it knows.
    // Nothing on disk changes (the user moved the files) unless `move` takes the files along. One
    // that can't change is skipped and reported.
    // ponytail: one at a time inside the request, so a huge batch (or a copy to another volume) is
    // slow; a job if that matters.
    app.post(
      "/relink",
      {
        schema: {
          body: projectRelinkSchema,
          response: { 200: projectRelinkResultSchema, 400: apiErrorSchema, ...errors },
        },
      },
      async (req) => {
        const root = listRoots(db).find((r) => r.id === req.body.rootId);
        if (!root) throw new HttpError(404, "not_found", "Root not found");
        assertRootEditable(db, req.user, root);
        // A device root's projects are its user's (ADR-0014).
        const deviceUser = onDevice(root) ? rootRule(db, root).deviceUserId : null;
        const result: z.infer<typeof projectRelinkResultSchema> = { moved: [], skipped: [] };
        for (const id of new Set(req.body.ids)) {
          const skip = (
            code: (typeof result.skipped)[number]["code"],
            usedBy?: (typeof result.skipped)[number]["usedBy"],
          ) => void result.skipped.push({ id, code, usedBy });
          const p = db.select().from(projects).where(eq(projects.id, id)).get();
          const access = projectAccessOf(db, req.user, id);
          if (!p || access === "none") {
            skip("not_found");
            continue;
          }
          if (access !== "edit") {
            skip("forbidden");
            continue;
          }
          if (!p.rootId || p.folder === null) {
            skip("no_folder");
            continue;
          }
          if (p.rootId === root.id) {
            skip("same_root");
            continue;
          }
          const holder = db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.rootId, root.id), eq(projects.folder, p.folder)))
            .get();
          if (holder) {
            const seen = projectAccessOf(db, req.user, holder.id) !== "none";
            skip("folder_in_use", seen ? get(holder.id) : undefined);
            continue;
          }
          // A device's files can't be moved from here.
          if (req.body.move && (onDevice(root) || onDeviceRoot(db, p.rootId))) {
            skip("move_unavailable");
            continue;
          }
          const { folderState } = await detail(id, req.user);
          const point = (to: Partial<Row>) =>
            db.update(projects).set(to).where(eq(projects.id, id)).run();
          const restore = () =>
            point({
              rootId: p.rootId,
              ownerId: p.ownerId,
              unlinkedRootId: p.unlinkedRootId,
              unlinkedFolder: p.unlinkedFolder,
            });
          // A folder already gone has nothing to move: the project only changes root.
          const own = req.body.move ? await projectDir(db, p) : null;
          let wanted: string | null = null;
          let made = false;
          try {
            if (own) {
              const base = await rootFs(db, root).local("");
              if (!base) throw new HttpError(404, "path_not_found", "Root not found");
              wanted = join(base, ...p.folder.split("/"));
              // Into itself would lose or loop files.
              const inside = relative(own.dir, wanted);
              if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)))
                throw new HttpError(
                  400,
                  "invalid_folder",
                  "The new folder is inside the current one",
                );
              made = !(await stat(wanted).catch(() => null));
              await mkdir(wanted, { recursive: true });
            }
            scanner.claim({ root, rel: p.folder });
            point({
              rootId: root.id,
              ...(deviceUser && { ownerId: deviceUser }),
              // A folder still there would come back as a new project: scans skip it, as with
              // "keep". Files being moved count too: a scan may run during a long copy.
              ...(folderState !== "missing" && {
                unlinkedRootId: p.rootId,
                unlinkedFolder: p.folder,
              }),
            });
            if (own && wanted) {
              await moveContents(own.dir, wanted);
              point({ unlinkedRootId: null, unlinkedFolder: null });
            }
          } catch (e) {
            restore();
            if (made && wanted) await rmdir(wanted).catch(() => {});
            req.log.warn({ err: e, projectId: id }, "project relink failed");
            const known =
              e instanceof HttpError && (e.code === "folder_exists" || e.code === "invalid_folder");
            skip(known ? (e.code as "folder_exists" | "invalid_folder") : "move_failed");
            continue;
          }
          try {
            await scanner.refresh({ rootId: root.id, folder: p.folder });
          } catch (e) {
            // 404: the folder isn't at the new root (yet), so the project reads "missing".
            if (!(e instanceof HttpError && e.statusCode === 404)) {
              req.log.warn({ err: e, projectId: id }, "project relink failed");
              // Moved files stay moved, so the project stays with them: a later scan reads them.
              if (!own) {
                restore();
                skip("scan_failed");
                continue;
              }
            }
          }
          result.moved.push({ id, folderState: (await detail(id, req.user)).folderState });
        }
        // A new root is only watched and indexed after a pass.
        if (result.moved.length) scanner.start();
        req.log.info(
          { rootId: root.id, moved: result.moved.length, skipped: result.skipped.length },
          "projects relinked",
        );
        return result;
      },
    );

    // Whether the folder holds any file, so a switch can offer to move the content along.
    app.get(
      "/:id/folder/content",
      { schema: { params, response: { 200: z.object({ hasFiles: z.boolean() }), ...errors } } },
      async (req) => {
        const p = await detail(req.params.id, req.user);
        const own = p.folderState === "ok" && (await projectDir(db, p));
        return { hasFiles: !!own && (await hasFiles(own.dir)) };
      },
    );

    /** Whether a scan would find this folder again: files in it, or (on a device) its last index. */
    const holdsFiles = async (rootId: string | null, folder: string | null) => {
      if (!rootId || folder === null) return false;
      if (onDeviceRoot(db, rootId))
        return !!db
          .select({ folder: deviceRootFolders.folder })
          .from(deviceRootFolders)
          .where(and(eq(deviceRootFolders.rootId, rootId), eq(deviceRootFolders.folder, folder)))
          .get();
      const own = await projectDir(db, { rootId, folder });
      return !!own && (await hasFiles(own.dir));
    };

    // Deletes a project nothing points at. Its folder goes too, only when no file is left in it: a
    // folder with files in a root would be scanned back in as a project, and so would one it was
    // unlinked from and kept, which only its `unlinked*` columns keep out of the scan.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const p = row(req.params.id);
        assertFree(db, req.user, "projects", p.id);
        if (
          (await holdsFiles(p.rootId, p.folder)) ||
          (await holdsFiles(p.unlinkedRootId, p.unlinkedFolder))
        )
          throw new HttpError(409, "folder_has_files", "Its folder still has files");
        // Only a folder below a root is the app's to remove; one gone or led out of its root by a
        // link stays as it is.
        const own = (await projectDir(db, p))?.dir;
        deleteItem(db, "projects", p.id, { user: req.user, dataDir });
        if (own) await rm(own, { recursive: true, force: true });
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
        const p = await detail(req.params.id, req.user);
        if (!p.rootId) throw new HttpError(404, "no_folder", "Project has no folder");
        const trashedTo = await release(p, req.query.files);
        return { ...(await detail(p.id, req.user)), trashedTo };
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
        const editable = (root: Root) => assertRootEditable(db, req.user, root);
        // The creator's, unless the scan gave it its device's user (ADR-0014).
        const created = (made: Row | undefined) => {
          if (made && made.ownerId === null && req.user)
            db.update(projects).set({ ownerId: req.user.id }).where(eq(projects.id, made.id)).run();
          return reply.status(201).send(get(made?.id ?? ""));
        };
        if (createFolder) {
          const n = number ?? db.get<{ n: number }>(sql`select ${nextNumber(projects)} as n`).n;
          const place = await newProjectFolder(db, rootId, folderName(n, fields.name), editable);
          try {
            return created(await scanner.addFolder(place, { ...given, number: n }));
          } catch (e) {
            await dropNewFolder(db, place);
            throw e;
          }
        }
        if (folderPath) {
          const place = await scanner.usableFolder(folderPath);
          editable(place.root);
          return created(await scanner.addFolder(place, { ...given, number }));
        }
        return created(
          db
            .insert(projects)
            .values({
              ...given,
              number: number ?? nextNumber(projects),
              name: fields.name,
              editedFields: Object.keys(given) as Project["editedFields"],
            })
            .returning()
            .get(),
        );
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
          ownerId,
          archived,
          ...fields
        } = req.body;
        assertNumberFree(db, projects, "project", number, req.params.id);
        if (ownerId !== undefined) {
          if (req.user && !req.user.rights.admin)
            throw new HttpError(403, "forbidden", "Only admins change a project's owner");
          if (onDeviceRoot(db, current.rootId))
            throw new HttpError(409, "device_owner", "Its device's user owns a device project");
          if (
            ownerId &&
            !db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).get()
          )
            throw new HttpError(400, "invalid_reference", "Unknown user");
        }
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
          ownerId,
          archivedAt: archivedAtOf(archived),
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
          // A device's folder isn't here: its picks come with its scan, its folders are checked
          // against its listing.
          if (folder === null) throw new HttpError(404, "no_folder", "Project has no folder");
          const dir = (await projectDir(db, current))?.dir;
          if (!dir && !onDeviceRoot(db, current.rootId))
            throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
          const image = (rel: string) => {
            segments(rel);
            if (!meta.files.some((f) => f.path === rel && f.kind === "image"))
              throw new HttpError(404, "not_found", "File not found");
          };
          for (const rel of gallery?.images ?? []) image(rel);
          if (coverFile) image(coverFile);
          for (const rel of gallery?.folders ?? [])
            if (
              dir
                ? !(await projectPath(dir, rel, "existing")).isDir
                : rel !== "" && !meta.files.some((f) => f.path.startsWith(`${rel}/`))
            )
              throw new HttpError(400, "not_a_directory", "Not a folder");
        }
        if (gallery)
          set.gallery = {
            folders: [...new Set(gallery.folders)],
            images: [...new Set(gallery.images)],
          };
        if (coverFile !== undefined) set.coverFile = coverFile;
        db.transaction((tx) => {
          tx.update(projects)
            .set({ ...set, editedFields: [...touched] })
            .where(eq(projects.id, req.params.id))
            .run();
          if (archived) resolveItemAlerts(tx, alertTasks.project(req.params.id));
        });
        if (descriptionFile || previewFile === null || coverFile !== undefined)
          await scanner.refresh(current);
        // The device sends the folder again with the new picks (an offline one when it connects).
        const root = current.rootId && listRoots(db).find((r) => r.id === current.rootId);
        if ((coverFile !== undefined || gallery) && root && onDevice(root) && folder !== null) {
          scanner.deviceFolderStale(root.id, folder);
          if (hub.online(root.location)) hub.publish(root.location, { type: "roots.changed" });
        }
        return get(req.params.id);
      },
    );

    // Serves a file listed in meta.files (nothing else is reachable), or, with `entry`, a plate
    // preview inside that 3MF (a device folder's came with its scan: no pull, also offline).
    app.get("/:id/file", { schema: { params, querystring: fileQuery } }, async (req, reply) => {
      const p = get(req.params.id);
      const { path, entry } = req.query;
      const listed = p.meta.files.some((f) => f.path === path && f.kind !== "shortcut");
      const plate = p.meta.models
        .find((m) => m.file === path)
        ?.plates.some((pl) => pl.thumbnail === entry);
      if (listed && entry && plate && p.folder !== null && onDeviceRoot(db, p.rootId)) {
        const png = await readFile(
          scanner.devicePreview(p.rootId ?? "", p.folder, path, entry),
        ).catch(() => null);
        if (!png) throw new HttpError(404, "not_found", "File not found");
        return reply.type("image/png").send(png);
      }
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

    /**
     * The user's online devices, with their slicers and whether they sync the project; none but
     * for a hub root's project (only those sync).
     */
    const openDevices = (req: FastifyRequest, p: Project) => {
      const root = listRoots(db).find((r) => r.id === p.rootId);
      if (!req.user || root?.location !== ROOT_HUB || !p.folder) return [];
      const selected = new Set(
        db
          .select({ id: deviceProjects.deviceId })
          .from(deviceProjects)
          .where(eq(deviceProjects.projectId, p.id))
          .all()
          .map((r) => r.id),
      );
      return db
        .select({
          id: devices.id,
          name: devices.name,
          slicers: devices.slicers,
          syncMode: devices.syncMode,
        })
        .from(devices)
        .where(eq(devices.userId, req.user.id))
        .orderBy(asc(devices.name))
        .all()
        .filter((d) => hub.online(d.id))
        .map((d) => ({
          id: d.id,
          name: d.name,
          port: hub.port(d.id),
          slicers: d.slicers.map((s) => ({ id: s.id, default: s.default })),
          synced: d.syncMode === "all" || selected.has(d.id),
        }));
    };
    app.get(
      "/:id/devices",
      { schema: { params, response: { 200: openTargetsSchema, ...notFound } } },
      async (req) => ({ local: fromThisPc(req), devices: openDevices(req, get(req.params.id)) }),
    );

    /** The project's hub root, when its folder is in one (only hub-root files are checked out). */
    const hubRootOf = (p: Project) =>
      p.folder
        ? listRoots(db).find((r) => r.id === p.rootId && r.location === ROOT_HUB)
        : undefined;
    app.get(
      "/:id/locks",
      { schema: { params, response: { 200: z.array(hubFileLockSchema), ...notFound } } },
      async (req) => {
        const p = get(req.params.id);
        const root = hubRootOf(p);
        return root && p.folder ? hubFiles.locksIn(root.id, p.folder, req.user?.id) : [];
      },
    );
    app.get(
      "/:id/versions",
      {
        schema: {
          params,
          querystring: hubFileVersionQuerySchema.pick({ file: true }),
          response: { 200: z.array(hubFileVersionSchema), ...notFound },
        },
      },
      async (req) => {
        const p = get(req.params.id);
        const root = hubRootOf(p);
        return root ? hubFiles.versionsOf(root.id, `${p.folder}/${req.query.file}`) : [];
      },
    );
    app.get(
      "/:id/versions/download",
      {
        schema: {
          params,
          querystring: hubFileVersionQuerySchema.required({ version: true }),
        },
      },
      async (req, reply) => {
        const p = get(req.params.id);
        const root = hubRootOf(p);
        const { file, version } = req.query;
        const stream = root && hubFiles.versionStream(root.id, `${p.folder}/${file}`, version);
        if (!stream) throw new HttpError(404, "not_found", "Version not found");
        const ext = extname(file);
        const name = `${basename(file, ext)} (v${version})${ext}`;
        return reply
          .type("application/octet-stream")
          .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
          .send(stream);
      },
    );
    // Done editing (the lock's user) or force-unlock (an admin).
    app.delete(
      "/:id/locks",
      {
        schema: {
          params,
          querystring: hubFileLockQuerySchema,
          response: { 204: z.null(), 400: apiErrorSchema, ...errors },
        },
      },
      async (req, reply) => {
        const p = get(req.params.id);
        const root = hubRootOf(p);
        if (!root) throw new HttpError(404, "not_found", "File not found");
        const me = req.user;
        await hubFiles.unlock(
          root,
          `${p.folder}/${req.query.file}`,
          (_, userId) => !me || me.rights.admin || me.id === userId,
        );
        return reply.status(204).send(null);
      },
    );

    // Launches a local program, so everything is checked here: the project folder must be inside a
    // configured root, and a file must be one the scanner listed (nothing the client invents). On a
    // device, the connector checks the path against its sync folder again.
    app.post(
      "/:id/open",
      {
        schema: {
          params,
          body: projectOpenSchema,
          response: {
            200: z.object({
              ok: z.literal(true),
              /** Another device has the file checked out: it opened read-only. */
              lockedBy: z.object({ user: z.string(), device: z.string() }).optional(),
            }),
            ...errors,
            504: apiErrorSchema,
          },
        },
      },
      async (req) => {
        const p = get(req.params.id);
        const { target, file, integrationId, slicer } = req.body;
        const listed = !!file && p.meta.files.some((f) => f.path === file && f.kind === "model");
        if (target === "device") {
          const device = openDevices(req, p).find((d) => d.id === req.body.deviceId);
          if (!device?.slicers.length)
            throw new HttpError(409, "device_offline", "The device can't open files now");
          if (slicer && !device.slicers.some((s) => s.id === slicer))
            throw new HttpError(409, "device_no_slicer", "No such slicer on the device");
          if (!listed || !p.rootId || !p.folder)
            throw new HttpError(403, "not_allowed", "File is not part of this project");
          // Selected from now on, so a device that syncs only selected projects gets it.
          db.insert(deviceProjects)
            .values({ deviceId: device.id, projectId: p.id })
            .onConflictDoNothing()
            .run();
          const rootId = p.rootId;
          const path = `${p.folder}/${file}`;
          const root = hubRootOf(p);
          // Checked out to the device before it opens; a failed open lets go again.
          const lockedBy = root ? await hubFiles.lock(root, path, device.id) : null;
          try {
            await hub.ask(
              device.id,
              (requestId) => ({ type: "open", requestId, rootId, path, slicer }),
              z.null(),
              {
                ms: DEVICE_OPEN_MS,
                error: (e) =>
                  e.code === "no_slicer"
                    ? new HttpError(409, "device_no_slicer", "No slicer found on the device")
                    : new HttpError(500, "launch_failed", "Could not start the program"),
              },
            );
          } catch (e) {
            if (root && !lockedBy) await hubFiles.unlock(root, path, (d) => d === device.id);
            throw e;
          }
          return { ok: true as const, ...(lockedBy && { lockedBy }) };
        }
        // The project's synced copy on the device. Not synced there: the user is told how.
        if (target === "folder" && req.body.deviceId) {
          const device = openDevices(req, p).find((d) => d.id === req.body.deviceId);
          if (!device) throw new HttpError(409, "device_offline", "The device is offline");
          if (!device.synced || !p.rootId || !p.folder)
            throw new HttpError(409, "device_not_synced", "The device doesn't sync this project");
          const rootId = p.rootId;
          const path = p.folder;
          await hub.ask(
            device.id,
            (requestId) => ({ type: "open.folder", requestId, rootId, path }),
            z.null(),
            {
              error: (e) =>
                e.code === "ENOENT"
                  ? new HttpError(
                      409,
                      "device_folder_missing",
                      "The folder isn't on the device yet",
                    )
                  : new HttpError(500, "launch_failed", "Could not start the program"),
            },
          );
          return { ok: true as const };
        }
        // The server's file manager and slicer open on the server's screen: never for someone at
        // another computer.
        if (!fromThisPc(req))
          throw new HttpError(403, "not_local", "This opens only on the server's machine");
        const prefs = readPreferences(db);
        const dir = (await projectDir(db, p))?.dir;
        if (!dir)
          throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
        try {
          if (target === "folder") return await openFolder(dir).then(() => ({ ok: true as const }));
          const abs = listed ? await projectFile(db, p, file) : null;
          if (!abs) throw new HttpError(403, "not_allowed", "File is not part of this project");
          // The picked slicer, else the default one, else the first.
          const slicers = capableRows(db, adapters, "openInSlicer");
          const pick = integrationId ?? prefs.defaultSlicerId;
          const chosen =
            slicers.find((s) => s.row.id === pick) ?? (integrationId ? undefined : slicers[0]);
          const launcher = slicerLauncher(chosen?.row.slicerPath ?? "");
          if (!launcher.canOpen(abs)) throw new HttpError(409, "no_slicer", "No slicer configured");
          await launcher.open(abs);
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
