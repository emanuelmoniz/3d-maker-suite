import {
  apiErrorSchema,
  deviceFolderQuerySchema,
  deviceFolderSchema,
  deviceIndexResultSchema,
  deviceIndexSchema,
  deviceReplySchema,
  deviceRootSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import type { ProjectScanner } from "../projects/scanner.ts";

const { roots } = schema;
const rootParams = z.object({ rootId: z.uuid() });
const errors = { 400: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema };

/** The paired device making the request; the role check is skipped for these routes (lib/auth.ts). */
const deviceOf = (req: FastifyRequest) => {
  if (!req.deviceId) throw new HttpError(403, "forbidden", "Only a paired device can call this");
  return req.deviceId;
};

/**
 * What a connector sends the hub about its device roots (ADR-0014): the index of each root, the
 * scan of each changed project folder, and answers to the hub's requests. A device sees only the
 * roots on itself; any other root is 404.
 */
export const hubDeviceRoutes =
  (db: Db, channel: HubChannel, scanner: ProjectScanner): FastifyPluginAsyncZod =>
  async (app) => {
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
        const maxFiles = readPreferences(db).projectScanMaxFiles;
        return db
          .select()
          .from(roots)
          .where(eq(roots.location, deviceOf(req)))
          .all()
          .map(({ id, path, projectDepth, filesDepth }) => ({
            id,
            path,
            projectDepth,
            filesDepth,
            maxFiles,
          }));
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
      async (req) => ({ want: scanner.deviceIndex(mine(req, req.params.rootId), req.body) }),
    );

    app.put(
      "/roots/:rootId/folders",
      {
        // A folder's meta (up to 50 3MFs) plus its docs and a cover.
        bodyLimit: 16 * 1024 * 1024,
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
        scanner.deviceFolderGone(mine(req, req.params.rootId), req.query.rel);
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
  };
