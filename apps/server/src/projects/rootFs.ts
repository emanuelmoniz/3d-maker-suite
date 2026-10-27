import { watch as fsWatch } from "node:fs";
import { mkdir, readdir, realpath, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { PROJECT_TRASH_DIR, ROOT_HUB } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, eq } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { insideRoots } from "../lib/launcher.ts";
import { fsError } from "../routes/fs.ts";
import { isHidden, kindOf } from "./scanFolder.ts";

const { roots } = schema;

/** A project root as stored. */
export type Root = typeof roots.$inferSelect;
/** A folder below a root: the root and the path relative to it (`/`). */
export type Place = { root: Root; rel: string };

/**
 * All file access under one project root (ADR-0014). `rel` paths are root-relative with `/`: never
 * absolute, no empty, `.` or `..` segment; a link out of the root is refused. Local folders only
 * for now; a device root does the same calls over the connector.
 */
export type RootFs = {
  readonly root: Root;
  /**
   * The real local path of an existing `rel` ("" = the root), or null when it is missing or
   * outside the root. For code that hands a path to a library or program: the scan, 3MF parsing,
   * fingerprints, the slicer CLI, open in slicer.
   */
  local(rel: string): Promise<string | null>;
  /** `rel` of a local absolute path strictly below this root (real paths), or null. */
  relative(abs: string): Promise<string | null>;
  /** Project folders (`rel`): the first folder from the root down with a model file, or at `depth`. */
  discover(depth: number): Promise<string[]>;
  /** Makes a new folder whose parent exists: 409 `folder_exists` when it's there. */
  mkdir(rel: string): Promise<void>;
  /** Moves `rel` to `<root>/<trash>/<as>`; returns where it went (local). */
  trash(rel: string, as: string): Promise<string>;
  /** Watches the root; `rel` of what changed (null = unknown). Returns the stop function. */
  watch(
    onChange: (rel: string | null) => void,
    onError: (err: unknown) => void,
  ): Promise<() => void>;
};

const invalid = () => new HttpError(400, "invalid_path", "Invalid path");

/** Looser than `segments` (paths.ts): a folder may have any name its OS allows. */
function parts(rel: string) {
  if (rel === "") return [];
  const p = rel.split("/");
  if (posix.isAbsolute(rel) || win32.isAbsolute(rel)) throw invalid();
  for (const s of p)
    if (
      s === "" ||
      s === "." ||
      s === ".." ||
      s.includes("\0") ||
      (sep === "\\" && /[\\:]/.test(s))
    )
      throw invalid();
  return p;
}

/** `abs` relative to `base` with `/`, if strictly below it; else null. */
function below(base: string, abs: string) {
  const r = relative(base, abs);
  if (r === "" || r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) return null;
  return r.split(sep).join("/");
}

function localRoot(root: Root): RootFs {
  const base = () => realpath(resolve(root.path)).catch(() => null);
  const local = async (rel: string) => {
    const b = await base();
    return b && insideRoots(join(b, ...parts(rel)), [b]);
  };
  return {
    root,
    local,
    async relative(abs) {
      const b = await base();
      const real = b && (await realpath(resolve(abs)).catch(() => null));
      return b && real ? below(b, real) : null;
    },
    async discover(depth) {
      const b = await base();
      if (!b) return [];
      const found: string[] = [];
      async function visit(dir: string, level: number) {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        const hasModel = entries.some((e) => e.isFile() && kindOf(e.name) === "model");
        if (level > 0 && (level >= depth || hasModel)) {
          found.push(dir);
          return;
        }
        for (const e of entries.sort((a, b) => a.name.localeCompare(b.name)))
          if (e.isDirectory() && !isHidden(e.name)) await visit(join(dir, e.name), level + 1);
      }
      await visit(b, 0);
      return found.flatMap((d) => below(b, d) ?? []);
    },
    async mkdir(rel) {
      const p = parts(rel);
      const parent = p.length ? await local(p.slice(0, -1).join("/")) : null;
      if (!parent) throw new HttpError(400, "invalid_root", "Not a configured project folder");
      await mkdir(join(parent, p.at(-1) ?? "")).catch((e) =>
        Promise.reject(
          e.code === "EEXIST"
            ? new HttpError(409, "folder_exists", "The folder exists")
            : fsError(e),
        ),
      );
    },
    async trash(rel, as) {
      const b = await base();
      const src = await local(rel);
      if (!b || !src || src === b) throw new HttpError(404, "path_not_found", "Path not found");
      const dest = join(b, PROJECT_TRASH_DIR, ...parts(as));
      await mkdir(dirname(dest), { recursive: true });
      // A trash folder that is a link elsewhere would carry the files out of the root.
      if (!(await insideRoots(dirname(dest), [b])))
        throw new HttpError(403, "path_denied", "Trash is outside the project root");
      // ponytail: a plain rename, so EXDEV across volumes (a mount inside the root) fails.
      await rename(src, dest).catch((e) => Promise.reject(fsError(e)));
      return dest;
    },
    async watch(onChange, onError) {
      const b = await base();
      if (!b) throw new HttpError(404, "path_not_found", "Root not found");
      const w = fsWatch(b, { recursive: true }, (_, file) =>
        onChange(file ? file.split(/[\\/]/).join("/") : null),
      );
      w.on("error", onError);
      return () => w.close();
    },
  };
}

export function rootFs(root: Root): RootFs {
  if (root.location !== ROOT_HUB) throw new Error(`No access to roots on ${root.location} yet`);
  return localRoot(root);
}

export const listRoots = (db: Db) => db.select().from(roots).orderBy(asc(roots.position)).all();

/** The root folders, as configured (not resolved). */
export const rootPaths = (db: Db) => listRoots(db).map((r) => r.path);

/** Where a local absolute path is: below the deepest root that holds it (real paths), or null. */
export async function locate(db: Db, abs: string): Promise<Place | null> {
  let best: Place | null = null;
  for (const root of listRoots(db)) {
    const rel = await rootFs(root).relative(abs);
    if (rel !== null && (!best || rel.split("/").length < best.rel.split("/").length))
      best = { root, rel };
  }
  return best;
}

/** `rel` below the root as an absolute path on its location, for showing (not checked). */
export const absPath = (root: Root, rel: string) => join(root.path, ...rel.split("/"));

/** A project's folder through its root; null when it has none, or it is gone or outside its root. */
export async function projectDir(db: Db, p: { rootId: string | null; folder: string | null }) {
  const root = p.rootId ? db.select().from(roots).where(eq(roots.id, p.rootId)).get() : undefined;
  if (!root || p.folder === null) return null;
  const fs = rootFs(root);
  const dir = await fs.local(p.folder);
  return dir ? { fs, rel: p.folder, dir } : null;
}

/** The checked local path of a file in a project's folder (`file`: relative, `/`), or null. */
export async function projectFile(
  db: Db,
  p: { rootId: string | null; folder: string | null },
  file: string,
) {
  const own = await projectDir(db, p);
  return own ? own.fs.local(`${own.rel}/${file}`) : null;
}
