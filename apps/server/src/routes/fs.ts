import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fsListQuerySchema, fsListResponseSchema } from "@3d-maker-suite/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HttpError } from "../errors.ts";

type Entry = { name: string; path: string; type: "dir" | "file" };

const ERRORS: Record<string, [number, string, string]> = {
  ENOENT: [404, "path_not_found", "Path not found"],
  ENOTDIR: [400, "not_a_directory", "Not a folder"],
  EACCES: [403, "path_denied", "Access denied"],
  EPERM: [403, "path_denied", "Access denied"],
};
const fsError = (err: NodeJS.ErrnoException) => {
  const known = err.code && ERRORS[err.code];
  return known ? new HttpError(...known) : err;
};

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
 * Not confined to the project roots on purpose: it's how those roots and the slicer get chosen.
 */
export const fsRoutes = (): FastifyPluginAsyncZod => async (app) => {
  app.get(
    "/list",
    { schema: { querystring: fsListQuerySchema, response: { 200: fsListResponseSchema } } },
    async (req) => {
      const { path, mode, ext } = req.query;
      if (!path) return { path: null, parent: null, sep, entries: await roots() };
      if (!isAbsolute(path)) throw new HttpError(400, "validation_error", "Path must be absolute");

      // Same normalisation as insideRoots: `..` and symlinks resolve before listing.
      const real = await realpath(resolve(path)).catch((e) => Promise.reject(fsError(e)));
      const dirents = await readdir(real, { withFileTypes: true }).catch((e) =>
        Promise.reject(fsError(e)),
      );
      const exts = ext
        ?.split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      const entries: Entry[] = [];
      for (const d of dirents) {
        const full = join(real, d.name);
        let dir = d.isDirectory();
        let file = d.isFile();
        if (d.isSymbolicLink()) {
          const s = await stat(full).catch(() => null);
          if (!s) continue; // broken link
          dir = s.isDirectory();
          file = s.isFile();
        }
        if (dir) entries.push({ name: d.name, path: full, type: "dir" });
        else if (
          file &&
          mode === "file" &&
          (!exts?.length || exts.includes(extname(d.name).toLowerCase()))
        )
          entries.push({ name: d.name, path: full, type: "file" });
      }
      entries.sort(
        (a, b) =>
          (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      );
      const parent = dirname(real);
      return { path: real, parent: parent === real ? null : parent, sep, entries };
    },
  );
};
