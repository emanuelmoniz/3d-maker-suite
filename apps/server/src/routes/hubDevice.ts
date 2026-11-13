import { Readable } from "node:stream";
import {
  apiErrorSchema,
  catalogInstallStatusSchema,
  DEVICE_FOLDER_MAX_MB_LIMIT,
  desktopSlicerSchema,
  deviceFolderQuerySchema,
  deviceFolderSchema,
  deviceIndexResultSchema,
  deviceIndexSchema,
  deviceReplySchema,
  deviceRootSchema,
  deviceSlicerInstallSchema,
  deviceSlicerSchema,
  deviceSyncModeSchema,
  deviceSyncStateSchema,
  emptyPresetLibrary,
  hubChangesQuerySchema,
  hubChangesSchema,
  hubFileQuerySchema,
  hubSyncRootsSchema,
  hubUploadResultSchema,
  type IntegrationAdapter,
  presetInstallItemSchema,
  presetInstallStatusSchema,
  presetRemovalResultSchema,
  presetRemovalsSchema,
  presetRemovedSchema,
  presetShareStatusSchema,
  presetSkippedSchema,
  presetUploadResultSchema,
  presetUploadSchema,
  ROOT_HUB,
  type SlicerPresetKind,
  sharedFolderSchema,
  sliceFileName,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { parsePreset, presetName } from "@3d-maker-suite/host";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { presetLibrary } from "../integrations/capabilities.ts";
import type { DeviceCatalog } from "../integrations/deviceCatalog.ts";
import {
  namedPreset,
  presetInstallList,
  presetRemovedOn,
  presetSkipped,
  presetsRemoved,
  uploadPreset,
} from "../integrations/presetLibrary.ts";
import type { WorkerSlicers } from "../integrations/workerSlicer.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import type { DeviceFiles } from "../projects/deviceFiles.ts";
import type { HubFiles } from "../projects/hubFiles.ts";
import { pickLevels } from "../projects/picks.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { devices, projects, roots, slicerPresets } = schema;
const rootParams = z.object({ rootId: z.uuid() });
const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  413: apiErrorSchema,
};
/** The manual zip's limit; a Bambu `system/` zips to ~7 MB (ADR-0019). */
const MAX_CATALOG_ZIP = 100 * 1024 ** 2;
const sha256Header = z.object({ "x-file-sha256": z.string().regex(/^[0-9a-f]{64}$/) });

/** The paired device making the request; the role check is skipped for these routes (lib/auth.ts). */
const deviceOf = (req: FastifyRequest) => {
  if (!req.deviceId) throw new HttpError(403, "forbidden", "Only a paired device can call this");
  return req.deviceId;
};

/**
 * What a connector sends the hub about its device roots (ADR-0014): the index of each root, the
 * scan of each changed project folder, and answers to the hub's requests (a file it asked for as
 * raw bytes). A device sees only the roots on itself; any other root is 404. `/sync/*` is the sync of
 * the hub roots: their change feed, download, upload and delete, as the device's user may.
 */
export const hubDeviceRoutes =
  (
    db: Db,
    channel: HubChannel,
    scanner: ProjectScanner,
    files: DeviceFiles,
    sync: HubFiles,
    adapters: IntegrationAdapter[],
    workers: WorkerSlicers,
    catalog: DeviceCatalog,
    dataDir: string,
    /** A device reported its sync state: the mass delete alert may open or close. */
    onSyncState: () => void = () => {},
    /** A device's preset changed the library: it may reach the catalog. */
    onPresetSaved: () => void = () => {},
  ): FastifyPluginAsyncZod =>
  async (app) => {
    // Raw stream, read by the file route itself (Fastify's bodyLimit doesn't apply to it).
    app.addContentTypeParser("application/octet-stream", (_req, payload, done) =>
      done(null, payload),
    );
    app.addHook("onRequest", async () => {
      if (!readPreferences(db).hubEnabled) throw new HttpError(404, "hub_off", "The hub is off");
    });
    const mine = (req: FastifyRequest, rootId: string) => {
      const root = db
        .select()
        .from(roots)
        .where(and(eq(roots.id, rootId), eq(roots.location, deviceOf(req))))
        .get();
      if (!root) throw new HttpError(404, "not_found", "Root not found");
      return root;
    };
    const hubRoot = (rootId: string) => {
      const root = db
        .select()
        .from(roots)
        .where(and(eq(roots.id, rootId), eq(roots.location, ROOT_HUB)))
        .get();
      if (!root) throw new HttpError(404, "not_found", "Root not found");
      return root;
    };

    app.get(
      "/roots",
      { schema: { response: { 200: z.array(deviceRootSchema), ...errors } } },
      async (req) => {
        const { projectScanMaxFiles: maxFiles, deviceFolderMaxMb: folderMaxMb } =
          readPreferences(db);
        return db
          .select()
          .from(roots)
          .where(eq(roots.location, deviceOf(req)))
          .all()
          .map(({ id, path, projectDepth, filesDepth }) => {
            const picks = db
              .select({
                folder: projects.folder,
                coverFile: projects.coverFile,
                gallery: projects.gallery,
              })
              .from(projects)
              .where(and(eq(projects.rootId, id), isNotNull(projects.folder)))
              .all();
            return {
              id,
              path,
              projectDepth,
              filesDepth,
              maxFiles,
              folderMaxMb,
              covers: Object.fromEntries(
                picks.flatMap((p) =>
                  p.folder !== null && p.coverFile ? [[p.folder, p.coverFile]] : [],
                ),
              ),
              galleries: Object.fromEntries(
                picks.flatMap((p) =>
                  p.folder !== null && (p.gallery.folders.length || p.gallery.images.length)
                    ? [[p.folder, p.gallery]]
                    : [],
                ),
              ),
              projects:
                db.select({ n: count() }).from(projects).where(eq(projects.rootId, id)).get()?.n ??
                0,
            };
          });
      },
    );

    app.put(
      "/roots/:rootId/index",
      {
        schema: {
          params: rootParams,
          body: deviceIndexSchema,
          response: { 200: deviceIndexResultSchema, ...errors },
        },
      },
      async (req) => ({ want: await scanner.deviceIndex(mine(req, req.params.rootId), req.body) }),
    );

    app.put(
      "/roots/:rootId/folders",
      {
        // The most `deviceFolderMaxMb` can be; the setting's own value is checked below.
        bodyLimit: DEVICE_FOLDER_MAX_MB_LIMIT * 1024 * 1024,
        onRequest: async (req) => {
          const max = readPreferences(db).deviceFolderMaxMb;
          if (Number(req.headers["content-length"]) > max * 1024 * 1024)
            throw new HttpError(413, "folder_too_large", `The folder is larger than ${max} MB`);
        },
        schema: {
          params: rootParams,
          body: deviceFolderSchema,
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        await scanner.deviceFolderScanned(mine(req, req.params.rootId), req.body);
        return reply.status(204).send(null);
      },
    );

    app.delete(
      "/roots/:rootId/folders",
      {
        schema: {
          params: rootParams,
          querystring: deviceFolderQuerySchema,
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        await scanner.deviceFolderGone(mine(req, req.params.rootId), req.query.rel);
        return reply.status(204).send(null);
      },
    );

    app.post(
      "/replies/:requestId",
      {
        bodyLimit: 16 * 1024 * 1024,
        schema: {
          params: z.object({ requestId: z.uuid() }),
          body: deviceReplySchema,
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        if (!channel.answer(deviceOf(req), req.params.requestId, req.body))
          throw new HttpError(404, "not_found", "Nothing waits for this answer");
        return reply.status(204).send(null);
      },
    );

    // A file the hub asked for (`fs.upload`), with the sha256 and mtime it has on the device.
    app.put(
      "/files/:requestId",
      {
        schema: {
          params: z.object({ requestId: z.uuid() }),
          headers: sha256Header.extend({
            "x-file-mtime": z.coerce.number().nonnegative().optional(),
          }),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        await files.receive(
          deviceOf(req),
          req.params.requestId,
          // An empty file has no body to parse.
          (req.body as Readable | undefined) ?? Readable.from([]),
          req.headers["x-file-sha256"],
          req.headers["x-file-mtime"],
        );
        return reply.status(204).send(null);
      },
    );

    // The bytes of a web upload the hub asked this device to write (`fs.write`).
    app.get(
      "/files/:requestId",
      { schema: { params: z.object({ requestId: z.uuid() }) } },
      async (req, reply) =>
        reply
          .type("application/octet-stream")
          .send(files.send(deviceOf(req), req.params.requestId)),
    );

    // The device's picks (ADR-0021) decide what it gets: a file no pick covers is as unknown as one
    // the user may not see (404), and only an Edit pick takes changes. 403 keeps the connector's
    // copy on the machine (download-only), also for a new file outside its picks.
    const picked = (deviceId: string, rootId: string, path: string, edit: boolean) => {
      const level = pickLevels(db, deviceId).level(rootId, path);
      if (edit && level !== "edit")
        throw new HttpError(403, "forbidden", "This file is download-only on this machine");
      if (!level) throw new HttpError(404, "not_found", "File not found");
    };

    // What to look for, from the adapters with a desktop slicer; then what it found.
    const desktopSlicers = () =>
      adapters.flatMap((a) =>
        a.desktop ? [{ id: a.id, library: presetLibrary(a), ...a.desktop }] : [],
      );
    app.get(
      "/slicers",
      { schema: { response: { 200: z.array(desktopSlicerSchema), ...errors } } },
      async (req) => {
        deviceOf(req);
        return desktopSlicers();
      },
    );

    // Send presets (ADR-0017's Share): only with its switch on for that slicer (ADR-0020), and only
    // into a slicer's library, whose id names a folder.
    const sharing = (req: FastifyRequest, library: string) => {
      const device = db
        .select()
        .from(devices)
        .where(eq(devices.id, deviceOf(req)))
        .get();
      if (!device?.presetLibraries[library]?.user.share)
        throw new HttpError(403, "not_sharing", "Send presets is off for this slicer");
      if (!desktopSlicers().some((s) => s.library === library))
        throw new HttpError(404, "not_found", "No such preset library");
      return device;
    };
    // A kind's Share line off in Presets settings → Sources: the hub takes none of it, so an older
    // connector needs no change.
    const sharesKind = (
      device: { presetLibraries: typeof devices.$inferSelect.presetLibraries },
      library: string,
      kind: SlicerPresetKind,
    ) => device.presetLibraries[library]?.user.shareKinds.includes(kind) ?? false;
    app.put(
      "/presets",
      {
        bodyLimit: 16 * 1024 * 1024,
        schema: {
          body: presetUploadSchema,
          response: { 200: presetUploadResultSchema, ...errors },
        },
      },
      async (req) => {
        const device = sharing(req, req.body.library);
        // ponytail: answered as stored, so the connector doesn't retry it; a file saved while its
        // kind was off reaches the hub on its next save, not when the line goes on again.
        if (!sharesKind(device, req.body.library, req.body.kind)) {
          const { library, kind, text } = req.body;
          const name = presetName(parsePreset(text), req.body.name);
          const old = namedPreset(db, { library, kind, name });
          return { result: "same" as const, name, version: old?.version ?? 0 };
        }
        const res = uploadPreset(db, dataDir, req.body, device.id, {
          user: req.user?.displayName,
          device: device.name,
          userId: device.userId,
        });
        if (res.result === "saved" || res.result === "conflict") {
          const { library } = req.body;
          const libs = device.presetLibraries;
          db.update(devices)
            .set({
              presetLibraries: {
                ...libs,
                // `sharing` checked its switch is there.
                [library]: {
                  ...emptyPresetLibrary(),
                  ...libs[library],
                  sentAt: new Date().toISOString(),
                },
              },
            })
            .where(eq(devices.id, device.id))
            .run();
          onPresetSaved();
        }
        return res;
      },
    );
    // A connector before 5.4.0: its removal is only shown (ADR-0019's version gate).
    app.post(
      "/presets/removed",
      { schema: { body: presetRemovedSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const device = sharing(req, req.body.library);
        if (sharesKind(device, req.body.library, req.body.kind))
          presetRemovedOn(db, req.body, device.id);
        return reply.status(204).send(null);
      },
    );
    app.post(
      "/presets/removals",
      {
        bodyLimit: 4 * 1024 * 1024,
        schema: {
          body: presetRemovalsSchema,
          response: { 200: presetRemovalResultSchema, ...errors },
        },
      },
      async (req) => {
        const device = sharing(req, req.body.library);
        const { library, removed } = req.body;
        const on = removed.filter((r) => sharesKind(device, library, r.kind));
        const off = removed
          .filter((r) => !sharesKind(device, library, r.kind))
          .map((r) => ({ ...r, result: "unknown" as const }));
        const res = [
          ...(on.length
            ? presetsRemoved(db, dataDir, { ...req.body, removed: on }, device, {
                user: req.user?.displayName,
                device: device.name,
              })
            : []),
          ...off,
        ];
        // A held one's alert opens with the check after each change (app.ts).
        if (res.some((r) => r.result === "deleted")) onPresetSaved();
        return res;
      },
    );
    app.put(
      "/presets/share",
      { schema: { body: presetShareStatusSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        db.update(devices)
          .set({
            presetAccounts: Object.fromEntries(req.body.map((s) => [s.library, s.account])),
          })
          .where(eq(devices.id, deviceOf(req)))
          .run();
        return reply.status(204).send(null);
      },
    );

    // Install (ADR-0017): only the libraries its switch is on for (ADR-0020).
    const installing = (req: FastifyRequest) => {
      const device = db
        .select()
        .from(devices)
        .where(eq(devices.id, deviceOf(req)))
        .get();
      const on = Object.entries(device?.presetLibraries ?? {}).filter(([, s]) => s.user.receive);
      const libraries = new Set(on.map(([lib]) => lib));
      if (!device || !libraries.size)
        throw new HttpError(403, "not_installing", "Install is off for this device");
      // Every kind (ADR-0023).
      const receives = (p: { library: string }) => libraries.has(p.library);
      return { ...device, libraries, receives };
    };
    const installList = (device: { id: string; libraries: Set<string> }, deleted: boolean) =>
      presetInstallList(db, device.libraries, device.id, deleted);
    app.get(
      "/presets",
      { schema: { response: { 200: z.array(presetInstallItemSchema), ...errors } } },
      async (req) => installList(installing(req), false),
    );
    // Deleted on the hub (ADR-0019): a device removes its unedited copy.
    app.get(
      "/presets/deleted",
      { schema: { response: { 200: z.array(presetInstallItemSchema), ...errors } } },
      async (req) => installList(installing(req), true),
    );
    app.get(
      "/presets/:id",
      { schema: { params: z.object({ id: z.uuid() }) } },
      async (req, reply) => {
        const { receives } = installing(req);
        const row = db
          .select()
          .from(slicerPresets)
          .where(eq(slicerPresets.id, req.params.id))
          .get();
        if (!row || row.deleted || !receives(row))
          throw new HttpError(404, "not_found", "Preset not found");
        return reply.type("application/json").send(row.json);
      },
    );
    app.post(
      "/presets/skipped",
      { schema: { body: presetSkippedSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        presetSkipped(db, req.body, installing(req));
        return reply.status(204).send(null);
      },
    );
    app.put(
      "/presets/install",
      { schema: { body: presetInstallStatusSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const { id, libraries } = installing(req);
        db.update(devices)
          .set({ presetInstall: req.body.filter((s) => libraries.has(s.library)) })
          .where(eq(devices.id, id))
          .run();
        return reply.status(204).send(null);
      },
    );
    app.put(
      "/slicers",
      {
        schema: {
          body: z.array(deviceSlicerSchema).max(20),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        db.update(devices)
          .set({ slicers: req.body })
          .where(eq(devices.id, deviceOf(req)))
          .run();
        return reply.status(204).send(null);
      },
    );
    // Its own shared folders, sent on each connect (ADR-0021): kept only while the hub has none, so
    // the connector's list arrives once and the hub's wins after. The answer is the hub's list. A
    // machine that shares a folder has Share on (it was guessed from its roots before, 0112); a new
    // one keeps its default.
    app.put(
      "/folders",
      {
        schema: {
          body: z.array(sharedFolderSchema).max(200),
          response: { 200: z.array(sharedFolderSchema), ...errors },
        },
      },
      async (req) => {
        const id = deviceOf(req);
        db.update(devices)
          .set({ sharedFolders: req.body, ...(req.body.length > 0 && { shareProjects: true }) })
          .where(and(eq(devices.id, id), isNull(devices.sharedFolders)))
          .run();
        return (
          db.select({ f: devices.sharedFolders }).from(devices).where(eq(devices.id, id)).get()
            ?.f ?? []
        );
      },
    );

    // The catalog source's `system/`, zipped (ADR-0020), when its fingerprint changed.
    app.put(
      "/catalog/:library",
      {
        schema: {
          params: z.object({ library: z.string().max(100) }),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of (req.body as Readable | undefined) ?? []) {
          size += (chunk as Buffer).length;
          if (size > MAX_CATALOG_ZIP)
            throw new HttpError(413, "zip_too_large", "The zip is larger than 100 MB");
          chunks.push(chunk as Buffer);
        }
        await catalog.receive(deviceOf(req), req.params.library, Buffer.concat(chunks));
        return reply.status(204).send(null);
      },
    );
    // Receive catalog (ADR-0021): the hub's copy of a library's `system/`, zipped.
    app.get(
      "/catalog/:library/system",
      { schema: { params: z.object({ library: z.string().max(100) }) } },
      async (req, reply) =>
        reply
          .type("application/zip")
          .send(await catalog.zipCopy(deviceOf(req), req.params.library)),
    );
    app.put(
      "/catalog-install",
      { schema: { body: catalogInstallStatusSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const id = deviceOf(req);
        const libraries = await catalog.installsOf(id);
        db.update(devices)
          .set({ catalogInstall: req.body.filter((s) => s.library in libraries) })
          .where(eq(devices.id, id))
          .run();
        return reply.status(204).send(null);
      },
    );

    // A worker's managed slicer install, as it goes (ADR-0014).
    app.put(
      "/slicers/install",
      { schema: { body: deviceSlicerInstallSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        workers.report(deviceOf(req), req.body);
        return reply.status(204).send(null);
      },
    );
    // The managed slicers to keep here; the connector deletes the others' folders.
    app.get(
      "/slicers/managed",
      { schema: { response: { 200: z.array(z.uuid()), ...errors } } },
      async (req) => workers.managedOn(deviceOf(req)),
    );

    // A slice on this worker (ADR-0014): it pulls the 3MF, then sends each file its run wrote.
    const sliceParams = z.object({ requestId: z.uuid() });
    app.get("/slices/:requestId/file", { schema: { params: sliceParams } }, async (req, reply) =>
      reply
        .type("application/octet-stream")
        .send(workers.sliceFile(deviceOf(req), req.params.requestId)),
    );
    app.put(
      "/slices/:requestId/files/:name",
      {
        schema: {
          params: sliceParams.extend({ name: sliceFileName }),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        await workers.sliceOutput(
          deviceOf(req),
          req.params.requestId,
          req.params.name,
          // An empty file has no body to parse.
          (req.body as Readable | undefined) ?? Readable.from([]),
        );
        return reply.status(204).send(null);
      },
    );

    // A connector older than 5.5.0 has this switch on its page. Picks replaced the modes
    // (ADR-0021): Projects settings → Sources sets what it receives, so this changes nothing.
    app.put(
      "/sync/mode",
      {
        schema: {
          body: z.object({ mode: deviceSyncModeSchema }),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        deviceOf(req);
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/sync/roots",
      { schema: { response: { 200: hubSyncRootsSchema, ...errors } } },
      async (req) => {
        const picks = pickLevels(db, deviceOf(req));
        return {
          // What connectors older than 5.5.0 read: the hub filters the feed either way.
          mode: "selected" as const,
          roots: db
            .select({ id: roots.id, name: roots.name })
            .from(roots)
            .where(eq(roots.location, ROOT_HUB))
            .orderBy(asc(roots.position))
            .all()
            .map((r) => ({ ...r, picked: picks.roots.has(r.id) })),
          deleteGuard: readPreferences(db).hubDeleteGuard,
          // What connectors older than 5.6.0 read: locks are gone.
          locks: "off" as const,
        };
      },
    );

    app.put(
      "/sync/state",
      { schema: { body: deviceSyncStateSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        db.update(devices)
          .set({ syncState: { ...req.body, reportedAt: new Date().toISOString() } })
          .where(eq(devices.id, deviceOf(req)))
          .run();
        onSyncState();
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/sync/changes",
      {
        schema: {
          querystring: hubChangesQuerySchema,
          response: { 200: hubChangesSchema, ...errors },
        },
      },
      async (req) => {
        const picks = pickLevels(db, deviceOf(req));
        return sync.changes(req.user, req.query.since, req.query.limit, picks);
      },
    );

    // The bytes, with the sha256 and version they are; the connector checks the hash.
    app.get(
      "/sync/roots/:rootId/file",
      { schema: { params: rootParams, querystring: hubFileQuerySchema } },
      async (req, reply) => {
        picked(deviceOf(req), req.params.rootId, req.query.path, false);
        const f = await sync.download(req.user, hubRoot(req.params.rootId), req.query.path);
        return reply
          .header("x-file-sha256", f.sha256)
          .header("x-file-version", f.version)
          .type("application/octet-stream")
          .send(f.stream);
      },
    );

    // `base`: the version the device's copy started from; the rules are in `HubFiles.upload`.
    app.put(
      "/sync/roots/:rootId/file",
      {
        schema: {
          params: rootParams,
          querystring: hubFileQuerySchema,
          headers: sha256Header,
          response: { 200: hubUploadResultSchema, ...errors },
        },
      },
      async (req) => {
        const id = deviceOf(req);
        picked(id, req.params.rootId, req.query.path, true);
        return sync.upload(
          req.user,
          id,
          hubRoot(req.params.rootId),
          req.query.path,
          req.query.base ?? 0,
          req.headers["x-file-sha256"],
          // An empty file has no body to parse.
          (req.body as Readable | undefined) ?? Readable.from([]),
        );
      },
    );

    // Into the root's trash; 409 `file_changed` when the hub's copy isn't `base` any more.
    app.delete(
      "/sync/roots/:rootId/file",
      {
        schema: {
          params: rootParams,
          querystring: hubFileQuerySchema,
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        const id = deviceOf(req);
        const root = hubRoot(req.params.rootId);
        picked(id, root.id, req.query.path, true);
        await sync.trash(req.user, root, req.query.path, req.query.base ?? 0);
        return reply.status(204).send(null);
      },
    );
  };
