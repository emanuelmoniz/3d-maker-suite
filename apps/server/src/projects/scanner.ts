import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { read3mfEntry } from "@3d-maker-suite/3mf";
import {
  PROJECT_EDITABLE_FIELDS,
  type ProjectMeta,
  type ProjectScanStatus,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import chokidar, { type FSWatcher } from "chokidar";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { HttpError } from "../errors.ts";
import { readPreferences } from "../lib/preferences.ts";
import { linkPrints } from "./linkPrints.ts";
import { type Cover, type FolderScan, isHidden, kindOf, scanFolder } from "./scanFolder.ts";

const { projects } = schema;
type Fields = { name?: string; description?: string | null; sourceUrl?: string | null };

const WATCH_DEBOUNCE_MS = 3000;
const THUMB_DIR = "thumbnails";
// Watch this many levels below the scan depth: enough to see files inside a project folder.
const WATCH_EXTRA_DEPTH = 3;

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
  let again = false;
  let watcher: FSWatcher | undefined;
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
      if (!have || have.mtimeMs < src.mtimeMs) {
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

  /** Creates or updates the project of one folder. `user` fields count as user-edited. */
  async function upsert(folder: string, scan: FolderScan, user: Fields = {}) {
    const row = db.select().from(projects).where(eq(projects.folderPath, folder)).get();
    const id = row?.id ?? randomUUID();
    const thumbnailPath = await storeCover(id, scan.cover, row?.thumbnailPath ?? null);
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
      name: basename(folder),
      description: scan.description,
      sourceUrl: scan.sourceUrl,
    };
    const always = { filePath: scan.mainFile, thumbnailPath, meta };

    if (!row) {
      db.insert(projects)
        .values({
          id,
          folderPath: folder,
          ...scanned,
          ...user,
          editedFields: PROJECT_EDITABLE_FIELDS.filter((f) => f in user),
          ...always,
        })
        .run();
      return "created" as const;
    }
    const edited = new Set<string>(row.editedFields);
    const next: Record<string, unknown> = { ...always };
    for (const f of PROJECT_EDITABLE_FIELDS) if (!edited.has(f)) next[f] = scanned[f];
    const current = row as Record<string, unknown>;
    const changed = Object.entries(next).some(
      ([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v),
    );
    if (changed) db.update(projects).set(next).where(eq(projects.id, id)).run();
    return changed ? ("updated" as const) : ("unchanged" as const);
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
      for (const folder of folders) {
        try {
          const scan = await scanFolder(folder);
          if (scan.hasModel) {
            const result = await upsert(folder, scan);
            if (result !== "unchanged") state[result]++;
          }
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
      do {
        again = false;
        await pass();
      } while (again);
    } finally {
      state = { ...state, state: "idle", phase: null, finishedAt: new Date().toISOString() };
      watch();
    }
  }

  /** Starts a background scan; a request during a scan queues one more pass. */
  function start() {
    if (state.state === "running") again = true;
    else {
      state = running();
      void run();
    }
    return state;
  }

  /** (Re)points the folder watcher at the current roots. Called after every scan. */
  function watch() {
    if (!opts.watch) return;
    const { projectRoots, projectScanDepth } = readPreferences(db);
    const key = JSON.stringify([projectRoots, projectScanDepth]);
    if (key === watching) return;
    watching = key;
    void watcher?.close();
    watcher = undefined;
    if (!projectRoots.length) return;
    // ponytail: any change triggers a full re-scan after a quiet period; scan only the touched
    // folder if big libraries make that slow.
    watcher = chokidar
      .watch(
        projectRoots.map((r) => resolve(r)),
        {
          ignoreInitial: true,
          depth: projectScanDepth + WATCH_EXTRA_DEPTH,
          ignored: (p) => isHidden(basename(p)),
        },
      )
      .on("all", () => {
        clearTimeout(timer);
        timer = setTimeout(start, WATCH_DEBOUNCE_MS);
      })
      .on("error", (err) => log.warn({ err }, "project watcher error"));
  }

  /** Manual project backed by a folder; the given fields are user-edited from the start. */
  async function addFolder(path: string, user: Fields) {
    const folder = resolve(path);
    if (!(await isDir(folder))) throw new HttpError(400, "invalid_folder", "Folder not found");
    if (db.select().from(projects).where(eq(projects.folderPath, folder)).get())
      throw new HttpError(409, "folder_in_use", "A project already uses this folder");
    await upsert(folder, await scanFolder(folder), user);
    return db.select().from(projects).where(eq(projects.folderPath, folder)).get();
  }

  return {
    status: () => state,
    start,
    addFolder,
    /** Begins watching and runs a first scan, so changes made while the app was off are found. */
    boot() {
      watch();
      if (readPreferences(db).projectRoots.length) start();
    },
    close: async () => {
      clearTimeout(timer);
      await watcher?.close();
    },
  };
}

export type ProjectScanner = ReturnType<typeof createProjectScanner>;
