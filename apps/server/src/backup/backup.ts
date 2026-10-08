import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Db } from "@3d-maker-suite/db";
import yauzl from "yauzl";
import yazl from "yazl";
import { readPreferences } from "../lib/preferences.ts";

/**
 * Backup zip layout, version 1:
 *   manifest.json   { format, app, createdAt }
 *   app.sqlite      consistent snapshot (SQLite online backup)
 *   secret.key      encrypts the integration tokens inside app.sqlite
 *   photos/ thumbnails/   files the database points at
 * Bump FORMAT when the layout changes and add the step to UPGRADES (runs on a staged restore).
 */
export const FORMAT = 1;
const APP = "3d-maker-suite";
const DIRS = ["photos", "thumbnails"];
const FILES = ["app.sqlite", "secret.key"];
/** format N → function that turns the staged files of format N into format N+1. */
const UPGRADES: Record<number, (stagedDir: string) => void> = {};

export const BACKUP_NAME = /^[\w-]+\.zip$/;
const BACKUPS = "backups";
const STAGED = "restore-pending";
const PREVIOUS = "pre-restore";

export const backupsDir = (dataDir: string) => join(dataDir, BACKUPS);

export type BackupInfo = { name: string; size: number; createdAt: string; auto: boolean };

function addDir(zip: yazl.ZipFile, abs: string, rel: string) {
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) addDir(zip, join(abs, e.name), `${rel}/${e.name}`);
    else zip.addFile(join(abs, e.name), `${rel}/${e.name}`);
  }
}

/** Snapshots the live database (safe while the app runs) and zips it with the data files. */
export async function createBackup(db: Db, dataDir: string, auto = false): Promise<BackupInfo> {
  const createdAt = new Date().toISOString();
  const name = `${auto ? "auto" : "backup"}-${createdAt.replace(/\D/g, "").slice(0, 14)}.zip`;
  const dir = backupsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const snapshot = join(dir, `${name}.sqlite.tmp`);
  const tmp = join(dir, `${name}.tmp`);
  try {
    await db.$client.backup(snapshot);
    const zip = new yazl.ZipFile();
    zip.addBuffer(
      Buffer.from(JSON.stringify({ format: FORMAT, app: APP, createdAt })),
      "manifest.json",
    );
    zip.addFile(snapshot, "app.sqlite");
    if (existsSync(join(dataDir, "secret.key")))
      zip.addFile(join(dataDir, "secret.key"), "secret.key");
    for (const d of DIRS) addDir(zip, join(dataDir, d), d);
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(tmp));
    renameSync(tmp, join(dir, name));
  } finally {
    rmSync(snapshot, { force: true });
    rmSync(tmp, { force: true });
  }
  return { name, size: statSync(join(dir, name)).size, createdAt, auto };
}

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupsDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => BACKUP_NAME.test(n))
    .map((name) => {
      const s = statSync(join(dir, name));
      return {
        name,
        size: s.size,
        createdAt: s.mtime.toISOString(),
        auto: name.startsWith("auto-"),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Scheduled run: does nothing when switched off, then drops the oldest automatic backups. */
export async function runAutoBackup(db: Db, dataDir: string) {
  const prefs = readPreferences(db);
  if (!prefs.backupAuto) return;
  await createBackup(db, dataDir, true);
  for (const old of listBackups(dataDir)
    .filter((b) => b.auto)
    .slice(prefs.backupKeep))
    rmSync(join(backupsDir(dataDir), old.name), { force: true });
}

function openZip(file: string) {
  return new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(file, { lazyEntries: true }, (e, z) =>
      e || !z ? rej(e ?? new Error("bad zip")) : res(z),
    ),
  );
}

/** Whitelisted, traversal-safe destination for a zip entry, or null to skip it. */
const allowed = (entry: string) =>
  entry === "manifest.json" ||
  FILES.includes(entry) ||
  DIRS.some((d) => entry.startsWith(`${d}/`) && !entry.split("/").includes(".."));

/** Extracts the whitelisted entries of a backup zip into `dest`. */
async function extract(file: string, dest: string) {
  const zip = await openZip(file);
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (e: yauzl.Entry) => {
      const next = () => zip.readEntry();
      if (e.fileName.endsWith("/") || !allowed(e.fileName)) return next();
      zip.openReadStream(e, async (err, stream) => {
        if (err || !stream) return reject(err);
        try {
          const out = join(dest, e.fileName);
          mkdirSync(dirname(out), { recursive: true });
          await pipeline(stream, createWriteStream(out));
          next();
        } catch (x) {
          reject(x);
        }
      });
    });
    zip.readEntry();
  });
}

export class BackupError extends Error {}

export const discardStaged = (dataDir: string) =>
  rmSync(join(dataDir, STAGED), { recursive: true, force: true });

/**
 * Unpacks and validates a backup into `<dataDir>/restore-pending`; it replaces the live data at the
 * next start (the open database can't be swapped under the running server).
 */
export async function stageRestore(dataDir: string, file: string) {
  const staged = join(dataDir, STAGED);
  rmSync(staged, { recursive: true, force: true });
  try {
    await extract(file, staged).catch(() => {
      throw new BackupError("Not a valid backup file");
    });
    let m: { format?: unknown; app?: unknown };
    try {
      m = JSON.parse(await readFile(join(staged, "manifest.json"), "utf8"));
    } catch {
      throw new BackupError("Not a 3D Maker Suite backup");
    }
    if (m.app !== APP || typeof m.format !== "number" || !existsSync(join(staged, "app.sqlite")))
      throw new BackupError("Not a 3D Maker Suite backup");
    if (m.format > FORMAT)
      throw new BackupError("This backup was made by a newer version of the app");
    for (let f = m.format; f < FORMAT; f++) UPGRADES[f]?.(staged);
  } catch (e) {
    rmSync(staged, { recursive: true, force: true });
    throw e;
  }
}

/** Called before the database opens. Swaps in a staged restore, keeping the old data in `pre-restore`. */
export function applyPendingRestore(dataDir: string): boolean {
  const staged = join(dataDir, STAGED);
  if (!existsSync(join(staged, "manifest.json"))) return false;
  const prev = join(dataDir, PREVIOUS);
  rmSync(prev, { recursive: true, force: true });
  mkdirSync(prev, { recursive: true });
  const live = readdirSync(dataDir).filter(
    (n) => n.startsWith("app.sqlite") || FILES.includes(n) || DIRS.includes(n),
  );
  for (const n of live) renameSync(join(dataDir, n), join(prev, n));
  for (const n of readdirSync(staged).filter((n) => n !== "manifest.json"))
    renameSync(join(staged, n), join(dataDir, n));
  rmSync(staged, { recursive: true, force: true });
  return true;
}
