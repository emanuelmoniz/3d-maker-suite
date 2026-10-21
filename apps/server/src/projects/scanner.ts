import { randomUUID } from "node:crypto";
import { type FSWatcher, watch as fsWatch } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { read3mfEntry } from "@3d-maker-suite/3mf";
import {
  PROJECT_EDITABLE_FIELDS,
  type ProjectMeta,
  type ProjectScanStatus,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { nextNumber } from "../lib/numbers.ts";
import { readPreferences } from "../lib/preferences.ts";
import { parseFolderName } from "./folderName.ts";
import { linkPrints } from "./linkPrints.ts";
import { type Cover, type FolderScan, isHidden, kindOf, scanFolder } from "./scanFolder.ts";

const { projects } = schema;
type Fields = {
  number?: number;
  name?: string;
  description?: string | null;
  sourceUrl?: string | null;
  descriptionFile?: string | null;
};

const WATCH_DEBOUNCE_MS = 3000;
const THUMB_DIR = "thumbnails";

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

/**
 * Finds project folders under the roots and stores what is inside them. Re-scans only rewrite
 * scanned data: a field the user edited (`editedFields`) is never overwritten.
 * Runs in the background; `status()` reports progress.
 */
export function createProjectScanner(
  db: Db,
  dataDir: string,
  log: FastifyBaseLogger,
  opts: { watch?: boolean } = {},
) {
  let state = idle();
  const pending = new Map<string, { root: string; at: number }>();
  const refreshedAt = new Map<string, number>();
  const watchers: FSWatcher[] = [];
  let watching = "";
  let timer: NodeJS.Timeout | undefined;

  /** Project folders: the first folder (from the root down) with a model file, or at max depth. */
  async function discover(root: string, depth: number) {
    const found: string[] = [];
    async function visit(dir: string, level: number) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const hasModel = entries.some((e) => e.isFile() && kindOf(e.name) === "model");
      if (level > 0 && (level >= depth || hasModel)) {
        found.push(dir);
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name)))
        if (e.isDirectory() && !isHidden(e.name)) await visit(join(dir, e.name), level + 1);
    }
    await visit(root, 0);
    return found;
  }

  /** Copies/extracts the cover into <dataDir>/thumbnails; returns the data-dir-relative path. */
  async function storeCover(id: string, cover: Cover | null, previous: string | null) {
    let next: string | null = null;
    if (cover) {
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
   * A new folder whose prefix number belongs to a project without a folder (e.g. one a prints
   * import created) becomes that project's folder, so the scan updates it instead of adding a twin.
   */
  function adopt(folder: string) {
    const number = parseFolderName(basename(folder)).number;
    if (!number) return undefined;
    return db
      .update(projects)
      .set({ folderPath: folder })
      .where(and(eq(projects.number, number), isNull(projects.folderPath)))
      .returning()
      .get();
  }

  /** Creates or updates the project of one folder. `user` fields count as user-edited. */
  async function upsert(folder: string, scan: FolderScan, user: Fields = {}) {
    const row =
      db.select().from(projects).where(eq(projects.folderPath, folder)).get() ??
      // A folder added by hand with typed fields is a new project, as asked.
      (Object.keys(user).length ? undefined : adopt(folder));
    const id = row?.id ?? randomUUID();
    // Gallery picks and a chosen cover that are gone from the folder are dropped; the cover then
    // falls back to the scanner's pick. ponytail: an image past the scan's MAX_FILES cap counts
    // as gone too; check the disk instead of the list if folders that big show up.
    const listed = new Set(scan.files.filter((f) => f.kind === "image").map((f) => f.path));
    const coverFile = row?.coverFile && listed.has(row.coverFile) ? row.coverFile : null;
    const gallery = row && {
      folders: (
        await Promise.all(
          row.gallery.folders.map(async (d) =>
            d === "" || (await isDir(join(folder, ...d.split("/")))) ? d : null,
          ),
        )
      ).filter((d): d is string => d !== null),
      images: row.gallery.images.filter((p) => listed.has(p)),
    };
    const cover: Cover | null = coverFile
      ? { kind: "image", abs: join(folder, ...coverFile.split("/")) }
      : scan.cover;
    const thumbnailPath = await storeCover(id, cover, row?.thumbnailPath ?? null);
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
      name: parseFolderName(basename(folder)).name,
      description: scan.description,
      sourceUrl: scan.sourceUrl,
      filePath: scan.mainFile,
    };
    const always = { thumbnailPath, meta };

    if (!row) {
      // A folder prefix is its number unless another project has it already.
      const prefix = parseFolderName(basename(folder)).number;
      const free =
        prefix != null &&
        prefix > 0 &&
        !db.select({ id: projects.id }).from(projects).where(eq(projects.number, prefix)).get();
      db.insert(projects)
        .values({
          id,
          folderPath: folder,
          ...scanned,
          ...user,
          number: user.number ?? (free ? prefix : nextNumber(projects)),
          editedFields: PROJECT_EDITABLE_FIELDS.filter(
            (f) => f in user && !(f === "description" && user.descriptionFile),
          ),
          ...always,
        })
        .run();
      return "created" as const;
    }
    const edited = new Set<string>(row.editedFields);
    const next: Record<string, unknown> = { ...always, gallery, coverFile };
    // A chosen preview file that is gone falls back to the scanner's pick.
    const previewKept = scan.files.some(
      (f) => f.kind === "model" && join(folder, ...f.path.split("/")) === row.filePath,
    );
    for (const f of PROJECT_EDITABLE_FIELDS)
      if (!edited.has(f) || (f === "filePath" && !previewKept)) next[f] = scanned[f];
    // A linked file always wins over the stored text.
    if (row.descriptionFile) next.description = scanned.description;
    const current = row as Record<string, unknown>;
    const changed = Object.entries(next).some(
      ([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v),
    );
    if (changed) db.update(projects).set(next).where(eq(projects.id, id)).run();
    return changed ? ("updated" as const) : ("unchanged" as const);
  }

  const linkOf = (folder: string) =>
    db.select().from(projects).where(eq(projects.folderPath, folder)).get()?.descriptionFile;

  /** Re-reads one project folder now (e.g. after its description file changed). */
  async function refresh(folder: string) {
    // The app's own write already fired the watcher; events up to now need no second scan.
    refreshedAt.set(folder, Date.now());
    await upsert(folder, await scanFolder(folder, linkOf(folder)));
  }

  /** Scans one discovered folder; a template folder or one without a model is no project. */
  async function scanOne(folder: string) {
    // Number 0 ("000_project-name") marks a template folder: no project.
    if (parseFolderName(basename(folder)).number === 0) return "unchanged" as const;
    const scan = await scanFolder(folder, linkOf(folder));
    return scan.hasModel ? await upsert(folder, scan) : ("unchanged" as const);
  }

  async function pass() {
    const prefs = readPreferences(db);
    state = running();
    try {
      const folders = new Set<string>();
      for (const r of prefs.projectRoots) {
        const root = resolve(r);
        if (!(await isDir(root))) {
          state.missingRoots.push(r);
          continue;
        }
        for (const f of await discover(root, prefs.projectScanDepth)) folders.add(f);
      }
      state.phase = "scanning";
      state.total = folders.size;
      // First claimants of a prefix number go first, so a duplicate or unnumbered folder (which gets
      // the next free number) never takes a number a later folder owns.
      const claimed = new Set<number>();
      const ordered: string[] = [];
      const later: string[] = [];
      for (const f of folders) {
        const n = parseFolderName(basename(f)).number;
        if (n != null && !claimed.has(n)) {
          claimed.add(n);
          ordered.push(f);
        } else later.push(f);
      }
      ordered.push(...later);
      for (const folder of ordered) {
        try {
          const result = await scanOne(folder);
          if (result !== "unchanged") state[result]++;
        } catch (e) {
          state.failed++;
          log.warn({ err: e, folder }, "project scan failed");
        }
        state.done++;
      }
      linkPrints(db);
    } catch (e) {
      log.error({ err: e }, "project scan crashed");
    }
  }

  async function run() {
    try {
      await pass();
    } finally {
      state = { ...state, state: "idle", phase: null, finishedAt: new Date().toISOString() };
      watch();
    }
  }

  /** Starts a full background scan: one request, one pass (a request during a scan joins it). */
  function start() {
    if (state.state !== "running") {
      state = running();
      // The pass sees everything on disk now, so changes seen so far need no scan of their own.
      pending.clear();
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
    const batch = [...pending];
    pending.clear();
    const known = db
      .select({ path: projects.folderPath })
      .from(projects)
      .all()
      .flatMap((r) => (r.path ? [r.path] : []));
    const folders = new Set<string>();
    const roots = new Set<string>();
    for (const [path, { root, at }] of batch) {
      const folder = known.find((f) => path === f || path.startsWith(f + sep));
      if (!folder || !(await isDir(folder))) roots.add(root);
      else if (at > (refreshedAt.get(folder) ?? 0)) folders.add(folder);
    }
    try {
      for (const folder of folders) await refresh(folder);
      const { projectScanDepth } = readPreferences(db);
      let created = false;
      for (const root of roots)
        for (const folder of await discover(root, projectScanDepth))
          if (!known.includes(folder) && (await scanOne(folder)) === "created") created = true;
      if (created) linkPrints(db);
    } catch (err) {
      log.warn({ err }, "project change scan failed");
    }
  }

  /** (Re)points the folder watcher at the current roots. Called after every scan. */
  function watch() {
    if (!opts.watch) return;
    const { projectRoots } = readPreferences(db);
    const key = JSON.stringify(projectRoots);
    if (key === watching) return;
    watching = key;
    for (const w of watchers.splice(0)) w.close();
    // ponytail: one recursive OS watch per root, so Windows holds a handle only on the root and
    // folders below it stay renamable (a watch per folder locks every folder above one). No depth limit, which costs
    // nothing in CPU; the roots themselves stay locked. After a quiet period, a change scans only
    // the project folder it is in (a new folder: a discover on its root).
    for (const r of projectRoots) {
      try {
        const root = resolve(r);
        const w = fsWatch(root, { recursive: true }, (_, file) => {
          if (file?.split(/[\\/]/).some(isHidden)) return;
          pending.set(file ? resolve(root, file) : root, { root, at: Date.now() });
          clearTimeout(timer);
          timer = setTimeout(flush, WATCH_DEBOUNCE_MS);
        });
        w.on("error", (err) => log.warn({ err, root: r }, "project watcher error"));
        watchers.push(w);
      } catch (err) {
        log.warn({ err, root: r }, "project root not watched");
      }
    }
  }

  /** Manual project backed by a folder; the given fields are user-edited from the start. */
  async function addFolder(path: string, user: Fields) {
    const folder = resolve(path);
    if (!(await isDir(folder))) throw new HttpError(400, "invalid_folder", "Folder not found");
    if (db.select().from(projects).where(eq(projects.folderPath, folder)).get())
      throw new HttpError(409, "folder_in_use", "A project already uses this folder");
    await upsert(folder, await scanFolder(folder, user.descriptionFile), user);
    return db.select().from(projects).where(eq(projects.folderPath, folder)).get();
  }

  return {
    status: () => state,
    start,
    addFolder,
    refresh,
    /** Begins watching and runs a first scan, so changes made while the app was off are found. */
    boot() {
      watch();
      if (readPreferences(db).projectRoots.length) start();
    },
    close: async () => {
      clearTimeout(timer);
      pending.clear();
      for (const w of watchers.splice(0)) w.close();
    },
  };
}

export type ProjectScanner = ReturnType<typeof createProjectScanner>;
