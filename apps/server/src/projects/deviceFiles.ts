import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, rename, rm, stat, utimes } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Readable } from "node:stream";
import type { DeviceFolder } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { writeHashed } from "./hubFiles.ts";

const { deviceRootFolders } = schema;
type Root = typeof schema.roots.$inferSelect;
type Sent = Omit<DeviceFolder, "cover" | "previews" | "gallery">;

/** A pulled file is kept this long after its last use; all of them together at most this much. */
const EXPIRY_MS = 60 * 60_000;
const CAP_BYTES = 10 * 1024 ** 3;
/** The device hashes a file before it sends it: time to start. */
const START_MS = 60_000;
const SWEEP_MS = 10 * 60_000;

/** A new folder's place in the index until its device sends the real scan (another digest). */
const empty = (rel: string): Sent => ({
  rel,
  digest: "",
  scan: { files: [], models: [], mainFile: null, sourceUrl: null, hasModel: false, unreadable: 0 },
  texts: {},
  galleryLeftOut: [],
});

/**
 * The files of device roots on the hub (ADR-0014): a file is pulled from its connector only when
 * the hub needs it (slicing, download, the 3D view) into a temp cache in `dir`, kept by root, path,
 * size and mtime (a changed file is pulled again), with an expiry and a size cap. Folders are made
 * and trashed by the connector, inside its root. One per app.
 */
export function createDeviceFiles(db: Db, channel: HubChannel, dir: string) {
  // Left from the last run: nothing knows those files any more.
  rmSync(dir, { recursive: true, force: true });
  const cached = new Map<string, { path: string; size: number; usedAt: number }>();
  const pulling = new Map<string, Promise<string>>();
  /** Requests waiting for a file: where it goes. */
  const incoming = new Map<string, string>();

  /** A file of the root as its device's last scan lists it (only those are ever pulled). */
  function listed(root: Root, rel: string) {
    const folders = db
      .select({ folder: deviceRootFolders.folder, scan: deviceRootFolders.scan })
      .from(deviceRootFolders)
      .where(eq(deviceRootFolders.rootId, root.id))
      .all();
    for (const { folder, scan } of folders)
      if (rel.startsWith(`${folder}/`)) {
        const path = rel.slice(folder.length + 1);
        const file = (scan as Sent).scan.files.find((f) => f.path === path);
        if (file) return file;
      }
    return undefined;
  }

  /** Drops what expired, then the least recently used until the rest fits the cap. */
  function sweep(now = Date.now()) {
    let total = 0;
    for (const e of cached.values()) total += e.size;
    for (const [key, e] of [...cached].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
      if (now - e.usedAt < EXPIRY_MS && total <= CAP_BYTES) break;
      cached.delete(key);
      total -= e.size;
      void rm(e.path, { force: true });
    }
  }
  const timer = setInterval(sweep, SWEEP_MS).unref();

  async function download(root: Root, rel: string, key: string) {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${key}${extname(rel).toLowerCase()}`);
    let requestId: string | undefined;
    try {
      await channel.ask(
        root.location,
        (id) => {
          requestId = id;
          incoming.set(id, path);
          return { type: "fs.upload", requestId: id, rootId: root.id, rel };
        },
        z.null(),
        { ms: START_MS },
      );
    } finally {
      if (requestId) incoming.delete(requestId);
    }
    cached.set(key, { path, size: (await stat(path)).size, usedAt: Date.now() });
    sweep();
    return path;
  }

  return {
    /**
     * A local copy of a file in a device root (`rel`: root-relative), pulled now unless the cache
     * has it; null when the device's last scan doesn't list it. 409 `device_offline` when its
     * device isn't connected.
     */
    async pull(root: Root, rel: string) {
      const file = listed(root, rel);
      if (!file) return null;
      const key = createHash("sha256")
        .update(JSON.stringify([root.id, rel, file.size, file.mtime ?? null]))
        .digest("hex");
      const hit = cached.get(key);
      if (hit && (await stat(hit.path).catch(() => null))) {
        hit.usedAt = Date.now();
        return hit.path;
      }
      let p = pulling.get(key);
      if (!p) {
        p = download(root, rel, key).finally(() => pulling.delete(key));
        pulling.set(key, p);
      }
      return p;
    },

    /**
     * The bytes of a file a request waits for (`PUT /api/hub/device/files/:requestId`): written to a
     * part file, checked against the device's sha256, then put in place with the device's mtime.
     */
    async receive(
      deviceId: string,
      requestId: string,
      body: Readable,
      sha256: string,
      mtimeMs: number | undefined,
    ) {
      const path = incoming.get(requestId);
      const w = path && channel.claim(deviceId, requestId);
      if (!path || !w) throw new HttpError(404, "not_found", "Nothing waits for this file");
      const part = `${path}.${randomUUID()}.part`;
      try {
        const got = await writeHashed(
          body,
          part,
          CAP_BYTES,
          new HttpError(413, "file_too_large", "The file is larger than the cache"),
        );
        if (got !== sha256) throw new HttpError(502, "device_bad_file", "The file arrived damaged");
        // Its mtime on the device: what slicing fingerprints from here matches its scan.
        if (mtimeMs !== undefined) await utimes(part, new Date(), mtimeMs / 1000);
        await rename(part, path);
        w.done({ ok: true, result: null });
      } catch (e) {
        await rm(part, { force: true });
        w.fail(
          e instanceof HttpError
            ? e
            : new HttpError(502, "device_bad_file", "The file didn't arrive"),
        );
        throw e;
      }
    },

    /** Makes a folder in a device root; a new project folder is in its index at once. */
    async mkdir(root: Root, rel: string, error: (err: NodeJS.ErrnoException) => Error) {
      await channel.ask(
        root.location,
        (requestId) => ({ type: "fs.mkdir", requestId, rootId: root.id, rel }),
        z.null(),
        { error },
      );
      db.insert(deviceRootFolders)
        .values({
          rootId: root.id,
          folder: rel,
          digest: "",
          scan: empty(rel),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .run();
    },

    /** Moves `rel` to the device root's trash; returns where it went on the device. */
    async trash(root: Root, rel: string, as: string) {
      const { path } = await channel.ask(
        root.location,
        (requestId) => ({ type: "fs.trash", requestId, rootId: root.id, rel, as }),
        z.object({ path: z.string() }),
      );
      // Gone from the index now; the device's own report follows.
      db.delete(deviceRootFolders)
        .where(and(eq(deviceRootFolders.rootId, root.id), eq(deviceRootFolders.folder, rel)))
        .run();
      return path;
    },

    close() {
      clearInterval(timer);
      cached.clear();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type DeviceFiles = ReturnType<typeof createDeviceFiles>;
