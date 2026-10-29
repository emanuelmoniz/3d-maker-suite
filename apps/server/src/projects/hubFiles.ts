import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type HubChanges, type HubUploadResult, PROJECT_TRASH_DIR } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { inRoot, isHidden, relParts, rootTrash } from "@3d-maker-suite/host";
import { and, asc, eq, gt, isNotNull, max, sql } from "drizzle-orm";
import { raise } from "../alerts/evaluate.ts";
import { HttpError } from "../errors.ts";
import { mayEditRoot, projectAccess, type Rights, rootRule } from "../lib/auth.ts";
import { fsError } from "../routes/fs.ts";
import { hubRoots, type Root, rootFs } from "./rootFs.ts";

const { devices, hubFiles, projects } = schema;
type Row = typeof hubFiles.$inferSelect;

/** The most one file may be. */
export const FILE_CAP_BYTES = 10 * 1024 ** 3;

/** Writes `body` to `path`, capped at `cap` bytes (`tooLarge` past it); returns its sha256. */
export async function writeHashed(body: Readable, path: string, cap: number, tooLarge: Error) {
  const hash = createHash("sha256");
  let size = 0;
  await pipeline(
    body,
    async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) {
        size += chunk.length;
        if (size > cap) throw tooLarge;
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(path),
  );
  return hash.digest("hex");
}

/** Never synced: hidden names (the trash, temp `.part` files) and slicers' `<file>.tmp` saves. */
const skipped = (name: string) => isHidden(name) || /\.(tmp|part)$/i.test(name);
const invalid = () => new HttpError(400, "invalid_path", "Invalid path");
/** `rel`'s segments, 400 when it is bad or never synced. */
function partsOf(rel: string) {
  try {
    const parts = relParts(rel);
    if (parts.length && !parts.some(skipped)) return parts;
  } catch {}
  throw invalid();
}

const sha256Of = async (abs: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(abs)) hash.update(chunk);
  return hash.digest("hex");
};

/** `<name> (conflict <device> <date>).<ext>`; the device name made safe for a file name. */
const conflictName = (name: string, device: string, at: Date, n: number) => {
  const ext = extname(name);
  const who = device.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").replace(/[. ]+$/, "") || "device";
  const when = at.toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
  return `${name.slice(0, name.length - ext.length)} (conflict ${who} ${when}${n > 1 ? ` ${n}` : ""})${ext}`;
};

/**
 * The files of hub roots as devices sync them (ADR-0014): the `hub_files` index, kept current by
 * the scanner and watcher (`reindex`), the change feed, download, upload and delete. Every change
 * to one path runs one at a time, so two uploads of the same base give one version and one
 * conflict copy. One per app.
 * ponytail: in-process locks, one server per database; tombstones are never pruned.
 */
export function createHubFiles(db: Db) {
  const locks = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    void tail.then(() => locks.get(key) === tail && locks.delete(key));
    return run;
  }

  const rowOf = (rootId: string, path: string) =>
    db
      .select()
      .from(hubFiles)
      .where(and(eq(hubFiles.rootId, rootId), eq(hubFiles.path, path)))
      .get();
  /** The next change number; synchronous with the write that takes it. */
  const nextSeq = () =>
    (db
      .select({ n: max(hubFiles.seq) })
      .from(hubFiles)
      .get()?.n ?? 0) + 1;
  const update = (row: Row, set: Partial<Row>) =>
    db.update(hubFiles).set(set).where(eq(hubFiles.id, row.id)).returning().get();

  /**
   * Brings one path's row in line with the disk (call it holding the path's lock): gone → a
   * tombstone; new or other bytes → the next version; same bytes → only size and mtime.
   */
  async function refreshNow(root: Root, base: string, path: string) {
    const row = rowOf(root.id, path);
    const abs = await inRoot(base, path).catch(() => null);
    const st = abs ? await stat(abs).catch(() => null) : null;
    if (!abs || !st?.isFile()) {
      if (row && !row.deleted) return update(row, { deleted: true, seq: nextSeq() });
      return row;
    }
    if (row && !row.deleted && row.size === st.size && row.mtimeMs === st.mtimeMs) return row;
    const sha256 = await sha256Of(abs);
    const disk = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
    if (row && !row.deleted && row.sha256 === sha256) return update(row, disk);
    const next = { ...disk, deleted: false, version: (row?.version ?? 0) + 1, seq: nextSeq() };
    return row
      ? update(row, next)
      : db
          .insert(hubFiles)
          .values({ rootId: root.id, path, ...next })
          .returning()
          .get();
  }
  const os = <T>(p: Promise<T>) => p.catch((e) => Promise.reject(fsError(e)));
  const keyOf = (root: Root, path: string) => `${root.id}\0${path}`;
  const refresh = (root: Root, base: string, path: string) =>
    serial(keyOf(root, path), () => refreshNow(root, base, path));

  /** The root's real path; 404 when it is missing. */
  async function baseOf(root: Root) {
    const base = await rootFs(db, root).local("");
    if (!base) throw new HttpError(404, "not_found", "Root not found");
    return base;
  }

  /**
   * What `user` may do with each path of a root: the project whose folder holds it decides, a file
   * in no project follows the root's edit right.
   */
  function accessIn(user: Rights | undefined, root: Root) {
    const rule = rootRule(db, root);
    const list = db
      .select({
        id: projects.id,
        name: projects.name,
        folder: projects.folder,
        ownerId: projects.ownerId,
      })
      .from(projects)
      .where(and(eq(projects.rootId, root.id), isNotNull(projects.folder)))
      .all();
    const projectOf = (path: string) =>
      list
        .filter((p) => path.startsWith(`${p.folder}/`))
        .sort((a, b) => (b.folder ?? "").length - (a.folder ?? "").length)[0];
    return {
      projectOf,
      access(path: string) {
        const p = projectOf(path);
        return p ? projectAccess(user, p, rule) : mayEditRoot(user, rule) ? "edit" : "read";
      },
    };
  }
  /** 404 for a file `user` can't see, 403 for one they may only download. */
  function assertEdit(user: Rights | undefined, root: Root, path: string) {
    const a = accessIn(user, root).access(path);
    if (a === "none") throw new HttpError(404, "not_found", "File not found");
    if (a === "read") throw new HttpError(403, "forbidden", "This file is download-only for you");
  }

  /** Makes the folders above `parts` inside the root; returns the real path of the last one. */
  async function parentOf(base: string, parts: string[]) {
    let dir = base;
    for (let i = 1; i < parts.length; i++) {
      const rel = parts.slice(0, i).join("/");
      let real = await inRoot(base, rel);
      if (!real) {
        await mkdir(join(dir, parts[i - 1] ?? "")).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
        // A link out of the root stays out.
        real = await inRoot(base, rel);
      }
      if (!real || !(await stat(real)).isDirectory()) throw invalid();
      dir = real;
    }
    return dir;
  }

  return {
    /**
     * Re-reads `rel` ("" = the whole root) of a hub root into the index: files below it on disk
     * and rows below it that are gone. A missing root changes nothing (an unmounted share must not
     * read as everything deleted). A hub root nested in this one indexes its own files.
     */
    async reindex(root: Root, rel: string) {
      const base = await rootFs(db, root).local("");
      if (!base) return;
      try {
        if (rel !== "" && relParts(rel).some(skipped)) return;
      } catch {
        return;
      }
      const nested = new Set(
        (
          await Promise.all(
            hubRoots(db)
              .filter((r) => r.id !== root.id)
              .map((r) => rootFs(db, r).local("")),
          )
        ).filter((b): b is string => !!b && b !== base),
      );
      const disk: string[] = [];
      const walk = async (abs: string, at: string): Promise<void> => {
        for (const d of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
          if (skipped(d.name)) continue;
          const path = at ? `${at}/${d.name}` : d.name;
          if (d.isFile()) disk.push(path);
          else if (d.isDirectory() && !nested.has(join(abs, d.name)))
            await walk(join(abs, d.name), path);
        }
      };
      const abs = rel ? await inRoot(base, rel).catch(() => null) : base;
      const st = abs ? await stat(abs).catch(() => null) : null;
      if (abs && st?.isDirectory()) await walk(abs, rel);
      else if (st?.isFile()) disk.push(rel);
      const prefix = `${rel}/`;
      const known = db
        .select({ path: hubFiles.path })
        .from(hubFiles)
        .where(
          and(
            eq(hubFiles.rootId, root.id),
            eq(hubFiles.deleted, false),
            rel === ""
              ? undefined
              : sql`(${hubFiles.path} = ${rel} OR substr(${hubFiles.path}, 1, ${prefix.length}) = ${prefix})`,
          ),
        )
        .all()
        .map((r) => r.path);
      for (const path of new Set([...disk, ...known])) await refresh(root, base, path);
    },

    /** The hub roots' files changed after `since` that `user` sees (see `hubChangesSchema`). */
    changes(user: Rights | undefined, since: number, limit: number): HubChanges {
      const rows = db
        .select()
        .from(hubFiles)
        .where(and(gt(hubFiles.seq, since), since === 0 ? eq(hubFiles.deleted, false) : undefined))
        .orderBy(asc(hubFiles.seq))
        .limit(limit)
        .all();
      const rules = new Map(hubRoots(db).map((r) => [r.id, accessIn(user, r)]));
      const files: HubChanges["files"] = [];
      for (const { rootId, path, size, sha256, version, deleted } of rows) {
        const access = rules.get(rootId)?.access(path) ?? "none";
        if (access !== "none") files.push({ rootId, path, size, sha256, version, deleted, access });
      }
      return { cursor: rows.at(-1)?.seq ?? since, more: rows.length === limit, files };
    },

    /** A file to send, checked against the disk first: its stream, sha256 and version. */
    async download(user: Rights | undefined, root: Root, path: string) {
      partsOf(path);
      const base = await baseOf(root);
      const row = accessIn(user, root).access(path) !== "none" && (await refresh(root, base, path));
      const abs = row && !row.deleted && (await inRoot(base, path));
      if (!row || !abs) throw new HttpError(404, "not_found", "File not found");
      return { stream: createReadStream(abs), sha256: row.sha256, version: row.version };
    },

    /**
     * An upload from `deviceId` that started from version `base` (0 = new). Streamed to a hidden
     * temp file next to the target and checked against `sha256`; then, one at a time per path:
     * the same bytes as the hub's → unchanged; the hub has no file there or is still at `base` →
     * the next version; else it is kept as a conflict copy beside it and an alert is raised.
     */
    async upload(
      user: Rights | undefined,
      deviceId: string,
      root: Root,
      path: string,
      base: number,
      sha256: string,
      body: Readable,
    ): Promise<HubUploadResult> {
      const parts = partsOf(path);
      assertEdit(user, root, path);
      const rootBase = await baseOf(root);
      const dir = await parentOf(rootBase, parts);
      const name = parts.at(-1) ?? "";
      const part = join(dir, `.${name}.${randomUUID()}.part`);
      try {
        const got = await writeHashed(
          body,
          part,
          FILE_CAP_BYTES,
          new HttpError(413, "file_too_large", "The file is too large"),
        );
        if (got !== sha256) throw new HttpError(400, "bad_hash", "The file arrived damaged");
        return await serial(keyOf(root, path), async () => {
          const row = await refreshNow(root, rootBase, path);
          const live = row && !row.deleted ? row : undefined;
          if (live?.sha256 === sha256) return { status: "unchanged", version: live.version };
          if (!live || live.version === base) {
            await os(rename(part, join(dir, name)));
            const next = await refreshNow(root, rootBase, path);
            return { status: "updated", version: next?.version ?? 0 };
          }
          const device =
            db.select({ name: devices.name }).from(devices).where(eq(devices.id, deviceId)).get()
              ?.name ?? "device";
          const at = new Date();
          let copy = "";
          for (let n = 1; ; n++) {
            copy = posix.join(posix.dirname(path), conflictName(name, device, at, n));
            if (!(await stat(join(dir, posix.basename(copy))).catch(() => null))) break;
          }
          await os(rename(part, join(dir, posix.basename(copy))));
          const kept = await refresh(root, rootBase, copy);
          const project = accessIn(user, root).projectOf(path);
          if (kept)
            raise(db, {
              kind: "hub_conflict",
              severity: "warning",
              module: "hub",
              task: `hub:${root.id}`,
              entityType: "hub_file",
              entityId: kept.id,
              context: {
                ...(project && { projectId: project.id, name: project.name }),
                file: path,
                copy,
                device,
              },
            });
          return { status: "conflict", version: live.version, path: copy };
        });
      } finally {
        await rm(part, { force: true });
      }
    },

    /**
     * A device deleted its copy of version `base`: the file moves to the root's trash. 409
     * `file_changed` when the hub has another version now (the device gets that one instead).
     */
    async trash(user: Rights | undefined, root: Root, path: string, base: number) {
      partsOf(path);
      assertEdit(user, root, path);
      const rootBase = await baseOf(root);
      await serial(keyOf(root, path), async () => {
        const row = await refreshNow(root, rootBase, path);
        if (!row || row.deleted) throw new HttpError(404, "not_found", "File not found");
        if (row.version !== base)
          throw new HttpError(409, "file_changed", "The file changed on the hub");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await os(rootTrash(rootBase, path, PROJECT_TRASH_DIR, `${stamp}_sync/${path}`));
        update(row, { deleted: true, seq: nextSeq() });
      });
    },
  };
}

export type HubFiles = ReturnType<typeof createHubFiles>;
