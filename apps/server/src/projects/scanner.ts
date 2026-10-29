import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, posix, resolve, sep } from "node:path";
import { read3mfEntry } from "@3d-maker-suite/3mf";
import {
  type DeviceFolder,
  type DeviceIndex,
  PROJECT_EDITABLE_FIELDS,
  type ProjectMeta,
  type ProjectScanStatus,
  projectMetaSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  type Cover,
  descriptionOf,
  type FolderScan,
  isHidden,
  scanFolder,
} from "@3d-maker-suite/host";
import { and, eq, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { parseFolderName } from "./folderName.ts";
import { linkPrints } from "./linkPrints.ts";
import { hubRoots, locate, onDevice, type Place, projectDir, type Root, rootFs } from "./rootFs.ts";

const { deviceRootFolders, devices, projects, roots } = schema;
/** A device folder's scan as stored: its images are kept as files. */
type Sent = Omit<DeviceFolder, "cover" | "previews" | "gallery">;
type Fields = {
  number?: number;
  name?: string;
  description?: string | null;
  sourceUrl?: string | null;
  descriptionFile?: string | null;
};
const at = ({ root, rel }: Place) => and(eq(projects.rootId, root.id), eq(projects.folder, rel));
const keyOf = ({ root, rel }: Place) => `${root.id}\0${rel}`;

const WATCH_DEBOUNCE_MS = 3000;
const THUMB_DIR = "thumbnails";
const short = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

const idle = (): ProjectScanStatus => ({
  state: "idle",
  phase: null,
  total: 0,
  done: 0,
  created: 0,
  updated: 0,
  failed: 0,
  missingRoots: [],
  startedAt: null,
  finishedAt: null,
});

const running = (): ProjectScanStatus => ({
  ...idle(),
  state: "running",
  phase: "discovering",
  startedAt: new Date().toISOString(),
});

const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false;
/** Folder levels between root-relative `from` and `to` below it (a file right in `from` = 0). */
const levels = (from: string, to: string) =>
  to === from ? 0 : to.slice(from.length + 1).split("/").length - 1;

/**
 * Finds project folders under the roots and stores what is inside them. Re-scans only rewrite
 * scanned data: a field the user edited (`editedFields`) is never overwritten.
 * Runs in the background; `status()` reports progress.
 */
export function createProjectScanner(
  db: Db,
  dataDir: string,
  log: FastifyBaseLogger,
  opts: {
    watch?: boolean;
    /** After any scan of a known project (full or one folder), with its meta from before (auto slicing). */
    onScanned?: (projectId: string, before: ProjectMeta) => Promise<void>;
    /** Re-reads `rel` ("" = all) of a hub root into the sync index (ADR-0014): every file, any depth. */
    index?: (root: Root, rel: string) => Promise<void>;
  } = {},
) {
  let state = idle();
  const pending = new Map<string, { root: Root; rel: string; at: number }>();
  /** What the watcher saw, for the sync index. */
  const toIndex = new Map<string, Place>();
  const refreshedAt = new Map<string, number>();
  /** Device roots whose folder their device reported missing (resent on every connect). */
  const missingOnDevice = new Set<string>();
  const stops: (() => void)[] = [];
  let watching = "";
  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  /** Copies/extracts the cover into <dataDir>/thumbnails; returns the data-dir-relative path. */
  async function storeCover(id: string, cover: Cover | null, previous: string | null) {
    let next: string | null = null;
    if (cover?.kind === "data") {
      // A device's folder: sent only when its files changed, so always written.
      next = `${THUMB_DIR}/${id}${cover.ext}`;
      await mkdir(join(dataDir, THUMB_DIR), { recursive: true });
      await writeFile(join(dataDir, next), cover.data);
    } else if (cover) {
      const ext = cover.kind === "3mf" ? ".png" : extname(cover.abs).toLowerCase();
      next = `${THUMB_DIR}/${id}${ext}`;
      const dest = join(dataDir, next);
      const [src, have] = await Promise.all([stat(cover.abs), stat(dest).catch(() => null)]);
      // An image is small and may be another file of the same extension (a new cover), so it is
      // always copied; a 3MF preview is extracted only when the file changed.
      if (!have || cover.kind === "image" || have.mtimeMs < src.mtimeMs) {
        await mkdir(join(dataDir, THUMB_DIR), { recursive: true });
        if (cover.kind === "image") await copyFile(cover.abs, dest);
        else {
          const png = await read3mfEntry(cover.abs, cover.entry);
          if (png) await writeFile(dest, png);
          else next = null;
        }
      }
    }
    if (previous && previous !== next) await rm(join(dataDir, previous), { force: true });
    return next;
  }

  /**
   * A device folder's plate previews and gallery images (ADR-0014): a folder per root, in it one
   * per project folder.
   */
  const previewDir = (rootId: string, rel?: string) =>
    join(dataDir, THUMB_DIR, "device", rootId, ...(rel === undefined ? [] : [short(rel)]));
  /** The stored preview of plate `entry` of a device folder's `file`. */
  const devicePreview = (rootId: string, rel: string, file: string, entry: string) =>
    join(previewDir(rootId, rel), `${short(`${file}\0${entry}`)}.png`);
  /** The stored copy of a device folder's gallery image `file`. */
  const deviceGalleryImage = (rootId: string, rel: string, file: string) =>
    join(previewDir(rootId, rel), `${short(`gallery\0${file}`)}${extname(file).toLowerCase()}`);

  /** The hub's roots with their seam and real path (null: missing). Devices index their own. */
  const spots = () =>
    Promise.all(
      hubRoots(db).map(async (root) => {
        const fs = rootFs(db, root);
        return { root, fs, base: await fs.local("") };
      }),
    );
  type Spot = Awaited<ReturnType<typeof spots>>[number];
  /**
   * Whether `rel` below `s` is that root's: a folder below a root nested in it is the nested
   * root's, so nested roots never scan one folder twice.
   */
  const owns = (all: Spot[], s: Spot, rel: string) => {
    const abs = join(s.base ?? "", ...rel.split("/"));
    return !all.some(
      (o) =>
        o !== s &&
        o.base &&
        s.base &&
        o.base.startsWith(s.base + sep) &&
        abs.startsWith(o.base + sep),
    );
  };

  /**
   * A new folder whose prefix number belongs to a project without a folder (e.g. one a prints
   * import created), or whose folder is gone (renamed), becomes that project's folder, so the scan
   * updates it instead of adding a twin.
   */
  async function adopt({ root, rel }: Place) {
    const number = parseFolderName(posix.basename(rel)).number;
    if (!number) return undefined;
    const row = db.select().from(projects).where(eq(projects.number, number)).get();
    if (!row || (await present(row))) return undefined;
    return db
      .update(projects)
      .set({ rootId: root.id, folder: rel })
      .where(eq(projects.id, row.id))
      .returning()
      .get();
  }

  /** A device root's folder as last sent, or undefined (missing on the device). */
  const deviceFolder = (rootId: string, folder: string) =>
    db
      .select()
      .from(deviceRootFolders)
      .where(and(eq(deviceRootFolders.rootId, rootId), eq(deviceRootFolders.folder, folder)))
      .get();

  /** Whether a project's folder is there: on disk, or in its device's last index. */
  async function present(p: { rootId: string | null; folder: string | null }) {
    const root = p.rootId ? db.select().from(roots).where(eq(roots.id, p.rootId)).get() : undefined;
    if (!root || p.folder === null) return false;
    return onDevice(root) ? !!deviceFolder(root.id, p.folder) : !!(await projectDir(db, p));
  }

  /**
   * Creates or updates the project of one folder (`dir`: its local path; null on a device, where
   * `keepThumbnail` keeps the stored cover when the scan brings none). `user` fields count as
   * user-edited.
   */
  async function upsert(
    place: Place,
    dir: string | null,
    scan: FolderScan,
    user: Fields = {},
    keepThumbnail = false,
  ) {
    const row =
      db.select().from(projects).where(at(place)).get() ??
      // A folder added by hand with typed fields is a new project, as asked.
      (Object.keys(user).length ? undefined : await adopt(place));
    const id = row?.id ?? randomUUID();
    // Gallery picks and a chosen cover that are gone from the folder are dropped; the cover then
    // falls back to the scanner's pick. An image past the `projectScanMaxFiles` cap counts as
    // gone too (the setting's hint says so).
    const listed = new Set(scan.files.filter((f) => f.kind === "image").map((f) => f.path));
    const coverFile = row?.coverFile && listed.has(row.coverFile) ? row.coverFile : null;
    const gallery = row && {
      folders: (
        await Promise.all(
          row.gallery.folders.map(async (d) =>
            d === "" ||
            (dir === null
              ? scan.files.some((f) => f.path.startsWith(`${d}/`))
              : await isDir(join(dir, ...d.split("/"))))
              ? d
              : null,
          ),
        )
      ).filter((d): d is string => d !== null),
      images: row.gallery.images.filter((p) => listed.has(p)),
    };
    const cover: Cover | null =
      coverFile && dir !== null
        ? { kind: "image", abs: join(dir, ...coverFile.split("/")) }
        : scan.cover;
    // A device sends the picked cover with its scan; one sent for another pick (before the device
    // knew) keeps the stored one until the next.
    const otherPick =
      dir === null &&
      (cover?.kind === "data" ? (cover.file ?? null) !== coverFile : coverFile !== null);
    const thumbnailPath =
      (keepThumbnail && !cover) || otherPick
        ? (row?.thumbnailPath ?? null)
        : await storeCover(id, cover, row?.thumbnailPath ?? null);
    const types = scan.models.flatMap((m) =>
      m.plates.flatMap((p) => p.filaments.map((f) => f.type)),
    );
    const meta: ProjectMeta = {
      files: scan.files,
      models: scan.models,
      multicolor: scan.models.some((m) => m.multicolor),
      materials: [...new Set(types.filter((t): t is string => !!t))].sort(),
    };
    const scanned = {
      name: parseFolderName(posix.basename(place.rel)).name,
      description: scan.description,
      sourceUrl: scan.sourceUrl,
      filePath: scan.mainFile,
    };
    const always = { thumbnailPath, meta };

    if (!row) {
      // A folder prefix is its number unless another project has it already.
      const prefix = parseFolderName(posix.basename(place.rel)).number;
      const free =
        prefix != null &&
        prefix > 0 &&
        !db.select({ id: projects.id }).from(projects).where(eq(projects.number, prefix)).get();
      db.insert(projects)
        .values({
          id,
          rootId: place.root.id,
          folder: place.rel,
          ...scanned,
          ...user,
          number: user.number ?? (free ? prefix : nextNumber(projects)),
          editedFields: PROJECT_EDITABLE_FIELDS.filter(
            (f) => f in user && !(f === "description" && user.descriptionFile),
          ),
          ...always,
          // A device root's projects are its user's (ADR-0014); a hub scan's are nobody's.
          ownerId: onDevice(place.root)
            ? (db
                .select({ id: devices.userId })
                .from(devices)
                .where(eq(devices.id, place.root.location))
                .get()?.id ?? null)
            : null,
        })
        .run();
      return "created" as const;
    }
    const edited = new Set<string>(row.editedFields);
    const next: Record<string, unknown> = { ...always, gallery, coverFile };
    // A chosen preview file that is gone falls back to the scanner's pick.
    const previewKept = scan.files.some((f) => f.kind === "model" && f.path === row.filePath);
    for (const f of PROJECT_EDITABLE_FIELDS)
      if (!edited.has(f) || (f === "filePath" && !previewKept)) next[f] = scanned[f];
    // A linked file always wins over the stored text.
    if (row.descriptionFile) next.description = scanned.description;
    const current = row as Record<string, unknown>;
    const changed = Object.entries(next).some(
      ([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v),
    );
    if (changed) db.update(projects).set(next).where(eq(projects.id, id)).run();
    // Even when nothing stored changed: a 3MF can change its bytes and keep its plates.
    // Never awaited: slicing work must not hold up the scan (or the request that asked for it).
    opts
      .onScanned?.(id, projectMetaSchema.parse(row.meta))
      .catch((err) => log.warn({ err, folder: place.rel }, "auto slice failed"));
    return changed ? ("updated" as const) : ("unchanged" as const);
  }

  const linkOf = (place: Place) =>
    db.select().from(projects).where(at(place)).get()?.descriptionFile;
  /** A device's scan as the hub's own: the description from the doc the project links. */
  const fromDevice = (
    sent: Sent,
    link: string | null | undefined,
    cover: Cover | null,
  ): FolderScan => ({
    ...sent.scan,
    texts: sent.texts,
    description: descriptionOf(sent.texts, link),
    cover,
  });

  type Read = { dir: string | null; scan: FolderScan; keepThumbnail?: boolean };
  /** A folder's scan: read from disk, or from what its device last sent (cover kept). */
  async function read(place: Place, link = linkOf(place)): Promise<Read> {
    if (onDevice(place.root)) {
      const sent = deviceFolder(place.root.id, place.rel);
      if (!sent) throw new HttpError(404, "not_found", "Project folder not found");
      const scan = fromDevice(sent.scan as Sent, link, null);
      return { dir: null, scan, keepThumbnail: true };
    }
    const dir = await rootFs(db, place.root).local(place.rel);
    if (!dir) throw new HttpError(404, "not_found", "Project folder not found");
    const prefs = readPreferences(db);
    const scan = await scanFolder(dir, link, prefs.projectScanMaxFiles, place.root.filesDepth);
    return { dir, scan };
  }

  async function refreshPlace(place: Place) {
    // The app's own write already fired the watcher; events up to now need no second scan.
    refreshedAt.set(keyOf(place), Date.now());
    const { dir, scan, keepThumbnail } = await read(place);
    await upsert(place, dir, scan, {}, keepThumbnail);
  }

  /** Re-reads one project folder now (e.g. after its description file changed). */
  async function refresh(p: { rootId: string | null; folder: string | null }) {
    const root = p.rootId ? db.select().from(roots).where(eq(roots.id, p.rootId)).get() : undefined;
    if (root && p.folder !== null) await refreshPlace({ root, rel: p.folder });
  }

  /** Scans one discovered folder; a template folder or one without a model is no project. */
  async function scanOne(place: Place, get = () => read(place)) {
    // Number 0 ("000_project-name") marks a template folder: no project.
    if (parseFolderName(posix.basename(place.rel)).number === 0) return "unchanged" as const;
    // A folder a project was unlinked from and kept: left alone until it is linked again.
    const kept = and(
      eq(projects.unlinkedRootId, place.root.id),
      eq(projects.unlinkedFolder, place.rel),
    );
    if (db.select().from(projects).where(kept).get()) return "unchanged" as const;
    const { dir, scan, keepThumbnail } = await get();
    return scan.hasModel
      ? await upsert(place, dir, scan, {}, keepThumbnail)
      : ("unchanged" as const);
  }

  /**
   * A device root's index (ADR-0014): folders it no longer lists are forgotten (their projects
   * read "missing"); returns the ones to send, new or with another digest. A missing root
   * forgets them all.
   */
  async function deviceIndex(root: Root, index: DeviceIndex) {
    if (index.state === "missing") missingOnDevice.add(root.id);
    else missingOnDevice.delete(root.id);
    const listed = index.state === "ok" ? index.folders : [];
    const mine = eq(deviceRootFolders.rootId, root.id);
    db.delete(deviceRootFolders)
      .where(
        listed.length
          ? and(
              mine,
              notInArray(
                deviceRootFolders.folder,
                listed.map((f) => f.rel),
              ),
            )
          : mine,
      )
      .run();
    const have = new Map(
      db
        .select({ folder: deviceRootFolders.folder, digest: deviceRootFolders.digest })
        .from(deviceRootFolders)
        .where(mine)
        .all()
        .map((r) => [r.folder, r.digest]),
    );
    // Previews of folders forgotten here or before (trashed, gone while offline) go too.
    const keep = new Set([...have.keys()].map(short));
    for (const name of await readdir(previewDir(root.id)).catch(() => []))
      if (!keep.has(name))
        await rm(join(previewDir(root.id), name), { recursive: true, force: true });
    return listed.filter((f) => have.get(f.rel) !== f.digest).map((f) => f.rel);
  }

  /**
   * One device folder as its connector scanned it: stored (its plate previews and gallery images as
   * files), then like a scanned folder.
   */
  async function deviceFolderScanned(
    root: Root,
    { cover, previews, gallery, ...sent }: DeviceFolder,
  ) {
    const updatedAt = new Date().toISOString();
    db.insert(deviceRootFolders)
      .values({ rootId: root.id, folder: sent.rel, digest: sent.digest, scan: sent, updatedAt })
      .onConflictDoUpdate({
        target: [deviceRootFolders.rootId, deviceRootFolders.folder],
        set: { digest: sent.digest, scan: sent, updatedAt },
      })
      .run();
    const dir = previewDir(root.id, sent.rel);
    await rm(dir, { recursive: true, force: true });
    if (previews.length || gallery.length) await mkdir(dir, { recursive: true });
    for (const p of previews)
      await writeFile(
        devicePreview(root.id, sent.rel, p.file, p.entry),
        Buffer.from(p.data, "base64"),
      );
    for (const g of gallery)
      await writeFile(deviceGalleryImage(root.id, sent.rel, g.file), Buffer.from(g.data, "base64"));
    const place = { root, rel: sent.rel };
    const data: Cover | null = cover && {
      kind: "data",
      ext: cover.ext,
      data: Buffer.from(cover.data, "base64"),
      file: cover.file,
    };
    const result = await scanOne(place, async () => ({
      dir: null,
      scan: fromDevice(sent, linkOf(place), data),
    }));
    if (result === "created") linkPrints(db);
    return result;
  }

  /** A device folder that is gone: its project reads "missing". */
  async function deviceFolderGone(root: Root, rel: string) {
    db.delete(deviceRootFolders)
      .where(and(eq(deviceRootFolders.rootId, root.id), eq(deviceRootFolders.folder, rel)))
      .run();
    await rm(previewDir(root.id, rel), { recursive: true, force: true });
  }

  /** Makes the device send a folder again on its next sync (e.g. for a newly picked cover or gallery). */
  const deviceFolderStale = (rootId: string, rel: string) =>
    db
      .update(deviceRootFolders)
      .set({ digest: "" })
      .where(and(eq(deviceRootFolders.rootId, rootId), eq(deviceRootFolders.folder, rel)))
      .run();

  const indexPlace = ({ root, rel }: Place) =>
    opts
      .index?.(root, rel)
      .catch((err) => log.warn({ err, root: root.path, rel }, "hub index failed"));

  async function pass() {
    state = running();
    try {
      const all = await spots();
      const folders: Place[] = [];
      for (const s of all) {
        if (!s.base) {
          state.missingRoots.push(s.root.path);
          continue;
        }
        for (const rel of await s.fs.discover(s.root.projectDepth))
          if (owns(all, s, rel)) folders.push({ root: s.root, rel });
      }
      state.phase = "scanning";
      state.total = folders.length;
      // First claimants of a prefix number go first, so a duplicate or unnumbered folder (which gets
      // the next free number) never takes a number a later folder owns.
      const claimed = new Set<number>();
      const ordered: Place[] = [];
      const later: Place[] = [];
      for (const f of folders) {
        const n = parseFolderName(posix.basename(f.rel)).number;
        if (n != null && !claimed.has(n)) {
          claimed.add(n);
          ordered.push(f);
        } else later.push(f);
      }
      ordered.push(...later);
      for (const place of ordered) {
        try {
          const result = await scanOne(place);
          if (result !== "unchanged") state[result]++;
        } catch (e) {
          state.failed++;
          log.warn({ err: e, root: place.root.path, folder: place.rel }, "project scan failed");
        }
        state.done++;
      }
      linkPrints(db);
      for (const s of all) if (s.base) await indexPlace({ root: s.root, rel: "" });
    } catch (e) {
      log.error({ err: e }, "project scan crashed");
    }
  }

  async function run() {
    try {
      await pass();
    } finally {
      state = { ...state, state: "idle", phase: null, finishedAt: new Date().toISOString() };
      await watch();
    }
  }

  /** Starts a full background scan: one request, one pass (a request during a scan joins it). */
  function start() {
    if (state.state !== "running") {
      state = running();
      // The pass sees everything on disk now, so changes seen so far need no scan of their own.
      pending.clear();
      toIndex.clear();
      void run();
    }
    return state;
  }

  /** Scans what the watcher saw: the touched project folders, plus a discover for new folders. */
  async function flush() {
    if (state.state === "running") {
      timer = setTimeout(flush, WATCH_DEBOUNCE_MS);
      return;
    }
    const batch = [...pending.values()];
    pending.clear();
    const indexing = [...toIndex.values()];
    toIndex.clear();
    for (const place of indexing) await indexPlace(place);
    const known = db
      .select({ rootId: projects.rootId, rel: projects.folder })
      .from(projects)
      .all()
      .flatMap((r) => (r.rootId && r.rel !== null ? [{ rootId: r.rootId, rel: r.rel }] : []));
    try {
      const all = await spots();
      const folders = new Map<string, Place>();
      const touched = new Set<Spot>();
      for (const { root, rel, at } of batch) {
        const s = all.find((x) => x.root.id === root.id);
        if (!s?.base) continue;
        const folder = known.find(
          (k) => k.rootId === root.id && (rel === k.rel || rel.startsWith(`${k.rel}/`)),
        )?.rel;
        const dir = folder !== undefined && (await s.fs.local(folder));
        if (folder === undefined || !dir || !(await isDir(dir))) touched.add(s);
        // Deeper than the root's files depth: not listed, so nothing to rescan. A folder's event
        // (e.g. a file written in it) is about its contents, one level further down.
        else if (
          root.filesDepth != null &&
          levels(folder, rel) + ((await isDir(join(s.base, ...rel.split("/")))) ? 1 : 0) >
            root.filesDepth
        )
          continue;
        else if (at > (refreshedAt.get(keyOf({ root, rel: folder })) ?? 0))
          folders.set(keyOf({ root, rel: folder }), { root, rel: folder });
      }
      for (const place of folders.values()) await refreshPlace(place);
      let created = false;
      for (const s of touched)
        for (const rel of await s.fs.discover(s.root.projectDepth))
          if (
            owns(all, s, rel) &&
            !known.some((k) => k.rootId === s.root.id && k.rel === rel) &&
            (await scanOne({ root: s.root, rel })) === "created"
          )
            created = true;
      if (created) linkPrints(db);
    } catch (err) {
      log.warn({ err }, "project change scan failed");
    }
  }

  /** (Re)points the folder watcher at the current roots. Called after every scan. */
  async function watch() {
    if (!opts.watch || closed) return;
    const all = hubRoots(db);
    // Depths are in the key too: the callbacks below hold the values they were made with.
    const key = JSON.stringify(all);
    if (key === watching) return;
    watching = key;
    for (const stop of stops.splice(0)) stop();
    // ponytail: one recursive OS watch per root, so Windows holds a handle only on the root and
    // folders below it stay renamable (a watch per folder locks every folder above one). The OS
    // watch has no depth limit, which costs nothing in CPU; events deeper than a project's files
    // can be are dropped here, the exact files depth is checked in `flush`. The roots themselves
    // stay locked. After a quiet period, a change scans only the project folder it is in (a new
    // folder: a discover on its root).
    for (const root of all) {
      const deepest = root.filesDepth == null ? Infinity : root.projectDepth + root.filesDepth;
      try {
        const stop = await rootFs(db, root).watch(
          (rel) => {
            const parts = rel?.split("/") ?? [];
            if (parts.some(isHidden)) return;
            const place = { root, rel: rel ?? "" };
            if (opts.index) toIndex.set(keyOf(place), place);
            if (parts.length - 1 <= deepest)
              pending.set(keyOf(place), { ...place, at: Date.now() });
            clearTimeout(timer);
            timer = setTimeout(flush, WATCH_DEBOUNCE_MS);
          },
          (err) => log.warn({ err, root: root.path }, "project watcher error"),
        );
        if (closed) stop();
        else stops.push(stop);
      } catch (err) {
        log.warn({ err, root: root.path }, "project root not watched");
      }
    }
  }

  /**
   * Where a folder picked by its path is stored, if it can be a project's folder: an existing
   * folder strictly below a root (the deepest one) that no project uses yet.
   */
  async function usableFolder(path: string): Promise<Place> {
    if (!(await isDir(resolve(path))))
      throw new HttpError(400, "invalid_folder", "Folder not found");
    const best = await locate(db, path);
    if (!best) throw new HttpError(403, "outside_roots", "Folder is not inside a project root");
    if (db.select().from(projects).where(at(best)).get())
      throw new HttpError(409, "folder_in_use", "A project already uses this folder");
    return best;
  }

  /** A folder linked by hand is no other project's kept one any more: scans see it again. */
  const claim = ({ root, rel }: Place) =>
    db
      .update(projects)
      .set({ unlinkedRootId: null, unlinkedFolder: null })
      .where(and(eq(projects.unlinkedRootId, root.id), eq(projects.unlinkedFolder, rel)))
      .run();

  /** Manual project backed by a folder; the given fields are user-edited from the start. */
  async function addFolder(place: Place, user: Fields) {
    claim(place);
    const { dir, scan, keepThumbnail } = await read(place, user.descriptionFile);
    await upsert(place, dir, scan, user, keepThumbnail);
    return db.select().from(projects).where(at(place)).get();
  }

  return {
    status: () => state,
    start,
    addFolder,
    usableFolder,
    claim,
    refresh,
    deviceIndex,
    deviceFolderScanned,
    deviceFolderGone,
    deviceFolderStale,
    deviceFolder,
    devicePreview,
    deviceGalleryImage,
    /** Gallery images a device folder's last scan left out (over its caps). */
    deviceGalleryLeftOut: (rootId: string, rel: string) =>
      (deviceFolder(rootId, rel)?.scan as Partial<Sent> | undefined)?.galleryLeftOut ?? [],
    /** A removed device root's previews. */
    dropDevicePreviews: (rootId: string) =>
      rm(previewDir(rootId), { recursive: true, force: true }),
    missingOnDevice: (rootId: string) => missingOnDevice.has(rootId),
    /** Begins watching and runs a first scan, so changes made while the app was off are found. */
    boot() {
      void watch();
      if (hubRoots(db).length) start();
    },
    close: async () => {
      closed = true;
      clearTimeout(timer);
      pending.clear();
      toIndex.clear();
      for (const stop of stops.splice(0)) stop();
    },
  };
}

export type ProjectScanner = ReturnType<typeof createProjectScanner>;
