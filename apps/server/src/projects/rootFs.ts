import { watch as fsWatch } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PROJECT_TRASH_DIR, ROOT_HUB } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  below,
  discoverFolders,
  inRoot,
  relParts,
  rootMkdir,
  rootTrash,
} from "@3d-maker-suite/host";
import { asc, eq } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { fsError } from "../routes/fs.ts";
import type { DeviceFiles } from "./deviceFiles.ts";

const { roots } = schema;

/** A project root as stored. */
export type Root = typeof roots.$inferSelect;
/** A folder below a root: the root and the path relative to it (`/`). */
export type Place = { root: Root; rel: string };

/**
 * All file access under one project root (ADR-0014). `rel` paths are root-relative with `/`: never
 * absolute, no empty, `.` or `..` segment (400 `invalid_path`); a link out of the root is refused.
 * A device root's files are on its device: nothing is local, files are pulled when needed, its
 * writes run on its connector and its index comes from there.
 */
export type RootFs = {
  readonly root: Root;
  /**
   * The real local path of an existing `rel` ("" = the root), or null when it is missing or
   * outside the root. For code that works in the folder: the scan, the file manager, open in
   * slicer. Always null on a device.
   */
  local(rel: string): Promise<string | null>;
  /**
   * A local path to read the file `rel` from: `local`, or on a device a copy pulled into the temp
   * cache. For code that hands a file to a library or program: 3MF parsing, fingerprints, the
   * slicer CLI, a download. Null when it is missing.
   */
  file(rel: string): Promise<string | null>;
  /** `rel` of a local absolute path strictly below this root (real paths), or null. */
  relative(abs: string): Promise<string | null>;
  /** Project folders (`rel`): the first folder from the root down with a model file, or at `depth`. */
  discover(depth: number): Promise<string[]>;
  /** Makes a new folder whose parent exists: 409 `folder_exists` when it's there. */
  mkdir(rel: string): Promise<void>;
  /** Moves `rel` to `<root>/<trash>/<as>`; returns where it went (on the root's location). */
  trash(rel: string, as: string): Promise<string>;
  /** Watches the root; `rel` of what changed (null = unknown). Returns the stop function. */
  watch(
    onChange: (rel: string | null) => void,
    onError: (err: unknown) => void,
  ): Promise<() => void>;
};

const os = <T>(p: Promise<T>) => p.catch((e) => Promise.reject(fsError(e)));
/** A folder made where it can't be, or that is there: the same answers on the hub and a device. */
const mkdirError = (e: NodeJS.ErrnoException) =>
  e.code === "EEXIST"
    ? new HttpError(409, "folder_exists", "The folder exists")
    : e.code === "ENOENT"
      ? new HttpError(400, "invalid_root", "Not a configured project folder")
      : fsError(e);

function localRoot(root: Root): RootFs {
  const base = () => realpath(resolve(root.path)).catch(() => null);
  const local = async (rel: string) => {
    const b = await base();
    return b && os(inRoot(b, rel));
  };
  return {
    root,
    local,
    file: local,
    async relative(abs) {
      const b = await base();
      const real = b && (await realpath(resolve(abs)).catch(() => null));
      return b && real ? below(b, real) : null;
    },
    async discover(depth) {
      const b = await base();
      return b ? discoverFolders(b, depth) : [];
    },
    async mkdir(rel) {
      const b = await base();
      if (!b) throw new HttpError(400, "invalid_root", "Not a configured project folder");
      await rootMkdir(b, rel).catch((e) => Promise.reject(mkdirError(e)));
    },
    async trash(rel, as) {
      const b = await base();
      if (!b) throw new HttpError(404, "path_not_found", "Path not found");
      return os(rootTrash(b, rel, PROJECT_TRASH_DIR, as));
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

/** Each app's device files (one hub channel and pull cache per database). */
const devices = new WeakMap<Db, DeviceFiles>();
export const useDeviceFiles = (db: Db, files: DeviceFiles) => void devices.set(db, files);

/** A root on a device (ADR-0014): pulls, and writes through its connector. */
function deviceRoot(db: Db, root: Root): RootFs {
  /** Checks paths here before anything is asked (the connector checks them again). */
  const files = (...rels: string[]) => {
    try {
      for (const rel of rels) relParts(rel);
    } catch (e) {
      throw fsError(e as NodeJS.ErrnoException);
    }
    const f = devices.get(db);
    if (!f) throw new HttpError(409, "device_offline", "The device is offline");
    return f;
  };
  return {
    root,
    local: async () => null,
    file: async (rel) => files(rel).pull(root, rel),
    relative: async () => null,
    discover: async () => [],
    mkdir: async (rel) => files(rel).mkdir(root, rel, mkdirError),
    trash: async (rel, as) => files(rel, as).trash(root, rel, as),
    watch: async () => () => {},
  };
}

export const onDevice = (root: Pick<Root, "location">) => root.location !== ROOT_HUB;

/** Whether a project's root is on a device. */
export const onDeviceRoot = (db: Db, rootId: string | null) => {
  const root = rootId ? db.select().from(roots).where(eq(roots.id, rootId)).get() : undefined;
  return !!root && onDevice(root);
};

export const rootFs = (db: Db, root: Root): RootFs =>
  onDevice(root) ? deviceRoot(db, root) : localRoot(root);

export const listRoots = (db: Db) => db.select().from(roots).orderBy(asc(roots.position)).all();

/** The roots on the hub (the ones its own scan and watcher cover). */
export const hubRoots = (db: Db) => listRoots(db).filter((r) => !onDevice(r));

/** The hub's root folders, as configured (not resolved). */
export const rootPaths = (db: Db) => hubRoots(db).map((r) => r.path);

/** Where a local absolute path is: below the deepest root that holds it (real paths), or null. */
export async function locate(db: Db, abs: string): Promise<Place | null> {
  let best: Place | null = null;
  for (const root of listRoots(db)) {
    const rel = await rootFs(db, root).relative(abs);
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
  const fs = rootFs(db, root);
  const dir = await fs.local(p.folder);
  return dir ? { fs, rel: p.folder, dir } : null;
}

/**
 * A checked local path to read a file of a project's folder from (`file`: relative, `/`), or null.
 * A device root's file is pulled (RootFs `file`).
 */
export async function projectFile(
  db: Db,
  p: { rootId: string | null; folder: string | null },
  file: string,
) {
  const root = p.rootId ? db.select().from(roots).where(eq(roots.id, p.rootId)).get() : undefined;
  return root && p.folder !== null ? rootFs(db, root).file(`${p.folder}/${file}`) : null;
}
