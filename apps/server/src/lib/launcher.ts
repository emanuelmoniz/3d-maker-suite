import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * The real path of `target` if it is `root` itself or inside one of the `roots`, else null.
 * Real paths on both sides, so `..` and symlinks can't escape. Missing paths give null.
 */
export async function insideRoots(target: string, roots: string[]): Promise<string | null> {
  const real = await realpath(resolve(target)).catch(() => null);
  if (!real) return null;
  for (const r of roots) {
    const rr = await realpath(resolve(r)).catch(() => null);
    if (!rr) continue;
    const rel = relative(rr, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return real;
  }
  return null;
}
