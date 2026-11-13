import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const indexSchema = z.object({
  rel: z.string(),
  versions: z.array(
    z.object({ version: z.number().int().positive(), size: z.number(), savedAt: z.string() }),
  ),
});
export type Kept = z.infer<typeof indexSchema>["versions"][number];

/**
 * Earlier versions of device root files, kept when an upload through the app replaces one: in
 * the data folder, never in the root (a shared folder would carry them to everyone).
 * `<dir>/<rootId>/<key>/<n>` and `index.json`; `key` from the path.
 * ponytail: a lowered keep prunes at the file's next upload; a trashed or moved file's versions
 * stay behind.
 */
export function createVersions(dir: string) {
  const folder = (rootId: string, rel: string) =>
    join(dir, rootId, createHash("sha256").update(rel).digest("hex").slice(0, 16));

  /** The kept versions of `rel`, oldest first; none when unknown. */
  async function list(rootId: string, rel: string): Promise<Kept[]> {
    const raw = await readFile(join(folder(rootId, rel), "index.json"), "utf8").catch(() => null);
    const parsed = raw ? indexSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success && parsed.data.rel === rel ? parsed.data.versions : [];
  }

  return {
    list,

    /** Copies the file at `abs` (still `rel`'s content) in as the next version, then prunes. */
    async keep(rootId: string, rel: string, abs: string, keep: number) {
      const at = folder(rootId, rel);
      const st = await stat(abs);
      const versions = await list(rootId, rel);
      const version = (versions.at(-1)?.version ?? 0) + 1;
      await mkdir(at, { recursive: true });
      // A copy: the data folder may be on another volume than the root.
      await copyFile(abs, join(at, String(version)));
      versions.push({ version, size: st.size, savedAt: st.mtime.toISOString() });
      const drop = versions.splice(0, Math.max(0, versions.length - keep));
      await writeFile(join(at, "index.json"), JSON.stringify({ rel, versions }));
      for (const v of drop) await rm(join(at, String(v.version)), { force: true });
    },

    /** Where a kept version is; null when there is no such one. */
    async path(rootId: string, rel: string, version: number) {
      const kept = (await list(rootId, rel)).some((v) => v.version === version);
      return kept ? join(folder(rootId, rel), String(version)) : null;
    },
  };
}

export type Versions = ReturnType<typeof createVersions>;
