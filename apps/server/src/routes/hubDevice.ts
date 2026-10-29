import { Readable } from "node:stream";
import {
  apiErrorSchema,
  DEVICE_FOLDER_MAX_MB_LIMIT,
  desktopSlicerSchema,
  deviceFolderQuerySchema,
  deviceFolderSchema,
  deviceIndexResultSchema,
  deviceIndexSchema,
  deviceReplySchema,
  deviceRootSchema,
  deviceSlicerSchema,
  deviceSyncModeSchema,
  deviceSyncStateSchema,
  hubChangesQuerySchema,
  hubChangesSchema,
  hubFileQuerySchema,
  hubSyncRootsSchema,
  hubUploadResultSchema,
  type IntegrationAdapter,
  ROOT_HUB,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import type { DeviceFiles } from "../projects/deviceFiles.ts";
import type { HubFiles } from "../projects/hubFiles.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { deviceProjects, devices, projects, roots } = schema;
const rootParams = z.object({ rootId: z.uuid() });
const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  413: apiErrorSchema,
};
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
    /** A device reported its sync state: the mass delete alert may open or close. */
    onSyncState: () => void = () => {},
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

    // Every hub root; the change feed leaves out the files the user may not see.
    const modeOf = (deviceId: string) =>
      db.select({ m: devices.syncMode }).from(devices).where(eq(devices.id, deviceId)).get()?.m ??
      "all";

    // What to look for, from the adapters that open files in a slicer; then what it found.
    app.get(
      "/slicers",
      { schema: { response: { 200: z.array(desktopSlicerSchema), ...errors } } },
      async (req) => {
        deviceOf(req);
        return adapters.flatMap((a) =>
          a.desktop && a.capabilities.includes("openInSlicer") ? [{ id: a.id, ...a.desktop }] : [],
        );
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

    // The status page's switch; the connector syncs again from scratch, as after Hub management's.
    app.put(
      "/sync/mode",
      {
        schema: {
          body: z.object({ mode: deviceSyncModeSchema }),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        const id = deviceOf(req);
        db.update(devices).set({ syncMode: req.body.mode }).where(eq(devices.id, id)).run();
        channel.publish(id, { type: "roots.changed" });
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/sync/roots",
      { schema: { response: { 200: hubSyncRootsSchema, ...errors } } },
      async (req) => {
        return {
          mode: modeOf(deviceOf(req)),
          roots: db
            .select({ id: roots.id, name: roots.name })
            .from(roots)
            .where(eq(roots.location, ROOT_HUB))
            .orderBy(asc(roots.position))
            .all(),
          deleteGuard: readPreferences(db).hubDeleteGuard,
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
        const id = deviceOf(req);
        const only =
          modeOf(id) === "selected"
            ? new Set(
                db
                  .select({ id: deviceProjects.projectId })
                  .from(deviceProjects)
                  .where(eq(deviceProjects.deviceId, id))
                  .all()
                  .map((r) => r.id),
              )
            : undefined;
        return sync.changes(req.user, req.query.since, req.query.limit, only);
      },
    );

    // The bytes, with the sha256 and version they are; the connector checks the hash.
    app.get(
      "/sync/roots/:rootId/file",
      { schema: { params: rootParams, querystring: hubFileQuerySchema } },
      async (req, reply) => {
        deviceOf(req);
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
      async (req) =>
        sync.upload(
          req.user,
          deviceOf(req),
          hubRoot(req.params.rootId),
          req.query.path,
          req.query.base ?? 0,
          req.headers["x-file-sha256"],
          // An empty file has no body to parse.
          (req.body as Readable | undefined) ?? Readable.from([]),
        ),
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
        deviceOf(req);
        await sync.trash(req.user, hubRoot(req.params.rootId), req.query.path, req.query.base ?? 0);
        return reply.status(204).send(null);
      },
    );
  };
