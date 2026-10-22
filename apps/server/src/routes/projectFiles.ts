import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  apiErrorSchema,
  projectFileMoveSchema,
  projectFilePathQuery,
  projectFilePathSchema,
  projectFilesListSchema,
  projectFilesQuery,
  projectFolderCreateSchema,
  projectTrashSchema,
  projectUploadQuery,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { insideRoots } from "../lib/launcher.ts";
import { readPreferences, rootPaths } from "../lib/preferences.ts";
import { projectPath, segments } from "../projects/paths.ts";
import { isHidden } from "../projects/scanFolder.ts";
import type { ProjectScanner } from "../projects/scanner.ts";
import { fsError, readEntries } from "./fs.ts";
import { IMAGE_TYPES, imageReply } from "./projects.ts";

const { projects } = schema;
const params = z.object({ id: z.uuid() });
const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  413: apiErrorSchema,
};
/** Hidden, so the scanner and the watcher skip it. One per project root, same volume as the files. */
export const TRASH_DIR = ".3d-maker-suite-trash";
const MB = 1024 * 1024;

const tooLarge = (maxMb: number) =>
  new HttpError(413, "file_too_large", `The file is larger than ${maxMb} MB`);
const os = <T>(p: Promise<T>) => p.catch((e) => Promise.reject(fsError(e)));
/** Same file (e.g. a rename that only changes the letter case on Windows/macOS). */
const sameFile = async (a: string, b: string) => {
  const [x, y] = await Promise.all([stat(a, { bigint: true }), stat(b, { bigint: true })]);
  return x.ino === y.ino && x.dev === y.dev;
};
/** `path` moved from `from` to `to` (also inside a moved folder); null when removed. */
const repath = (path: string, from: string, to: string | null) =>
  path === from || path.startsWith(`${from}/`)
    ? to === null
      ? null
      : to + path.slice(from.length)
    : path;

/**
 * File manager for a project folder: every path is project-relative and checked by `projectPath`,
 * so nothing outside the folder is reachable. Each change re-scans the project right away.
 */
export const projectFilesRoutes =
  (db: Db, scanner: ProjectScanner): FastifyPluginAsyncZod =>
  async (app) => {
    // Raw stream, read by the upload route itself (Fastify's bodyLimit doesn't apply to it).
    app.addContentTypeParser("application/octet-stream", (_req, payload, done) =>
      done(null, payload),
    );

    const roots = () => rootPaths(db);

    /** The real path of the configured root holding `folder`. */
    async function rootOf(folder: string) {
      for (const r of roots()) {
        const real = await insideRoots(r, [r]);
        if (real && (await insideRoots(folder, [real]))) return real;
      }
      return null;
    }

    /** The project and its folder's real path; the folder must still be inside a project root. */
    async function project(id: string) {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Project not found");
      if (!row.folderPath) throw new HttpError(404, "no_folder", "Project has no folder");
      const dir = await insideRoots(row.folderPath, roots());
      if (!dir) throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
      return { row, folderPath: row.folderPath, dir };
    }

    /** Keeps the description link, cover and gallery picks after a move (null: deleted). */
    async function changed(
      p: Awaited<ReturnType<typeof project>>,
      from?: string,
      to?: string | null,
    ) {
      if (from !== undefined && to !== undefined) {
        const { descriptionFile, coverFile, gallery } = p.row;
        const move = (path: string | null) => path && repath(path, from, to);
        const moveAll = (paths: string[]) => paths.map(move).filter((x): x is string => x !== null);
        const next = {
          descriptionFile: move(descriptionFile),
          coverFile: move(coverFile),
          gallery: { folders: moveAll(gallery.folders), images: moveAll(gallery.images) },
        };
        if (JSON.stringify(next) !== JSON.stringify({ descriptionFile, coverFile, gallery }))
          db.update(projects).set(next).where(eq(projects.id, p.row.id)).run();
      }
      await scanner.refresh(p.folderPath);
    }

    app.get(
      "/:id/files",
      {
        schema: {
          params,
          querystring: projectFilesQuery,
          response: { 200: projectFilesListSchema, ...errors },
        },
      },
      async (req) => {
        const { dir } = await project(req.params.id);
        const rel = req.query.path;
        const { abs, isDir } = await projectPath(dir, rel, "existing");
        if (!isDir) throw new HttpError(400, "not_a_directory", "Not a folder");
        const entries = (await readEntries(abs))
          .filter((e) => !e.link && !isHidden(e.name))
          .map((e) => ({
            name: e.name,
            path: rel ? `${rel}/${e.name}` : e.name,
            type: e.type,
            size: e.type === "file" ? e.size : 0,
            modifiedAt: e.mtime.toISOString(),
          }));
        return { path: rel, entries };
      },
    );

    // One image of the folder (gallery), through the path guard; nothing but images is served.
    app.get(
      "/:id/files/image",
      { schema: { params, querystring: projectFilePathQuery, response: errors } },
      async (req, reply) => {
        const { dir } = await project(req.params.id);
        const { path } = req.query;
        const { abs, isDir } = await projectPath(dir, path, "existing");
        if (isDir || !IMAGE_TYPES[extname(path).toLowerCase()])
          throw new HttpError(404, "not_found", "Image not found");
        return imageReply(reply, path).send(createReadStream(abs));
      },
    );

    app.post(
      "/:id/files/folders",
      {
        schema: {
          params,
          body: projectFolderCreateSchema,
          response: { 201: projectFilePathSchema, ...errors },
        },
      },
      async (req, reply) => {
        const p = await project(req.params.id);
        const { abs } = await projectPath(p.dir, req.body.path, "new");
        await os(mkdir(abs));
        await changed(p);
        return reply.status(201).send({ path: req.body.path });
      },
    );

    // One file per request: the raw body is the file. Streams to a hidden temp file next to the
    // target, then renames it over, so a failed or too large upload never leaves half a file.
    app.put(
      "/:id/files/content",
      {
        schema: {
          params,
          querystring: projectUploadQuery,
          response: { 200: projectFilePathSchema, 201: projectFilePathSchema, ...errors },
        },
      },
      async (req, reply) => {
        const p = await project(req.params.id);
        const { path, replace } = req.query;
        const maxMb = readPreferences(db).projectUploadMaxMb;
        const max = maxMb * MB;
        if (Number(req.headers["content-length"] ?? 0) > max) throw tooLarge(maxMb);

        let abs: string;
        let replaced = false;
        try {
          abs = (await projectPath(p.dir, path, "new")).abs;
        } catch (e) {
          if (!(replace === "true" && e instanceof HttpError && e.code === "path_exists")) throw e;
          const existing = await projectPath(p.dir, path, "existing");
          if (existing.isDir) throw e;
          abs = existing.abs;
          replaced = true;
        }

        // No body at all (an empty file) arrives as undefined.
        const body = req.body instanceof Readable ? req.body : Readable.from([]);
        const tmp = join(dirname(abs), `.${randomUUID()}.upload`);
        let seen = 0;
        try {
          await os(
            pipeline(
              body,
              async function* (chunks: AsyncIterable<Buffer>) {
                // ponytail: past the cap the rest is read and dropped (throwing here would cut the
                // connection, so the client never sees the 413). Only bodies without a
                // Content-Length get this far; browsers always send one for a File.
                for await (const chunk of chunks) {
                  seen += chunk.length;
                  if (seen <= max) yield chunk;
                }
              },
              createWriteStream(tmp, { flags: "wx" }),
            ),
          );
          if (seen > max) throw tooLarge(maxMb);
          await os(rename(tmp, abs));
        } finally {
          await rm(tmp, { force: true });
        }
        await changed(p);
        return reply.status(replaced ? 200 : 201).send({ path });
      },
    );

    app.post(
      "/:id/files/move",
      {
        schema: {
          params,
          body: projectFileMoveSchema,
          response: { 200: projectFilePathSchema, ...errors },
        },
      },
      async (req) => {
        const p = await project(req.params.id);
        const { from, to } = req.body;
        if (to === from || to.startsWith(`${from}/`))
          throw new HttpError(400, "invalid_move", "A folder can't be moved into itself");
        const src = await projectPath(p.dir, from, "existing");
        let dest: string;
        try {
          dest = (await projectPath(p.dir, to, "new")).abs;
        } catch (e) {
          // Only a change of letter case may "exist" already: it is the same file.
          const target = join(p.dir, ...segments(to));
          if (
            !(e instanceof HttpError && e.code === "path_exists") ||
            from.toLowerCase() !== to.toLowerCase() ||
            !(await sameFile(src.abs, target))
          )
            throw e;
          dest = target;
        }
        await os(rename(src.abs, dest));
        await changed(p, from, to);
        return { path: to };
      },
    );

    // Moves into the root's trash; `GET/DELETE /trash` show and empty it.
    app.delete(
      "/:id/files",
      {
        schema: {
          params,
          querystring: projectFilePathQuery,
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        const p = await project(req.params.id);
        const { abs } = await projectPath(p.dir, req.query.path, "existing");
        const root = await rootOf(p.dir);
        if (!root)
          throw new HttpError(403, "not_allowed", "Project folder is not in a project root");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const dest = join(
          root,
          TRASH_DIR,
          `${stamp}_${basename(p.dir)}`,
          ...segments(req.query.path),
        );
        await mkdir(dirname(dest), { recursive: true });
        // A trash folder that is a link elsewhere would carry the files out of the root.
        if (!(await insideRoots(dirname(dest), [root])))
          throw new HttpError(403, "path_denied", "Trash is outside the project root");
        // ponytail: a plain rename, so a project folder on another volume than its root (a mount
        // point inside the root) fails with EXDEV; copy + remove then if that ever comes up.
        await os(rename(abs, dest));
        await changed(p, req.query.path, null);
        return reply.status(204).send(null);
      },
    );

    const trashDirs = async () => {
      const dirs: string[] = [];
      for (const r of roots()) {
        const real = await insideRoots(r, [r]);
        if (real) dirs.push(join(real, TRASH_DIR));
      }
      return dirs;
    };

    app.get("/trash", { schema: { response: { 200: projectTrashSchema } } }, async () => {
      let items = 0;
      let bytes = 0;
      for (const dir of await trashDirs()) {
        items += (await readdir(dir).catch(() => [])).length;
        for (const d of await readdir(dir, { withFileTypes: true, recursive: true }).catch(
          () => [],
        ))
          if (d.isFile())
            bytes += (await stat(join(d.parentPath, d.name)).catch(() => null))?.size ?? 0;
      }
      return { items, bytes };
    });

    app.delete("/trash", { schema: { response: { 204: z.null() } } }, async (_req, reply) => {
      // rm never follows links, so a trash folder that is a link only loses the link.
      for (const dir of await trashDirs()) await os(rm(dir, { recursive: true, force: true }));
      return reply.status(204).send(null);
    });
  };
