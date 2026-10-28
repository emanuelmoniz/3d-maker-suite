import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  fsFolderInputSchema,
  fsFolderResponseSchema,
  fsListQuerySchema,
  fsListResponseSchema,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import { type DirEntry, listFolder, readEntries as readLocal } from "@3d-maker-suite/host";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { insideRoots } from "../lib/launcher.ts";
import { rootPaths } from "../projects/rootFs.ts";

const ERRORS: Record<string, [number, string, string]> = {
  ENOENT: [404, "path_not_found", "Path not found"],
  ENOTDIR: [400, "not_a_directory", "Not a folder"],
  EACCES: [403, "path_denied", "Access denied"],
  EPERM: [403, "path_denied", "Access denied"],
  EBUSY: [409, "path_busy", "The file is in use"],
  EEXIST: [409, "path_exists", "A file or folder with this name exists"],
  ENOTEMPTY: [409, "path_exists", "A file or folder with this name exists"],
  EINVAL: [400, "invalid_path", "Invalid path"],
};
/** Known OS errors as HTTP errors; anything else stays a 500. */
export const fsError = (err: NodeJS.ErrnoException) => {
  const known = err.code && ERRORS[err.code];
  return known ? new HttpError(...known) : err;
};

export type { DirEntry };
/** Folders and files of `dir` (`readEntries` from the host package), OS errors as HTTP errors. */
export const readEntries = (dir: string) => readLocal(dir).catch((e) => Promise.reject(fsError(e)));

/**
 * Lists folders (and in file mode, matching files) so the web app can pick a local path, or with
 * `device` a path on that device (through its connector). Names and types only; nothing is ever
 * opened. Auth comes from the global access guard.
 * Admins are not confined to the project roots on purpose: it's how those roots and the slicer get chosen.
 * Editors (the project "Add folder" picker) only see the project roots and what is inside them.
 */
/** Editors and viewers see the disk only through the project roots; admins everywhere. */
const confinedTo = (req: FastifyRequest) => !!req.user && req.user.role !== "admin";

export const fsRoutes =
  (db: Db, channel: HubChannel): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/list",
      { schema: { querystring: fsListQuerySchema, response: { 200: fsListResponseSchema } } },
      async (req) => {
        const { path, mode, ext, device } = req.query;
        const confined = confinedTo(req);
        if (device) {
          if (confined) throw new HttpError(403, "not_allowed", "Only admins browse a device");
          return channel.ask(
            device,
            (requestId) => ({ type: "fs.list", requestId, path: path ?? null }),
            fsListResponseSchema,
          );
        }
        if (!path && confined)
          return {
            path: null,
            parent: null,
            sep,
            entries: rootPaths(db).map((p) => ({ name: p, path: p, type: "dir" as const })),
          };
        if (path && !isAbsolute(path))
          throw new HttpError(400, "validation_error", "Path must be absolute");
        // Same normalisation as insideRoots: `..` and symlinks resolve before listing.
        if (path && confined) {
          const real = await realpath(resolve(path)).catch((e) => Promise.reject(fsError(e)));
          if (!(await insideRoots(real, rootPaths(db))))
            throw new HttpError(403, "not_allowed", "Folder is not in a project root");
        }
        const exts = ext
          ?.split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        return listFolder(path ?? null, mode, exts).catch((e) => Promise.reject(fsError(e)));
      },
    );

    // "New folder" in the picker. Editors only inside a project root; the name is one segment.
    app.post(
      "/folder",
      { schema: { body: fsFolderInputSchema, response: { 201: fsFolderResponseSchema } } },
      async (req, reply) => {
        const { path, name } = req.body;
        if (!isAbsolute(path))
          throw new HttpError(400, "validation_error", "Path must be absolute");
        const parent = await realpath(resolve(path)).catch((e) => Promise.reject(fsError(e)));
        if (confinedTo(req) && !(await insideRoots(parent, rootPaths(db))))
          throw new HttpError(403, "not_allowed", "Folder is not in a project root");
        const dir = join(parent, name);
        await mkdir(dir).catch((e) => Promise.reject(fsError(e)));
        return reply.status(201).send({ path: dir });
      },
    );
  };
