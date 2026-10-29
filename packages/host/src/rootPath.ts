import { mkdir, realpath, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, sep, win32 } from "node:path";

const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { code }) as NodeJS.ErrnoException;
const invalid = () => fail("EINVAL", "Invalid path");

/**
 * The segments of a root-relative path (`/`, "" = the root). Throws EINVAL for an absolute path, an
 * empty, `.` or `..` segment, NUL, or on Windows a `\` or `:` in a segment. A folder may otherwise
 * have any name its OS allows.
 */
export function relParts(rel: string) {
  if (rel === "") return [];
  if (posix.isAbsolute(rel) || win32.isAbsolute(rel)) throw invalid();
  const p = rel.split("/");
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
export function below(base: string, abs: string) {
  const r = relative(base, abs);
  if (r === "" || r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) return null;
  return r.split(sep).join("/");
}

/**
 * The one of `folders` that is `abs` or holds it; undefined when none does. Case-insensitive on
 * Windows only, as `relative` is.
 */
export const within = (folders: readonly string[], abs: string) =>
  folders.find((f) => relative(f, abs) === "" || below(f, abs) !== null);

/**
 * The real path of an existing `rel` in the root whose real path is `base` ("" = the root), or null
 * when it is missing or a link leads it out of the root. EINVAL for a bad `rel`.
 */
export async function inRoot(base: string, rel: string) {
  const real = await realpath(join(base, ...relParts(rel))).catch(() => null);
  return real && (real === base || below(base, real) !== null) ? real : null;
}

/** Makes the folder `rel` in the root `base` (real path): ENOENT without its parent, EEXIST when there. */
export async function rootMkdir(base: string, rel: string) {
  const p = relParts(rel);
  const parent = p.length ? await inRoot(base, p.slice(0, -1).join("/")) : null;
  if (!parent) throw fail("ENOENT", "No such folder in the root");
  await mkdir(join(parent, p.at(-1) ?? ""));
}

/** Moves `rel` (not the root) to `<base>/<trash>/<as>`; returns where it went. */
export async function rootTrash(base: string, rel: string, trash: string, as: string) {
  const src = await inRoot(base, rel);
  if (!src || src === base) throw fail("ENOENT", "No such file in the root");
  const dest = join(base, trash, ...relParts(as));
  await mkdir(dirname(dest), { recursive: true });
  // A trash folder that is a link elsewhere would carry the files out of the root.
  if (!(await inRoot(base, below(base, dirname(dest)) ?? "")))
    throw fail("EACCES", "Trash is outside the root");
  // ponytail: a plain rename, so EXDEV across volumes (a mount inside the root) fails.
  await rename(src, dest);
  return dest;
}
