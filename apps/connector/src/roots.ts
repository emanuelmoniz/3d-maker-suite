import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  type FSWatcher,
  type ReadStream,
  watch,
} from "node:fs";
import { chmod, lstat, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DEVICE_COVER_MAX,
  DEVICE_GALLERY_IMAGE_MAX,
  DEVICE_PREVIEW_MAX,
  type DeviceFolder,
  type DeviceRoot,
  deviceIndexResultSchema,
  deviceRootSchema,
  galleryImages,
  type HubEvent,
  PROJECT_TRASH_DIR,
  sharedFolderSchema,
} from "@3d-maker-suite/core";
import {
  conflictName,
  discoverFolders,
  folderDigest,
  inRoot,
  isHidden,
  listFolder,
  readCover,
  readPlatePreviews,
  relParts,
  rootMkdir,
  rootTrash,
  scanFolder,
  sha256Of,
  within,
} from "@3d-maker-suite/host";
import { z } from "zod";
import type { Store } from "./state.ts";
import { createVersions } from "./versions.ts";

/**
 * A request to the hub's device API (`/api/hub/device/...`) with this device's token: a JSON
 * `body`, or the bytes of a `file`.
 */
export type Request = (
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    /** A file upload; `sha256` and `mtimeMs` go along as headers when given. */
    file?: { stream: ReadStream; sha256?: string; mtimeMs?: number };
    /** A download: it may take as long as an upload. */
    long?: boolean;
  },
) => Promise<Response>;

/** No event on a folder for this long: look at it. */
export const QUIET_MS = 1000;
/** Its file list must stay the same over this long before it is read (a copy written in place). */
export const STABLE_MS = 2000;
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
 *
 * The hub keeps the shared folders (ADR-0021; `sharedFolders` in the store, `folders.set`): a
 * root outside the unpaused ones isn't synced, watched or served, only reported "unshared". The
 * hub lists any folder on the disk (names only) to pick them.
 */
export function createRootSync({
  request,
  log,
  store,
  dataDir,
}: {
  request: Request;
  log: (line: string) => void;
  store: Store;
  /** Where earlier versions of uploaded files are kept; none without one. */
  dataDir?: string;
}) {
  let live: Live[] = [];
  const versions = dataDir ? createVersions(join(dataDir, "versions")) : null;
  /** This device's roots from the hub, each with its real path (`path` while it's missing). */
  async function fetchRoots() {
    const roots = await call("/roots", undefined, z.array(deviceRootSchema));
    const found = await Promise.all(
      roots.map(async (root) => ({
        root,
        base: (await realpath(root.path).catch(() => null)) ?? root.path,
      })),
    );
    return found;
  }
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

  /**
   * Files' hashes by real path, read again only when size or mtime changed. ponytail: in memory
   * only, and a gone file's entry stays until a restart (after one the hub asks only for changed
   * folders).
   */
  const hashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  async function hashOf(abs: string, size: number, mtimeMs: number) {
    const h = hashes.get(abs);
    if (h && h.size === size && h.mtimeMs === mtimeMs) return h.sha256;
    const sha256 = await sha256Of(abs).catch(() => null);
    if (sha256) hashes.set(abs, { size, mtimeMs, sha256 });
    return sha256;
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
    // The request fills a budget (`deviceFolderMaxMb`), in order: scan and docs, cover, gallery
    // picks, plate previews. What doesn't fit is left out.
    // Each file's hash (an upload over it sends it back as its base) and the versions kept of it.
    const files: DeviceFolder["scan"]["files"] = [];
    for (const f of scan.files) {
      const abs = join(dir, ...f.path.split("/"));
      const sha256 = f.kind === "shortcut" ? null : await hashOf(abs, f.size, f.mtime ?? 0);
      const kept = (await versions?.list(l.root.id, `${rel}/${f.path}`)) ?? [];
      files.push({ ...f, ...(sha256 && { sha256 }), ...(kept.length && { versions: kept }) });
    }
    const body: DeviceFolder = {
      rel,
      digest,
      scan: {
        files,
        models: scan.models,
        mainFile: scan.mainFile,
        sourceUrl: scan.sourceUrl,
        hasModel: scan.hasModel,
        unreadable: scan.unreadable,
      },
      texts: scan.texts,
      cover: null,
      previews: [],
      gallery: [],
      galleryLeftOut: [],
    };
    // Bytes in the request: base64 plus a little for each item's JSON.
    const cost = (n: number) => Math.ceil(n / 3) * 4 + 256;
    let left = l.root.folderMaxMb * 1024 * 1024 - Buffer.byteLength(JSON.stringify(body));

    const cover = await readCover(
      chosen ? { kind: "image", abs: join(dir, ...chosen.split("/")) } : scan.cover,
    );
    if (cover && cover.data.length <= DEVICE_COVER_MAX && cost(cover.data.length) <= left) {
      left -= cost(cover.data.length);
      body.cover = {
        ext: cover.ext as NonNullable<DeviceFolder["cover"]>["ext"],
        data: Buffer.from(cover.data).toString("base64"),
        file: chosen,
      };
    }

    const picks = l.root.galleries[rel];
    for (const { path, size } of picks ? galleryImages({ gallery: picks, meta: scan }) : []) {
      const fits = size <= DEVICE_GALLERY_IMAGE_MAX && cost(size) <= left;
      const data = fits && (await readFile(join(dir, ...path.split("/"))).catch(() => null));
      if (!data || data.length > DEVICE_GALLERY_IMAGE_MAX || cost(data.length) > left) {
        body.galleryLeftOut.push(path);
        continue;
      }
      left -= cost(data.length);
      body.gallery.push({ file: path, data: data.toString("base64") });
    }

    // readPlatePreviews counts raw bytes; 0.7 covers base64 (0.75) and each item's JSON.
    const previews = await readPlatePreviews(
      dir,
      scan.models,
      DEVICE_PREVIEW_MAX,
      Math.max(0, Math.floor(left * 0.7)),
    );
    body.previews = previews.map((p) => ({ ...p, data: Buffer.from(p.data).toString("base64") }));
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

  function halt() {
    run++;
    for (const l of live) {
      l.watcher?.close();
      clearTimeout(l.timer);
    }
    live = [];
  }

  /** The folders the hub may use: the unpaused ones, none while Share to the hub is off. */
  const shared = () =>
    store.get().shareProjects === false
      ? []
      : (store.get().sharedFolders ?? []).filter((f) => !f.paused).map((f) => f.path);

  /**
   * On connect: its own list goes to the hub, which keeps it only while it has none (an update
   * from a connector that kept them itself), and answers with the list it keeps. Unreachable: the
   * saved list stays.
   */
  async function reportFolders() {
    const s = store.get();
    const mine = s.sharedFolders ?? (s.folders ?? []).map((path) => ({ path, paused: false }));
    const kept = await call("/folders", { method: "PUT", body: mine }, z.array(sharedFolderSchema));
    store.set({ sharedFolders: kept, folders: undefined });
  }

  /**
   * Reads this device's roots from the hub, syncs each shared one and watches it; on connect
   * (`report`) its shared folders are settled with the hub first.
   */
  function start(report = false) {
    halt();
    const mine = run;
    return serial(async () => {
      if (report) await reportFolders().catch((e) => log(`shared folders: ${e.message ?? e}`));
      const roots = await fetchRoots();
      if (mine !== run) return;
      // Real paths, as the roots' are: a link or another spelling covers the same folder.
      const folders = await Promise.all(shared().map((p) => realpath(p).catch(() => p)));
      for (const { root, base } of roots) {
        if (mine !== run) return;
        if (!within(folders, base)) {
          await call(`/roots/${root.id}/index`, { method: "PUT", body: { state: "unshared" } });
          continue;
        }
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

  /**
   * Sends a file the hub asked for (or a `version` of it kept here): hashed first, then streamed
   * with that hash and its mtime.
   */
  async function upload(requestId: string, rootId: string, rel: string, version?: number) {
    try {
      const base = baseOf(rootId);
      relParts(rel);
      const abs = version ? await versions?.path(rootId, rel, version) : await inRoot(base, rel);
      const s = abs ? await stat(abs) : null;
      if (!abs || !s?.isFile()) throw Object.assign(new Error(rel), { code: "ENOENT" });
      const sha256 = await sha256Of(abs);
      const file = { stream: createReadStream(abs), sha256, mtimeMs: s.mtimeMs };
      const res = await request(`/files/${requestId}`, { method: "PUT", file });
      if (!res.ok) log(`upload ${rel}: HTTP ${res.status}`);
    } catch (e) {
      log(`upload ${rel}: ${e instanceof Error ? e.message : e}`);
      await answer(requestId, () => Promise.reject(e));
    }
  }

  /** Per path, one write at a time: the check against `base` and the rename belong together. */
  const writing = new Map<string, Promise<unknown>>();
  const fail = (message: string, code: string) => Object.assign(new Error(message), { code });

  /**
   * Writes a web upload into a root (`fs.write`): the bytes come from the hub into a hidden part
   * file beside the target, checked against their hash. The file there is still `base` (or there
   * is none): the old one is kept as a version (`keep`), the part renamed over it. Else the part
   * becomes a conflict copy beside it, named after `by`. A link out of the root stays out.
   */
  async function write(e: Extract<HubEvent, { type: "fs.write" }>) {
    const base = baseOf(e.rootId);
    const parts = relParts(e.rel);
    const name = parts.at(-1) ?? "";
    const parent = parts.slice(0, -1).join("/");
    const dir = parent ? await inRoot(base, parent) : base;
    if (!dir || !(await isDir(dir))) throw fail(e.rel, "ENOENT");
    const part = join(dir, `.${name}.${randomUUID()}.part`);
    try {
      const res = await request(`/files/${e.requestId}`, { long: true });
      if (!res.ok || !res.body) throw fail(`HTTP ${res.status}`, "EIO");
      const hash = createHash("sha256");
      await pipeline(
        Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
        async function* (src: AsyncIterable<Buffer>) {
          for await (const chunk of src) {
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(part),
      );
      if (hash.digest("hex") !== e.sha256) throw fail("wrong hash", "EIO");

      const key = `${e.rootId}\0${e.rel}`;
      const run = (writing.get(key) ?? Promise.resolve()).then(async () => {
        const target = join(dir, name);
        const st = await lstat(target).catch(() => null);
        // A folder (or a link) there is never replaced.
        if (st && !st.isFile()) throw fail(e.rel, "EEXIST");
        const fresh = !st || (e.base !== null && (await sha256Of(target)) === e.base);
        if (fresh) {
          if (st && e.keep > 0 && versions) await versions.keep(e.rootId, e.rel, target, e.keep);
          // A file can't be renamed over on Windows while it is read-only.
          if (st) await chmod(target, 0o644).catch(() => {});
          await rename(part, target);
          return { status: "updated" as const, path: e.rel };
        }
        const at = new Date();
        for (let n = 1; ; n++) {
          const copy = conflictName(name, e.by, at, n);
          if (await lstat(join(dir, copy)).catch(() => null)) continue;
          await rename(part, join(dir, copy));
          return { status: "conflict" as const, path: [...parts.slice(0, -1), copy].join("/") };
        }
      });
      const tail = run.catch(() => {});
      writing.set(key, tail);
      void tail.then(() => writing.get(key) === tail && writing.delete(key));
      return await run;
    } finally {
      await rm(part, { force: true });
    }
  }

  return {
    start,
    stop: halt,
    /** A hub event for the roots; anything else is ignored. */
    handle(event: HubEvent) {
      if (event.type === "roots.changed" || event.type === "folders.set") void start();
      // Folders anywhere, names only, to pick the shared ones (ADR-0021); every other file
      // operation stays inside them.
      else if (event.type === "fs.list")
        void answer(event.requestId, () => listFolder(event.path, "folder"));
      else if (event.type === "fs.upload")
        void upload(event.requestId, event.rootId, event.rel, event.version);
      else if (event.type === "fs.write") void answer(event.requestId, () => write(event));
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
