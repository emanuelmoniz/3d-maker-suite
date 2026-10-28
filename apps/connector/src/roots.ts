import { createHash } from "node:crypto";
import { createReadStream, type FSWatcher, type ReadStream, watch } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  DEVICE_COVER_MAX,
  DEVICE_GALLERY_IMAGE_MAX,
  DEVICE_GALLERY_MAX,
  DEVICE_PREVIEW_MAX,
  DEVICE_PREVIEWS_MAX,
  type DeviceFolder,
  type DeviceRoot,
  deviceIndexResultSchema,
  deviceRootSchema,
  galleryImages,
  type HubEvent,
  PROJECT_TRASH_DIR,
} from "@3d-maker-suite/core";
import {
  discoverFolders,
  folderDigest,
  inRoot,
  isHidden,
  listFolder,
  readCover,
  readPlatePreviews,
  rootMkdir,
  rootTrash,
  scanFolder,
} from "@3d-maker-suite/host";
import { z } from "zod";

/**
 * A request to the hub's device API (`/api/hub/device/...`) with this device's token: a JSON
 * `body`, or the bytes of a `file`.
 */
export type Request = (
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    file?: { stream: ReadStream; sha256: string; mtimeMs: number };
  },
) => Promise<Response>;

/** No event on a folder for this long: look at it. */
const QUIET_MS = 1000;
/** Its file list must stay the same over this long before it is read (a copy written in place). */
const STABLE_MS = 2000;
/** A 3MF that doesn't open yet (still written, locked) is tried again this often, this many times. */
const RETRY_MS = 5000;
const RETRIES = 3;

type Live = {
  root: DeviceRoot;
  base: string;
  /** Project folders the hub has, with the digest it has. */
  sent: Map<string, string>;
  watcher?: FSWatcher;
  /** Folders with events waiting for quiet; "" = look for new and removed folders. */
  queued: Set<string>;
  timer?: NodeJS.Timeout;
  tries: Map<string, number>;
};

const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The connector's device roots (ADR-0014): on connect it sends each root's index and the folders
 * the hub wants, then watches the roots and sends a project folder again once its files are
 * stable. Nothing is queued while offline: the next connect syncs everything again, and digests
 * keep that cheap (an unchanged folder is never opened).
 */
export function createRootSync({
  request,
  log,
}: {
  request: Request;
  log: (line: string) => void;
}) {
  let live: Live[] = [];
  let run = 0;
  let error: string | undefined;
  /** One thing at a time: a sync, a folder sent. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = (job: () => Promise<unknown>) => {
    const mine = run;
    chain = chain
      .then(() => (mine === run ? job() : undefined))
      .then(
        () => {
          error = undefined;
        },
        (e) => {
          error = e instanceof Error ? e.message : String(e);
          log(`device roots: ${error}`);
        },
      );
    return chain;
  };

  async function call<T extends z.ZodType>(path: string, init: Parameters<Request>[1], out?: T) {
    const res = await request(path, init);
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path}: HTTP ${res.status}`);
    return (out ? out.parse(await res.json()) : undefined) as T extends z.ZodType
      ? z.infer<T>
      : undefined;
  }

  const dirOf = (l: Live, rel: string) => join(l.base, ...rel.split("/"));
  const digestOf = (l: Live, rel: string) =>
    folderDigest(dirOf(l, rel), l.root.maxFiles, l.root.filesDepth);

  /**
   * Scans one folder and sends it, with its plate previews, its cover (the one the project
   * picked, if listed) and its gallery's images; false when a 3MF didn't open (try again later).
   */
  async function send(l: Live, rel: string, digest: string, final = true) {
    const dir = dirOf(l, rel);
    const scan = await scanFolder(dir, null, l.root.maxFiles, l.root.filesDepth);
    if (scan.unreadable && !final) return false;
    const picked = l.root.covers[rel];
    const chosen =
      picked && scan.files.some((f) => f.path === picked && f.kind === "image") ? picked : null;
    const cover = await readCover(
      chosen ? { kind: "image", abs: join(dir, ...chosen.split("/")) } : scan.cover,
    );
    const previews = await readPlatePreviews(
      dir,
      scan.models,
      DEVICE_PREVIEW_MAX,
      DEVICE_PREVIEWS_MAX,
    );
    // The gallery's images, in file order, until the caps are used; the rest is left out.
    const gallery: DeviceFolder["gallery"] = [];
    const galleryLeftOut: string[] = [];
    let galleryBytes = 0;
    const picks = l.root.galleries[rel];
    for (const { path, size } of picks ? galleryImages({ gallery: picks, meta: scan }) : []) {
      const fits = size <= DEVICE_GALLERY_IMAGE_MAX && galleryBytes + size <= DEVICE_GALLERY_MAX;
      const data = fits && (await readFile(join(dir, ...path.split("/"))).catch(() => null));
      if (
        !data ||
        data.length > DEVICE_GALLERY_IMAGE_MAX ||
        galleryBytes + data.length > DEVICE_GALLERY_MAX
      ) {
        galleryLeftOut.push(path);
        continue;
      }
      galleryBytes += data.length;
      gallery.push({ file: path, data: data.toString("base64") });
    }
    const body: DeviceFolder = {
      rel,
      digest,
      scan: {
        files: scan.files,
        models: scan.models,
        mainFile: scan.mainFile,
        sourceUrl: scan.sourceUrl,
        hasModel: scan.hasModel,
        unreadable: scan.unreadable,
      },
      texts: scan.texts,
      cover:
        cover && cover.data.length <= DEVICE_COVER_MAX
          ? {
              ext: cover.ext as NonNullable<DeviceFolder["cover"]>["ext"],
              data: Buffer.from(cover.data).toString("base64"),
              file: chosen,
            }
          : null,
      previews: previews.map((p) => ({ ...p, data: Buffer.from(p.data).toString("base64") })),
      gallery,
      galleryLeftOut,
    };
    await call(`/roots/${l.root.id}/folders`, { method: "PUT", body });
    l.sent.set(rel, digest);
    return true;
  }

  const gone = async (l: Live, rel: string) => {
    await call(`/roots/${l.root.id}/folders?rel=${encodeURIComponent(rel)}`, { method: "DELETE" });
    l.sent.delete(rel);
  };

  /** The whole root: its index, then each folder the hub wants. */
  async function sync(l: Live) {
    if (!(await isDir(l.base)))
      return call(`/roots/${l.root.id}/index`, { method: "PUT", body: { state: "missing" } });
    const rels = await discoverFolders(l.base, l.root.projectDepth);
    const folders = await Promise.all(
      rels.map(async (rel) => ({ rel, digest: await digestOf(l, rel) })),
    );
    const { want } = await call(
      `/roots/${l.root.id}/index`,
      { method: "PUT", body: { state: "ok", folders } },
      deviceIndexResultSchema,
    );
    l.sent = new Map(folders.map((f) => [f.rel, f.digest]));
    const wanted = new Set(want);
    for (const f of folders) if (wanted.has(f.rel)) await send(l, f.rel, f.digest);
  }

  /** What the watcher saw, once quiet: changed folders, then new and removed ones. */
  async function flush(l: Live) {
    const batch = [...l.queued];
    l.queued.clear();
    for (const rel of batch.filter(Boolean)) {
      if (!(await isDir(dirOf(l, rel)))) {
        if (l.sent.has(rel)) await gone(l, rel);
        continue;
      }
      const before = await digestOf(l, rel);
      await wait(STABLE_MS);
      const digest = await digestOf(l, rel);
      if (digest !== before) {
        later(l, rel); // still being written
        continue;
      }
      if (digest === l.sent.get(rel)) continue;
      const tries = l.tries.get(rel) ?? 0;
      if (await send(l, rel, digest, tries >= RETRIES)) l.tries.delete(rel);
      else {
        l.tries.set(rel, tries + 1);
        setTimeout(() => later(l, rel), RETRY_MS).unref();
      }
    }
    if (batch.includes("")) {
      if (!(await isDir(l.base))) return sync(l);
      const rels = new Set(await discoverFolders(l.base, l.root.projectDepth));
      for (const rel of l.sent.keys()) if (!rels.has(rel)) await gone(l, rel);
      // A new folder is looked at like a changed one: once its files are stable.
      for (const rel of rels) if (!l.sent.has(rel)) later(l, rel);
    }
  }

  /** Queues a folder ("" = the root's folder list) for a look after a quiet second. */
  function later(l: Live, rel: string) {
    if (!live.includes(l)) return;
    l.queued.add(rel);
    clearTimeout(l.timer);
    l.timer = setTimeout(() => void serial(() => flush(l)), QUIET_MS);
  }

  function watchRoot(l: Live) {
    try {
      l.watcher = watch(l.base, { recursive: true }, (_, file) => {
        const path = file ? file.split(/[\\/]/).join("/") : "";
        // Both slicers save `<file>.tmp`, then rename it over the file: the rename is the event.
        if (path.split("/").some(isHidden) || /\.tmp$/i.test(path)) return;
        const folder = [...l.sent.keys()].find((k) => path === k || path.startsWith(`${k}/`));
        later(l, folder ?? "");
      });
      l.watcher.on("error", (e) => log(`watch ${l.root.path}: ${e.message}`));
    } catch (e) {
      log(`watch ${l.root.path}: ${e instanceof Error ? e.message : e}`);
    }
  }

  function stop() {
    run++;
    for (const l of live) {
      l.watcher?.close();
      clearTimeout(l.timer);
    }
    live = [];
  }

  /** Reads this device's roots from the hub, syncs each and watches it. */
  function start() {
    stop();
    const mine = run;
    return serial(async () => {
      const roots = await call("/roots", undefined, z.array(deviceRootSchema));
      for (const root of roots) {
        if (mine !== run) return;
        const base = (await realpath(root.path).catch(() => null)) ?? root.path;
        const l: Live = { root, base, sent: new Map(), queued: new Set(), tries: new Map() };
        live.push(l);
        await sync(l);
        if (mine === run && (await isDir(base))) watchRoot(l);
      }
    });
  }

  /** Answers a request of the hub with what `work` gives; an OS error goes back as its code. */
  async function answer(requestId: string, work: () => Promise<unknown>) {
    const body = await work().then(
      (result) => ({ ok: true, result }),
      (e: NodeJS.ErrnoException) => ({ ok: false, code: e.code ?? "EIO" }),
    );
    await request(`/replies/${requestId}`, { method: "POST", body }).catch(() => {});
  }

  /**
   * The real path of a root the hub asks about: only a root of this device that is synced now.
   * Every `rel` in it is checked again here (rootPath.ts): no `..`, no absolute path, no link out.
   */
  function baseOf(rootId: string) {
    const l = live.find((x) => x.root.id === rootId);
    if (!l) throw Object.assign(new Error("Not a root of this device"), { code: "ENOENT" });
    return l.base;
  }

  /** Sends a file the hub asked for: hashed first, then streamed with that hash and its mtime. */
  async function upload(requestId: string, rootId: string, rel: string) {
    try {
      const abs = await inRoot(baseOf(rootId), rel);
      const s = abs ? await stat(abs) : null;
      if (!abs || !s?.isFile()) throw Object.assign(new Error(rel), { code: "ENOENT" });
      const hash = createHash("sha256");
      await pipeline(createReadStream(abs), hash);
      const file = {
        stream: createReadStream(abs),
        sha256: hash.digest("hex"),
        mtimeMs: s.mtimeMs,
      };
      const res = await request(`/files/${requestId}`, { method: "PUT", file });
      if (!res.ok) log(`upload ${rel}: HTTP ${res.status}`);
    } catch (e) {
      log(`upload ${rel}: ${e instanceof Error ? e.message : e}`);
      await answer(requestId, () => Promise.reject(e));
    }
  }

  return {
    start,
    stop,
    /** A hub event for the roots; anything else is ignored. */
    handle(event: HubEvent) {
      if (event.type === "roots.changed") void start();
      else if (event.type === "fs.list") void answer(event.requestId, () => listFolder(event.path));
      else if (event.type === "fs.upload") void upload(event.requestId, event.rootId, event.rel);
      else if (event.type === "fs.mkdir")
        void answer(event.requestId, async () => {
          await rootMkdir(baseOf(event.rootId), event.rel);
          return null;
        });
      else if (event.type === "fs.trash")
        void answer(event.requestId, async () => ({
          path: await rootTrash(baseOf(event.rootId), event.rel, PROJECT_TRASH_DIR, event.as),
        }));
    },
    state: () => ({ watching: live.filter((l) => l.watcher).length, error }),
    /** Resolves once everything started so far is done (tests). */
    idle: () => chain,
  };
}

export type RootSync = ReturnType<typeof createRootSync>;
