import { Readable } from "node:stream";
import {
  apiErrorSchema,
  DEVICE_FOLDER_MAX_MB_LIMIT,
  deviceFolderQuerySchema,
  deviceFolderSchema,
  deviceIndexResultSchema,
  deviceIndexSchema,
  deviceReplySchema,
  deviceRootSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import type { DeviceFiles } from "../projects/deviceFiles.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { projects, roots } = schema;
const rootParams = z.object({ rootId: z.uuid() });
const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  413: apiErrorSchema,
};

/** The paired device making the request; the role check is skipped for these routes (lib/auth.ts). */
const deviceOf = (req: FastifyRequest) => {
  if (!req.deviceId) throw new HttpError(403, "forbidden", "Only a paired device can call this");
  return req.deviceId;
};

/**
 * What a connector sends the hub about its device roots (ADR-0014): the index of each root, the
 * scan of each changed project folder, and answers to the hub's requests (a file it asked for as
 * raw bytes). A device sees only the roots on itself; any other root is 404.
 */
export const hubDeviceRoutes =
  (
    db: Db,
    channel: HubChannel,
    scanner: ProjectScanner,
    files: DeviceFiles,
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
          headers: z.object({
            "x-file-sha256": z.string().regex(/^[0-9a-f]{64}$/),
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
  };
