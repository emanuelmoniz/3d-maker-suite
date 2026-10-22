import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  compareVersions,
  type InstallType,
  pickRelease,
  RELEASE_TAG,
  REPO_URL,
  type Release,
  type UpdateHistoryEntry,
  type UpdatesResponse,
  updateHistoryEntrySchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { raise } from "../alerts/evaluate.ts";
import {
  BackupError,
  backupsDir,
  createBackup,
  stagedDir,
  stageRestore,
} from "../backup/backup.ts";
import { HttpError } from "../errors.ts";
import { readPreferences } from "../lib/preferences.ts";

/** The repo (or image) root: its package.json is the app's version; .update/ talks to the launcher. */
export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const VERSION: string = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const RELEASES = `${REPO_URL.replace("github.com/", "api.github.com/repos/")}/releases?per_page=30`;
// ponytail: fixed; make it a preference if anyone asks.
const KEEP = 5;

const githubReleases = z.array(
  z.object({
    tag_name: z.string(),
    prerelease: z.boolean(),
    draft: z.boolean(),
    html_url: z.string(),
  }),
);
const history = z.array(updateHistoryEntrySchema);

/** Which kind of install this is decides what Update does (ADR-0009). */
export function installType(root = ROOT, env = process.env): InstallType {
  if (env.APP_INSTALL === "docker") return "docker";
  if (env.npm_lifecycle_event === "dev") return "dev";
  return env.APP_LAUNCHER && existsSync(join(root, ".git")) ? "git" : "other";
}

const fetchReleases = async (): Promise<Release[]> => {
  const res = await fetch(RELEASES, {
    headers: { accept: "application/vnd.github+json", "user-agent": "3d-maker-suite" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return githubReleases
    .parse(await res.json())
    .filter((r) => !r.draft)
    .map((r) => ({ tag: r.tag_name, prerelease: r.prerelease, url: r.html_url }));
};

/**
 * Checks GitHub releases and prepares updates and rollbacks for the launcher (scripts/update.mjs):
 * it backs up, fetches, writes .update/pending.json, and the caller restarts. History lives in
 * `<dataDir>/updates.json`, outside the DB a rollback restores.
 */
export function createUpdater(
  db: Db,
  dataDir: string,
  log: { warn: (o: object, m: string) => void },
  {
    root = ROOT,
    version = VERSION,
    install = installType(root),
    releases: fetchAll = fetchReleases,
  }: {
    root?: string;
    version?: string;
    install?: InstallType;
    releases?: () => Promise<Release[]>;
  } = {},
) {
  const historyFile = dataDir && join(dataDir, "updates.json");
  const updateDir = join(root, ".update");
  let releases: Release[] | null = null;
  let checkedAt: string | null = null;
  let checkFailed = false;
  let busy = false;

  const git = async (...args: string[]) =>
    (await promisify(execFile)("git", args, { cwd: root })).stdout.trim();

  const readHistory = (): UpdateHistoryEntry[] => {
    try {
      return history.parse(JSON.parse(readFileSync(historyFile, "utf8")));
    } catch {
      return [];
    }
  };
  const canRollBack = (e: UpdateHistoryEntry) =>
    e.action === "update" &&
    e.ok &&
    existsSync(join(backupsDir(dataDir), e.backup)) &&
    compareVersions(e.fromVersion, version) < 0;

  /** The launcher's result of the last update or rollback joins the history, newest first. */
  function collectResult() {
    const file = join(updateDir, "result.json");
    if (!historyFile || !existsSync(file)) return;
    try {
      const r = JSON.parse(readFileSync(file, "utf8"));
      const all = [
        updateHistoryEntrySchema.parse({ ...r, at: new Date().toISOString(), fromSha: r.from }),
        ...readHistory(),
      ];
      const kept = all.slice(0, KEEP);
      // Update backups belong to their entry and go with it.
      for (const e of all.slice(KEEP))
        if (e.backup.startsWith("update-") && !kept.some((k) => k.backup === e.backup))
          rmSync(join(backupsDir(dataDir), e.backup), { force: true });
      writeFileSync(historyFile, `${JSON.stringify(kept, null, 2)}\n`);
    } catch (err) {
      log.warn({ err }, "could not read the last update's result");
    } finally {
      rmSync(file, { force: true });
    }
  }

  /** Resolves the open "update available" alerts whose release `stale` says is no longer news. */
  function resolveAlerts(stale: (tag: string) => boolean) {
    const now = new Date().toISOString();
    const { alerts } = schema;
    for (const a of db
      .select({ id: alerts.id, tag: alerts.entityId })
      .from(alerts)
      .where(and(eq(alerts.kind, "update_available"), isNull(alerts.resolvedAt)))
      .all())
      if (stale(a.tag))
        db.update(alerts).set({ resolvedAt: now, updatedAt: now }).where(eq(alerts.id, a.id)).run();
  }

  const latest = () =>
    releases && pickRelease(releases, readPreferences(db).updateChannel, version);

  /** Reads GitHub; a newer release on the channel raises one alert per version. */
  async function check() {
    try {
      releases = await fetchAll();
      checkFailed = false;
    } catch (err) {
      checkFailed = true;
      log.warn({ err }, "update check failed");
    }
    checkedAt = new Date().toISOString();
    if (!releases) return;
    const l = latest();
    resolveAlerts((tag) => tag !== l?.tag);
    if (l)
      raise(db, {
        kind: "update_available",
        severity: "success",
        module: "system",
        task: "update",
        entityType: "release",
        entityId: l.tag,
        context: { version: l.tag.slice(1) },
      });
  }

  /** Common to update and rollback: one at a time, clean tree, then hand over to the launcher. */
  async function prepare(
    make: () => Promise<{ action: string; ref: string; toVersion: string; backup: string }>,
  ) {
    if (install !== "git")
      throw new HttpError(
        409,
        "not_git",
        "Updates run only on a git install started by pnpm start",
      );
    if (busy) throw new HttpError(409, "busy", "An update is already running");
    busy = true;
    try {
      const dirty = await git("status", "--porcelain", "--untracked-files=no").catch(() => {
        throw new HttpError(500, "git_failed", "git did not run");
      });
      if (dirty) throw new HttpError(409, "dirty", "The app's folder has local changes");
      const from = await git("rev-parse", "HEAD");
      const pending = { ...(await make()), from, fromVersion: version };
      mkdirSync(updateDir, { recursive: true });
      writeFileSync(join(updateDir, "pending.json"), JSON.stringify(pending, null, 2));
    } catch (e) {
      busy = false;
      throw e;
    }
    // Stays busy: the server restarts next.
  }

  // At start: record what the launcher did, and drop alerts for versions already running.
  if (install === "git") collectResult();
  resolveAlerts((tag) => !RELEASE_TAG.test(tag) || compareVersions(tag, version) <= 0);

  return {
    check,
    view: (): UpdatesResponse => {
      const l = latest();
      return {
        version,
        install,
        latest: l ? { tag: l.tag, url: l.url } : null,
        checkedAt,
        checkFailed,
        history: historyFile
          ? readHistory().map((e) => ({ ...e, canRollBack: canRollBack(e) }))
          : [],
      };
    },

    apply: (tag: string) =>
      prepare(async () => {
        if (!RELEASE_TAG.test(tag)) throw new HttpError(400, "bad_tag", "Not a release tag");
        if (compareVersions(tag, version) <= 0)
          throw new HttpError(409, "not_newer", "That version is not newer");
        await git("fetch", "origin", "tag", tag, "--no-tags").catch(() => {
          throw new HttpError(502, "fetch_failed", "Could not download the release");
        });
        const backup = await createBackup(db, dataDir, "update");
        return { action: "update", ref: tag, toVersion: tag.slice(1), backup: backup.name };
      }),

    rollback: (backup: string) =>
      prepare(async () => {
        const e = readHistory().find((h) => h.backup === backup && canRollBack(h));
        if (!e) throw new HttpError(404, "not_found", "Nothing to roll back to with that backup");
        try {
          await stageRestore(dataDir, join(backupsDir(dataDir), backup));
        } catch (err) {
          if (err instanceof BackupError) throw new HttpError(400, "invalid_backup", err.message);
          throw err;
        }
        return {
          action: "rollback",
          ref: e.fromSha,
          toVersion: e.fromVersion,
          backup,
          // The launcher drops it if the rollback fails, so this version never opens the old DB.
          restoreDir: stagedDir(dataDir),
        };
      }),
  };
}

export type Updater = ReturnType<typeof createUpdater>;
