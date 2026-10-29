import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FsListResponse } from "@3d-maker-suite/core";
import { within } from "./rootPath.ts";

export type DirEntry = {
  name: string;
  abs: string;
  type: "dir" | "file";
  /** A symlink (or Windows junction); type, size and date are its target's. */
  link: boolean;
  size: number;
  mtime: Date;
};

/**
 * Folders and files of `dir`, folders first then by name; broken links and other kinds left out.
 * OS errors are thrown as they come (`code` ENOENT, EACCES, ...).
 */
export async function readEntries(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
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

/** Where browsing starts: the drives on Windows, else `/` and the home folder. */
async function tops(): Promise<FsListResponse["entries"]> {
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
 * One level of a folder browser: folders, and in file mode the files with one of `exts`
 * (lower case, with the dot; none = all). `path` null = where browsing starts. Names and types
 * only; nothing is opened. `..` and links resolve first. OS errors are thrown as they come; a
 * relative path throws `code` EINVAL.
 */
export async function listFolder(
  path: string | null,
  mode: "folder" | "file" = "folder",
  exts?: string[],
): Promise<FsListResponse> {
  if (!path) return { path: null, parent: null, sep, entries: await tops() };
  if (!isAbsolute(path))
    throw Object.assign(new Error("Path must be absolute"), { code: "EINVAL" });
  const real = await realpath(resolve(path));
  const entries = (await readEntries(real))
    .filter(
      (e) =>
        e.type === "dir" ||
        (mode === "file" && (!exts?.length || exts.includes(extname(e.name).toLowerCase()))),
    )
    .map((e) => ({ name: e.name, path: e.abs, type: e.type }));
  const parent = dirname(real);
  return { path: real, parent: parent === real ? null : parent, sep, entries };
}

/**
 * `listFolder` confined to `folders` (real paths: a connector's shared folders). No path lists
 * them; any other path must be inside one once `..` and links resolve, else `code` EACCES, also
 * when it doesn't exist (so nothing tells what is there outside). At a folder, `parent` is null.
 */
export async function listShared(
  path: string | null,
  folders: readonly string[],
): Promise<FsListResponse> {
  if (!path)
    return {
      path: null,
      parent: null,
      sep,
      entries: folders.map((f) => ({ name: f, path: f, type: "dir" })),
    };
  const denied = () => Object.assign(new Error("Not a shared folder"), { code: "EACCES" });
  if (!isAbsolute(path))
    throw Object.assign(new Error("Path must be absolute"), { code: "EINVAL" });
  const real = await realpath(resolve(path)).catch((e) => {
    throw within(folders, resolve(path)) ? e : denied();
  });
  const top = within(folders, real);
  if (!top) throw denied();
  const list = await listFolder(real);
  return relative(top, real) === "" ? { ...list, parent: null } : list;
}
