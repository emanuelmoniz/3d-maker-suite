import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  type FSWatcher,
  renameSync,
  type Stats,
  watch,
  writeFileSync,
} from "node:fs";
import { chmod, mkdir, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type DeviceSyncMode,
  type DeviceSyncState,
  type HubChanges,
  type HubEvent,
  type HubLockMode,
  hubChangesSchema,
  hubSyncRootsSchema,
  hubUploadResultSchema,
} from "@3d-maker-suite/core";
import { inRoot, relParts, syncSkipped } from "@3d-maker-suite/host";
import { QUIET_MS, type Request, STABLE_MS } from "./roots.ts";

/**
 * One synced file: the hub version this copy is, and the local stat it had then. `mine`: this
 * device has it checked out.
 */
type Entry = {
  version: number;
  sha256: string;
  size: number;
  mtimeMs: number;
  readOnly: boolean;
  mine?: boolean;
};
/**
 * `<dataDir>/sync.json`. `link`: the hub and device it belongs to (another one starts over);
 * `roots`: each hub root's folder name in the sync folder; `files` by `<rootId>/<path>`;
 * `locks`: the hub's lock mode as of the last connect; `opened`: the pid of the slicer a file
 * was opened in, by key, so its exit releases the lock even after a restart of the connector.
 */
type Saved = {
  link: string;
  roots: Record<string, string>;
  files: Record<string, Entry>;
  locks?: HubLockMode;
  opened?: Record<string, number>;
};
type Live = { id: string; name: string; base: string };
type Change = HubChanges["files"][number];

/** A pull that failed somewhere is tried again this much later, from the same cursor. */
const RETRY_MS = 30_000;
/** The state goes to the hub this long after it last changed. */
const REPORT_MS = 2000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileStat = (abs: string | null) =>
  abs
    ? stat(abs).then(
        (s) => (s.isFile() ? s : null),
        () => null,
      )
    : Promise.resolve(null);
const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false;
const same = (e: Entry | undefined, s: Stats | null) =>
  !!e && !!s && e.size === s.size && e.mtimeMs === s.mtimeMs;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function sha256Of(abs: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(abs), hash);
  return hash.digest("hex");
}
/** A file can't be renamed over or deleted on Windows while it is read-only. */
const writable = (abs: string) => chmod(abs, 0o644).catch(() => {});
/** A slicer that is gone this soon after it started handed the file to one already running. */
const HANDOFF_MS = 2000;
/** How often the slicers files were opened in are checked. */
const OPENED_POLL_MS = 5000;
/** The process runs (EPERM: it does, as another user). */
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A root's name as a folder name: no characters an OS refuses, not hidden, never empty. */
export function folderName(name: string, taken: string[]) {
  const base =
    name
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, "-")
      .replace(/^[. ]+|[. ]+$/g, "")
      .trim() || "Root";
  const used = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const pick = n === 1 ? base : `${base} (${n})`;
    if (!used.has(pick.toLowerCase())) return pick;
  }
}

/**
 * The sync of the hub roots (ADR-0014): each one is a folder in `syncDir`. On connect: a full
 * listing from the hub (pull), then every local change since (push). Then the hub's
 * `sync.changed` pulls from the cursor, and the watcher pushes a path once it is quiet and stable.
 * Only versions and hashes are compared with the hub; size and mtime only with this disk.
 * ponytail: one queue, so a big download holds up uploads; a rename uploads the bytes again;
 * the whole state file is rewritten (at most once a second).
 */
export function createHubSync({
  request,
  dataDir,
  syncDir,
  identity,
  log,
  alive = isAlive,
  handoffMs = HANDOFF_MS,
  pollMs = OPENED_POLL_MS,
}: {
  request: Request;
  dataDir: string;
  syncDir: string;
  /** The hub URL and device id: a state file of another pairing starts over. */
  identity: () => string;
  log: (line: string) => void;
  /** Whether a slicer's process still runs, and the timings around it (tests). */
  alive?: (pid: number) => boolean;
  handoffMs?: number;
  pollMs?: number;
}) {
  const file = join(dataDir, "sync.json");
  let saved: Saved = { link: "", roots: {}, files: {} };
  let loaded = false;
  let changed = false;
  let savedAt = 0;
  const persist = (force = false) => {
    if (!changed || (!force && Date.now() - savedAt < 1000)) return;
    writeFileSync(`${file}.tmp`, JSON.stringify(saved));
    renameSync(`${file}.tmp`, file);
    changed = false;
    savedAt = Date.now();
  };
  const set = (key: string, e: Entry | undefined) => {
    if (e) saved.files[key] = e;
    else delete saved.files[key];
    changed = true;
    persist();
  };

  let live = new Map<string, Live>();
  let mode: DeviceSyncMode = "all";
  let guard = Number.POSITIVE_INFINITY;
  let cursor = 0;
  let run = 0;
  let watcher: FSWatcher | undefined;
  let error: string | null = null;
  /** Local deletes the guard holds back, per root: the paths. */
  const held = new Map<string, string[]>();
  /** Uploads the hub refused (download-only), by key: the bytes it refused. */
  const refused = new Map<string, string>();
  const queued = new Map<string, Set<string>>();
  let quiet: NodeJS.Timeout | undefined;
  let retry: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  let jobs = 0;

  let reported = "";
  let report: NodeJS.Timeout | undefined;
  const state = (): DeviceSyncState => ({
    state: held.size ? "paused" : jobs ? "syncing" : error ? "error" : "idle",
    files: Object.keys(saved.files).filter((k) => live.has(k.slice(0, k.indexOf("/")))).length,
    pending: jobs + [...queued.values()].reduce((n, s) => n + s.size, 0),
    held: [...held].map(([rootId, paths]) => ({
      rootId,
      name: live.get(rootId)?.name ?? "",
      files: paths.length,
    })),
    error,
  });
  const changedState = () => {
    clearTimeout(report);
    report = setTimeout(() => {
      const body = state();
      const json = JSON.stringify(body);
      if (json === reported) return;
      request("/sync/state", { method: "PUT", body }).then(
        (res) => {
          if (res.ok) reported = json;
        },
        () => {},
      );
    }, REPORT_MS);
    report.unref();
  };

  let chain: Promise<unknown> = Promise.resolve();
  const serial = (job: () => Promise<unknown>) => {
    const mine = run;
    jobs++;
    changedState();
    chain = chain
      .then(() => (mine === run ? job() : undefined))
      .then(
        () => {
          error = null;
        },
        (e) => {
          error = message(e).slice(0, 200);
          log(`sync: ${error}`);
        },
      )
      .finally(() => {
        jobs--;
        persist(true);
        changedState();
      });
    return chain;
  };

  async function call(path: string, init?: Parameters<Request>[1]) {
    const res = await request(path, init);
    if (!res.ok && res.status !== 404 && res.status !== 403 && res.status !== 409)
      throw new Error(`${init?.method ?? "GET"} ${path.split("?")[0]}: HTTP ${res.status}`);
    return res;
  }
  const fileUrl = (rootId: string, path: string, base?: number) =>
    `/sync/roots/${rootId}/file?path=${encodeURIComponent(path)}${base === undefined ? "" : `&base=${base}`}`;
  const keyOf = (rootId: string, path: string) => `${rootId}/${path}`;
  const rootOf = (key: string) => key.slice(0, key.indexOf("/"));
  const pathOf = (key: string) => key.slice(key.indexOf("/") + 1);
  /** Synced paths only: valid, nothing hidden or temporary. */
  const syncable = (path: string) => {
    try {
      const parts = relParts(path);
      return parts.length > 0 && !parts.some(syncSkipped);
    } catch {
      return false;
    }
  };

  /** Makes the folders above `path` inside the root; the real path of the last one. */
  async function parentOf(l: Live, path: string) {
    const parts = relParts(path).slice(0, -1);
    await mkdir(join(l.base, ...parts), { recursive: true });
    // A link out of the root stays out.
    const dir = await inRoot(l.base, parts.join("/"));
    if (!dir) throw new Error(`${path}: outside the sync folder`);
    return dir;
  }

  /**
   * The hub's copy of `path` into place: a hidden temp file next to it, its hash checked, then
   * renamed over the local file, unless that changed meanwhile (`before`): then it is left for
   * the push.
   */
  async function download(
    l: Live,
    path: string,
    readOnly: boolean,
    before: Stats | null,
    mine = false,
  ) {
    const res = await call(fileUrl(l.id, path), { long: true });
    if (!res.ok || !res.body) return; // gone or hidden meanwhile: the feed says so next
    const name = relParts(path).at(-1) ?? "";
    const dir = await parentOf(l, path);
    const abs = join(dir, name);
    const part = join(dir, `.${name}.${randomUUID()}.part`);
    try {
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
      const sha256 = hash.digest("hex");
      if (sha256 !== res.headers.get("x-file-sha256")) throw new Error(`${path}: arrived damaged`);
      const now = await fileStat(abs);
      if (before ? !now || now.size !== before.size || now.mtimeMs !== before.mtimeMs : now) return; // changed here meanwhile
      if (now) await writable(abs);
      await rename(part, abs);
      if (readOnly) await chmod(abs, 0o444);
      const s = await stat(abs);
      const version = Number(res.headers.get("x-file-version"));
      set(keyOf(l.id, path), { version, sha256, size: s.size, mtimeMs: s.mtimeMs, readOnly, mine });
    } finally {
      await rm(part, { force: true });
    }
  }

  /** The local copy of a file the hub deleted (or no longer shows): gone, unless changed here. */
  async function goneOnHub(l: Live, path: string) {
    const key = keyOf(l.id, path);
    const abs = await inRoot(l.base, path).catch(() => null);
    const s = await fileStat(abs);
    if (abs && s && !same(saved.files[key], s)) return; // changed here: the push sends it again
    if (abs && s) {
      await writable(abs);
      await rm(abs, { force: true });
    }
    set(key, undefined);
  }

  /** One file of the hub's listing against the local copy and the state. */
  async function apply(l: Live, f: Change) {
    if (!syncable(f.path)) return;
    const key = keyOf(l.id, f.path);
    const e = saved.files[key];
    if (f.deleted) return goneOnHub(l, f.path);
    // Read-only also while another device has it checked out.
    const readOnly = f.access === "read";
    const mine = f.lock === "mine";
    const abs = await inRoot(l.base, f.path).catch(() => null);
    const s = await fileStat(abs);
    if (!abs || !s) {
      // Deleted here, and the hub has nothing newer: the push sends the delete.
      if (e && e.version >= f.version) return;
      return download(l, f.path, readOnly, null, mine);
    }
    if (same(e, s) && e) {
      if (e.version !== f.version) return download(l, f.path, readOnly, s, mine);
      if (e.readOnly !== readOnly || !!e.mine !== mine) {
        if (e.readOnly !== readOnly) await chmod(abs, readOnly ? 0o444 : 0o644);
        const now = await stat(abs);
        set(key, { ...e, readOnly, mine, size: now.size, mtimeMs: now.mtimeMs });
      }
      return;
    }
    // Not in the state (a first sync, a lost state file) or changed here: the same bytes are adopted,
    // other bytes are left for the push (the hub keeps a conflict copy if it has moved on).
    const sha256 = await sha256Of(abs);
    if (sha256 !== f.sha256) return;
    if (readOnly !== !!e?.readOnly) await chmod(abs, readOnly ? 0o444 : 0o644);
    const now = await stat(abs);
    set(key, { version: f.version, sha256, size: now.size, mtimeMs: now.mtimeMs, readOnly, mine });
  }

  /**
   * The hub's changes since the cursor (`full`: everything, which also drops files it no longer
   * shows). The cursor moves only when every change was applied; otherwise it's tried again.
   */
  async function pull(full: boolean) {
    clearTimeout(retry);
    let since = full ? 0 : cursor;
    let failed = false;
    let unknown = false;
    const seen = new Set<string>();
    const missing = new Set<string>();
    for (const l of live.values()) if (!(await isDir(l.base))) missing.add(l.id);
    for (;;) {
      const res = await call(`/sync/changes?since=${since}`);
      if (!res.ok) throw new Error(`changes: HTTP ${res.status}`);
      const page = hubChangesSchema.parse(await res.json());
      for (const f of page.files) {
        const l = live.get(f.rootId);
        if (!l) unknown = true;
        seen.add(keyOf(f.rootId, f.path));
        if (!l || missing.has(l.id)) continue; // a missing folder waits for confirm or restore
        await apply(l, f).catch((e) => {
          failed = true;
          log(`sync ${f.path}: ${message(e)}`);
        });
      }
      since = page.cursor;
      if (!page.more) break;
    }
    if (full)
      for (const key of Object.keys(saved.files)) {
        const l = live.get(rootOf(key));
        if (l && !missing.has(l.id) && !seen.has(key))
          await goneOnHub(l, pathOf(key)).catch(() => {
            failed = true;
          });
      }
    if (failed) {
      retry = setTimeout(() => void serial(() => pull(full)), RETRY_MS);
      retry.unref();
      throw new Error("some files didn't sync; trying again");
    }
    cursor = since;
    // A hub root added since the connect.
    if (unknown) void start();
  }

  /** The files below `scope` ("" = the whole root) on disk, with their stat. */
  async function walk(l: Live, scope: string) {
    const out = new Map<string, Stats>();
    const visit = async (abs: string, at: string): Promise<void> => {
      for (const d of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
        if (syncSkipped(d.name)) continue;
        const path = at ? `${at}/${d.name}` : d.name;
        if (d.isDirectory()) await visit(join(abs, d.name), path);
        else if (d.isFile()) {
          const s = await fileStat(join(abs, d.name));
          if (s) out.set(path, s);
        }
      }
    };
    const abs = scope ? await inRoot(l.base, scope).catch(() => null) : l.base;
    const s = abs ? await stat(abs).catch(() => null) : null;
    if (abs && s?.isDirectory()) await visit(abs, scope);
    else if (abs && s?.isFile()) out.set(scope, s);
    return out;
  }

  /** Uploads one changed file; the outcome goes into the state. */
  async function upload(l: Live, path: string, s: Stats, sha256: string) {
    const key = keyOf(l.id, path);
    const e = saved.files[key];
    const res = await call(fileUrl(l.id, path, e?.version ?? 0), {
      method: "PUT",
      file: {
        stream: createReadStream(join(l.base, ...relParts(path))),
        sha256,
        mtimeMs: s.mtimeMs,
      },
    });
    if (res.status === 403) {
      refused.set(key, sha256);
      throw new Error(`${path}: download-only for you, your changes stay on this device`);
    }
    if (res.status === 404) return;
    if (res.status === 400) return later(l.id, path); // changed while it was sent
    const r = hubUploadResultSchema.parse(await res.json());
    if (r.status === "conflict") {
      // Ours is on the hub now as `r.path`; this copy becomes the hub's version (still read-only
      // while another device has it checked out).
      log(`sync ${path}: conflict, kept as ${r.path}`);
      set(key, undefined);
      return download(l, path, !!e?.readOnly, s);
    }
    // Read-only here since strict mode went offline: it's ours to edit again.
    if (e?.readOnly) await writable(join(l.base, ...relParts(path)));
    // With locks on, the hub checked the file out to this device.
    const mine = (saved.locks ?? "off") !== "off";
    set(key, {
      version: r.version,
      sha256,
      size: s.size,
      mtimeMs: s.mtimeMs,
      readOnly: false,
      mine,
    });
  }

  /**
   * Local changes below the scopes ("" = the whole root) to the hub: new and changed files once
   * stable, then deletes. A delete whose bytes were just uploaded elsewhere is a rename and isn't
   * counted; more deletes than the guard, or a missing root folder, are held back.
   */
  async function push(l: Live, scopes: string[]) {
    const inScope = (path: string) =>
      scopes.some((s) => s === "" || path === s || path.startsWith(`${s}/`));
    const rootGone = !(await isDir(l.base));
    const disk = new Map<string, Stats>();
    if (!rootGone) for (const s of scopes) for (const [p, st] of await walk(l, s)) disk.set(p, st);

    const changes = [...disk].filter(([p, s]) => !same(saved.files[keyOf(l.id, p)], s));
    if (changes.length) await wait(STABLE_MS);
    const sent = new Set<string>();
    for (const [path, s] of changes) {
      const key = keyOf(l.id, path);
      const now = await fileStat(await inRoot(l.base, path).catch(() => null));
      if (!now) continue;
      if (now.size !== s.size || now.mtimeMs !== s.mtimeMs) {
        later(l.id, path); // still being written
        continue;
      }
      const sha256 = await sha256Of(join(l.base, ...relParts(path))).catch(() => null);
      if (!sha256) {
        later(l.id, path); // doesn't open yet
        continue;
      }
      sent.add(sha256);
      const e = saved.files[key];
      if (e?.sha256 === sha256) set(key, { ...e, size: s.size, mtimeMs: s.mtimeMs });
      else if (refused.get(key) !== sha256) await upload(l, path, s, sha256);
    }

    const deletes = Object.keys(saved.files)
      .filter((k) => rootOf(k) === l.id && inScope(pathOf(k)) && !disk.has(pathOf(k)))
      .map(pathOf);
    const counted = deletes.filter((p) => !sent.has(saved.files[keyOf(l.id, p)]?.sha256 ?? ""));
    const before = held.get(l.id);
    if (before || rootGone || counted.length > guard) {
      const paths = [...new Set([...(before ?? []), ...deletes])];
      // Back on disk meanwhile (restored by hand): no longer a delete.
      const still = [];
      for (const p of paths)
        if (!(await fileStat(await inRoot(l.base, p).catch(() => null)))) still.push(p);
      if (still.length) {
        if (!before) log(`sync: ${still.length} files deleted in ${l.name}, held until confirmed`);
        held.set(l.id, still);
      } else held.delete(l.id);
      return;
    }
    for (const path of deletes) await remove(l, path);
  }

  /** A local delete: into the root's trash on the hub; the hub's newer copy comes back. */
  async function remove(l: Live, path: string) {
    const key = keyOf(l.id, path);
    const e = saved.files[key];
    if (!e) return;
    const res = await call(fileUrl(l.id, path, e.version), { method: "DELETE" });
    set(key, undefined);
    // 409: changed on the hub since; 403: download-only. Either way the hub's copy comes back.
    if (res.status === 409 || res.status === 403) await download(l, path, e.readOnly, null);
  }

  /** Queues a path for a push after a quiet second. */
  function later(rootId: string, path: string) {
    const set = queued.get(rootId) ?? new Set();
    queued.set(rootId, set.add(path));
    clearTimeout(quiet);
    quiet = setTimeout(() => {
      const batch = [...queued];
      queued.clear();
      void serial(async () => {
        for (const [id, paths] of batch) {
          const l = live.get(id);
          if (l) await push(l, paths.has("") ? [""] : [...paths]);
        }
      });
    }, QUIET_MS);
    quiet.unref();
    changedState();
  }

  function watchFolder() {
    try {
      watcher = watch(syncDir, { recursive: true }, (_, name) => {
        const parts = name ? name.split(/[\\/]/) : [];
        const folder = parts.shift();
        if (parts.some(syncSkipped)) return;
        const id = Object.keys(saved.roots).find((k) => saved.roots[k] === folder);
        if (id && live.has(id)) later(id, parts.join("/"));
        // An event without a name: look at everything.
        else if (!name) for (const l of live.values()) later(l.id, "");
      });
      watcher.on("error", (e) => log(`watch ${syncDir}: ${e.message}`));
    } catch (e) {
      log(`watch ${syncDir}: ${message(e)}`);
    }
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      saved = JSON.parse(await readFile(file, "utf8"));
    } catch {} // first start, or a damaged file: everything is adopted by hash again
    if (saved.link !== identity()) saved = { link: identity(), roots: {}, files: {} };
  }

  function stop() {
    run++;
    watcher?.close();
    watcher = undefined;
    clearTimeout(quiet);
    clearTimeout(retry);
    clearInterval(poll);
    queued.clear();
    persist(true);
  }

  /** Lets go of a file's lock on the hub; its last save goes up first. */
  const release = (key: string) =>
    serial(async () => {
      const l = live.get(rootOf(key));
      if (!l) return;
      await push(l, [pathOf(key)]);
      await call(`/sync/roots/${l.id}/lock?path=${encodeURIComponent(pathOf(key))}`, {
        method: "DELETE",
      });
    });
  const forgetOpened = (key: string) => {
    if (saved.opened?.[key] === undefined) return;
    delete saved.opened[key];
    changed = true;
    persist(true);
  };
  /**
   * A slicer a file was opened in has exited: the lock goes.
   * ponytail: a reused pid keeps the lock until the idle timeout; compare start times if it bites.
   */
  const checkOpened = () => {
    for (const [key, pid] of Object.entries(saved.opened ?? {}))
      if (!alive(pid)) {
        forgetOpened(key);
        void release(key);
      }
  };

  /**
   * Strict locks while offline (and before the first connect): the device can't check anything
   * out, so only the files it already has checked out stay writable. The next full pull gives
   * each file the hub's access again.
   */
  async function lockDown() {
    await load();
    if (saved.locks !== "strict") return;
    for (const [key, e] of Object.entries(saved.files)) {
      if (e.readOnly || e.mine) continue;
      const folder = saved.roots[rootOf(key)];
      const base = folder && (await realpath(join(syncDir, folder)).catch(() => null));
      const abs = base && (await inRoot(base, pathOf(key)).catch(() => null));
      if (!abs) continue;
      await chmod(abs, 0o444).catch(() => {});
      // Only the flag: a change not pushed yet must still differ from the state.
      set(key, { ...e, readOnly: true });
    }
  }

  /** On connect: the hub roots and their folders, a full pull, then the local changes. */
  function start() {
    stop();
    return serial(async () => {
      await load();
      const res = await call("/sync/roots");
      if (!res.ok) throw new Error(`roots: HTTP ${res.status}`);
      const synced = hubSyncRootsSchema.parse(await res.json());
      const { roots } = synced;
      guard = synced.deleteGuard;
      mode = synced.mode;
      saved.locks = synced.locks;
      await mkdir(syncDir, { recursive: true });
      const next = new Map<string, Live>();
      for (const r of roots) {
        // ponytail: picked once, a root renamed on the hub keeps its folder name.
        saved.roots[r.id] ??= folderName(r.name, Object.values(saved.roots));
        changed = true;
        const abs = join(syncDir, saved.roots[r.id] ?? "");
        // A folder that went missing with files in it waits for confirm or restore.
        const known = Object.keys(saved.files).some((k) => rootOf(k) === r.id);
        if (!known) await mkdir(abs, { recursive: true });
        next.set(r.id, {
          id: r.id,
          name: r.name,
          base: (await realpath(abs).catch(() => null)) ?? abs,
        });
      }
      // ponytail: a root that's gone from the hub stops syncing; its folder stays.
      live = next;
      for (const id of held.keys()) if (!live.has(id)) held.delete(id);
      watchFolder();
      await pull(true);
      for (const l of live.values()) await push(l, [""]);
      checkOpened();
      poll = setInterval(checkOpened, pollMs);
      poll.unref();
    });
  }

  return {
    start,
    stop,
    handle(event: HubEvent) {
      if (event.type === "sync.changed") void serial(() => pull(false));
      else if (event.type === "roots.changed") void start();
    },
    state,
    /** `all` the hub roots, or the selected projects (the hub filters the feed); as of the connect. */
    mode: () => mode,
    /**
     * The local path of a hub root's file, for Open: a file not synced yet (a project just selected)
     * pulls everything it now may see first. Null when it isn't here even then.
     */
    async local(rootId: string, path: string) {
      let abs: string | null = null;
      await serial(async () => {
        const l = live.get(rootId);
        if (!l || !syncable(path)) return;
        const key = keyOf(rootId, path);
        if (!saved.files[key]) await pull(true).catch((e) => log(`sync: ${message(e)}`));
        if (saved.files[key]) abs = await inRoot(l.base, path).catch(() => null);
      });
      return abs;
    },
    /** Sends a root's held deletes to the hub. */
    confirm: (rootId: string) =>
      serial(async () => {
        const l = live.get(rootId);
        const paths = held.get(rootId) ?? [];
        held.delete(rootId);
        if (l) for (const path of paths) await remove(l, path);
      }),
    /** Drops a root's held deletes and downloads those files again. */
    restore: (rootId: string) =>
      serial(async () => {
        const l = live.get(rootId);
        for (const path of held.get(rootId) ?? []) set(keyOf(rootId, path), undefined);
        held.delete(rootId);
        if (l) {
          await mkdir(l.base, { recursive: true });
          l.base = await realpath(l.base);
        }
        await pull(true);
      }),
    /** The link went offline (or hasn't connected yet): strict locks make files read-only. */
    offline: () => serial(lockDown),
    /**
     * A file was opened in a slicer whose process is `pid`. One that is gone within 2 s handed
     * the file to a slicer already running (macOS, single instance): Done editing or the idle
     * timeout releases that lock. Otherwise its exit does.
     */
    async opened(rootId: string, path: string, pid: number) {
      await wait(handoffMs);
      if (!alive(pid)) return;
      saved.opened = { ...saved.opened, [keyOf(rootId, path)]: pid };
      changed = true;
      persist(true);
    },
    /** The files this device has checked out, for Done editing on the status page. */
    editing: () =>
      Object.entries(saved.files)
        .filter(([key, e]) => e.mine && live.has(rootOf(key)))
        .map(([key]) => ({ key, root: live.get(rootOf(key))?.name ?? "", path: pathOf(key) })),
    /** Done editing: the lock goes now, whether or not the slicer is still open. */
    done(key: string) {
      if (!saved.files[key]?.mine) return Promise.resolve();
      forgetOpened(key);
      return release(key);
    },
    /** Resolves once everything started so far is done (tests). */
    idle: () => chain,
  };
}

export type HubSync = ReturnType<typeof createHubSync>;
