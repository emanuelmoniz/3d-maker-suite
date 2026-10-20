import { lstat } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { HttpError } from "../errors.ts";
import { insideRoots } from "../lib/launcher.ts";
import { isHidden } from "./scanFolder.ts";

const invalid = () => new HttpError(400, "invalid_path", "Invalid path");
const denied = () => new HttpError(403, "path_denied", "Path is outside the project folder");
const notFound = () => new HttpError(404, "path_not_found", "Path not found");
const exists = () => new HttpError(409, "path_exists", "A file or folder with this name exists");

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
const ILLEGAL = /[\u0000-\u001f<>:"|?*\\]/;
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** `name` with characters no OS allows in a file name made `-`, without trailing dots/spaces. */
export const safeName = (name: string) =>
  name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: same set as ILLEGAL, plus `/`
    .replace(/[\u0000-\u001f<>:"|?*\\/]/g, "-")
    .trim()
    .replace(/[. ]+$/, "");

/** A name that is safe as one file or folder name on every OS, or false. */
export const validName = (name: string) =>
  name !== "" &&
  name !== "." &&
  name !== ".." &&
  !ILLEGAL.test(name) &&
  !/[. ]$/.test(name) &&
  !DEVICE.test(name) &&
  !isHidden(name);

/**
 * The segments of a client path relative to the project folder: `/`-separated, never absolute,
 * no `..`, `\`, `:` (drive letters, NTFS streams) or hidden names (trash, upload temp files).
 * `""` is the project folder itself, allowed only where `root` is true.
 */
export function segments(rel: string, root = false): string[] {
  if (rel === "" && root) return [];
  if (posix.isAbsolute(rel) || win32.isAbsolute(rel)) throw invalid();
  const parts = rel.split("/");
  if (!parts.every(validName)) throw invalid();
  return parts;
}

const lstatOrNull = (p: string) => lstat(p).catch(() => null);

/** Throws unless `abs` exists, is no link, and its real path is inside `dir` (a real path). */
async function mustExistInside(dir: string, abs: string) {
  const s = await lstatOrNull(abs);
  if (!s) throw notFound();
  if (s.isSymbolicLink() || !(await insideRoots(abs, [dir]))) throw denied();
  return s;
}

/**
 * Resolves a client path inside the project folder `dir` (already a real path inside a root).
 * - "existing": it must exist; a symlink/junction, or one further up, is refused.
 * - "new": its parent must pass the same checks and it must not exist yet.
 * ponytail: check-then-act, so a link swapped in between this check and the write isn't caught;
 * fine for a local app, open each segment with O_NOFOLLOW if it ever serves untrusted users.
 */
export async function projectPath(
  dir: string,
  rel: string,
  want: "existing" | "new",
): Promise<{ abs: string; isDir: boolean }> {
  const abs = join(dir, ...segments(rel, want === "existing"));
  if (want === "existing") return { abs, isDir: (await mustExistInside(dir, abs)).isDirectory() };
  if (!(await mustExistInside(dir, dirname(abs))).isDirectory()) throw notFound();
  if (await lstatOrNull(abs)) throw exists();
  return { abs, isDir: false };
}
