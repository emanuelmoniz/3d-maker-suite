import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import {
  fsFolderInputSchema,
  fsFolderResponseSchema,
  fsListQuerySchema,
  fsListResponseSchema,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HttpError } from "../errors.ts";
import { insideRoots } from "../lib/launcher.ts";
import { rootPaths } from "../projects/rootFs.ts";

type Entry = { name: string; path: string; type: "dir" | "file" };

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

export type DirEntry = {
  name: string;
  abs: string;
  type: "dir" | "file";
  /** A symlink (or Windows junction); type, size and date are its target's. */
  link: boolean;
  size: number;
  mtime: Date;
};

/** Folders and files of `dir`, folders first then by name; broken links and other kinds left out. */
export async function readEntries(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true }).catch((e) =>
    Promise.reject(fsError(e)),
  );
  const entries = await Promise.all(
    dirents.map(async (d) => {
      const abs = join(dir, d.name);
      const link = d.isSymbolicLink();
      // A locked system file (e.g. pagefile.sys) can't be stat'ed but is still listed.
      const s = (await stat(abs).catch(() => null)) ?? (link ? null : d);
      if (!s || !(s.isDirectory() || s.isFile())) return null;
      const type: DirEntry["type"] = s.isDirectory() ? "dir" : "file";
      const { size = 0, mtime = new Date(0) } = "mtime" in s ? s : {};
      return { name: d.name, abs, type, link, size, mtime };
    }),
  );
  return entries
    .filter((e) => e !== null)
    .sort(
      (a, b) =>
        (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
}

async function roots(): Promise<Entry[]> {
  if (process.platform !== "win32")
    return [
      { name: "/", path: "/", type: "dir" },
      { name: homedir(), path: homedir(), type: "dir" },
    ];
  const drives = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => `${l}:\\`);
  const ok = await Promise.all(
    drives.map((d) =>
      stat(d).then(
        () => true,
        () => false,
      ),
    ),
  );
  return drives.filter((_, i) => ok[i]).map((d) => ({ name: d, path: d, type: "dir" }));
}

/**
 * Lists folders (and in file mode, matching files) so the web app can pick a local path.
 * Names and types only; nothing is ever opened. Auth comes from the global access guard.
 * Admins are not confined to the project roots on purpose: it's how those roots and the slicer get chosen.
 * Editors (the project "Add folder" picker) only see the project roots and what is inside them.
 */
/** Editors and viewers see the disk only through the project roots; admins everywhere. */
const confinedTo = (req: FastifyRequest) => !!req.user && req.user.role !== "admin";

export const fsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/list",
      { schema: { querystring: fsListQuerySchema, response: { 200: fsListResponseSchema } } },
      async (req) => {
        const { path, mode, ext } = req.query;
        const confined = confinedTo(req);
        if (!path)
          return {
            path: null,
            parent: null,
            sep,
            entries: confined
              ? rootPaths(db).map((p) => ({ name: p, path: p, type: "dir" as const }))
              : await roots(),
          };
        if (!isAbsolute(path))
          throw new HttpError(400, "validation_error", "Path must be absolute");

        // Same normalisation as insideRoots: `..` and symlinks resolve before listing.
        const real = await realpath(resolve(path)).catch((e) => Promise.reject(fsError(e)));
        if (confined && !(await insideRoots(real, rootPaths(db))))
          throw new HttpError(403, "not_allowed", "Folder is not in a project root");
        const exts = ext
          ?.split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);

        const entries: Entry[] = (await readEntries(real))
          .filter(
            (e) =>
              e.type === "dir" ||
              (mode === "file" && (!exts?.length || exts.includes(extname(e.name).toLowerCase()))),
          )
          .map((e) => ({ name: e.name, path: e.abs, type: e.type }));
        const parent = dirname(real);
        return { path: real, parent: parent === real ? null : parent, sep, entries };
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
