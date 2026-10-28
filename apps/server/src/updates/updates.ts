import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import { BundleError, fetchBundle as downloadBundle } from "@3d-maker-suite/host";
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
// APP_RELEASES_URL: a stand-in for GitHub, to test bundle updates against local builds.
const RELEASES =
  process.env.APP_RELEASES_URL ??
  `${REPO_URL.replace("github.com/", "api.github.com/repos/")}/releases?per_page=30`;
// ponytail: fixed; make it a preference if anyone asks.
const KEEP = 5;
/** Bundles: the data as it was right before an update or rollback; the launcher restores it if that fails. */
const UNDO = "update-undo";
const OS: Record<string, string> = { win32: "windows", darwin: "macos", linux: "linux" };
/** The Node major a package.json asks for in `engines.node` (">=22"), or 0. */
const nodeNeeded = (pkg: { engines?: { node?: string } }) =>
  Number(/>=\s*(\d+)/.exec(pkg.engines?.node ?? "")?.[1] ?? 0);

const githubReleases = z.array(
  z.object({
    tag_name: z.string(),
    prerelease: z.boolean(),
    draft: z.boolean(),
    html_url: z.string(),
    assets: z
      .array(
        z.object({
          name: z.string(),
          size: z.number(),
          digest: z.string().nullish(),
          browser_download_url: z.string(),
        }),
      )
      .default([]),
  }),
);
const history = z.array(updateHistoryEntrySchema);

/** Which kind of install this is decides what Update does (ADR-0009, ADR-0011). */
export function installType(root = ROOT, env = process.env): InstallType {
  if (env.APP_INSTALL === "docker") return "docker";
  if (env.APP_INSTALL === "bundle") return "bundle";
  if (env.npm_lifecycle_event === "dev") return "dev";
  return env.APP_LAUNCHER && existsSync(join(root, ".git")) ? "git" : "other";
}

/** A GitHub releases list (newest 30, no drafts): this app's, or a managed slicer's (ADR-0013). */
export const fetchReleases = async (url = RELEASES): Promise<Release[]> => {
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "3d-maker-suite" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return githubReleases
    .parse(await res.json())
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      prerelease: r.prerelease,
      url: r.html_url,
      assets: r.assets.map((a) => ({
        name: a.name,
        size: a.size,
        digest: a.digest ?? undefined,
        url: a.browser_download_url,
      })),
    }));
};

export const repoReleasesUrl = (repo: string) =>
  `https://api.github.com/repos/${repo}/releases?per_page=30`;

/**
 * Checks GitHub releases and prepares updates and rollbacks for the launcher (scripts/update.mjs,
 * or packaging/launcher.mjs on bundles): it backs up, fetches, writes .update/pending.json, and the
 * caller restarts. History lives in `<dataDir>/updates.json`, outside the DB a rollback restores.
 */
export function createUpdater(
  db: Db,
  dataDir: string,
  log: { warn: (o: object, m: string) => void },
  {
    root = ROOT,
    version = VERSION,
    install = installType(root),
    releases: fetchAll = () => fetchReleases(),
    installDir = process.env.APP_INSTALL_DIR ?? "",
    shipped = process.env.APP_SHIPPED_VERSION,
    download = fetch,
  }: {
    root?: string;
    version?: string;
    install?: InstallType;
    releases?: () => Promise<Release[]>;
    /** Bundles: the folder with versions/ and .update/ (ADR-0011). */
    installDir?: string;
    /** macOS: the version inside the .app, which is never deleted. */
    shipped?: string;
    download?: typeof fetch;
  } = {},
) {
  const historyFile = dataDir && join(dataDir, "updates.json");
  const bundle = install === "bundle";
  const updateDir = join(bundle ? installDir : root, ".update");
  const versionsDir = join(installDir, "versions");
  const undoDir = join(dataDir, UNDO);
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
    compareVersions(e.fromVersion, version) < 0 &&
    // A bundle goes back to a version folder it still has.
    (!bundle || e.fromVersion === shipped || existsSync(join(versionsDir, e.fromVersion)));

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

  /**
   * Common to update and rollback: one at a time, clean tree (git), then hand over to the launcher.
   * `after` runs once pending.json exists (a bundle's new folder may only appear then).
   */
  async function prepare(
    make: () => Promise<{ action: string; ref: string; toVersion: string; backup: string }>,
    after?: () => void,
  ) {
    if (install !== "git" && !bundle)
      throw new HttpError(
        409,
        "not_git",
        "Updates run only on an installed app or a git install started by pnpm start",
      );
    if (busy) throw new HttpError(409, "busy", "An update is already running");
    busy = true;
    // A result nobody read yet would be overwritten by this hand-over's.
    if (bundle) collectResult();
    try {
      let from = version;
      if (!bundle) {
        const dirty = await git("status", "--porcelain", "--untracked-files=no").catch(() => {
          throw new HttpError(500, "git_failed", "git did not run");
        });
        if (dirty) throw new HttpError(409, "dirty", "The app's folder has local changes");
        from = await git("rev-parse", "HEAD");
      }
      const pending = { ...(await make()), from, fromVersion: version };
      mkdirSync(updateDir, { recursive: true });
      writeFileSync(join(updateDir, "pending.json"), JSON.stringify(pending, null, 2));
      after?.();
    } catch (e) {
      busy = false;
      throw e;
    }
    // Stays busy: the server restarts next.
  }

  /** Bundles: backs up and stages that backup as the launcher's undo; returns the backup's name. */
  async function stageUndo(kind: "update" | "undo") {
    const backup = await createBackup(db, dataDir, kind);
    rmSync(undoDir, { recursive: true, force: true });
    await stageRestore(dataDir, join(backupsDir(dataDir), backup.name));
    renameSync(stagedDir(dataDir), undoDir);
    return backup.name;
  }

  /**
   * Bundles: downloads this platform's app zip for `tag`, checks it against SHA256SUMS and unpacks
   * it to versions/<v>.partial. Returns that folder.
   */
  async function fetchBundle(tag: string) {
    const fail = () => new HttpError(502, "fetch_failed", "Could not download the release");
    const release = (releases ?? (await fetchAll().catch(() => []))).find((r) => r.tag === tag);
    if (!release) throw fail();
    const base = release.url.replace("/releases/tag/", "/releases/download/");
    const asset = `3d-maker-suite-${tag}-app-${OS[process.platform]}-${process.arch}.zip`;
    const partial = join(versionsDir, `${tag.slice(1)}.partial`);
    await downloadBundle(base, asset, partial, download).catch((e) => {
      throw e instanceof BundleError && e.code === "bad_checksum"
        ? new HttpError(502, "bad_checksum", "The download does not match its checksum")
        : fail();
    });
    try {
      const pkg = JSON.parse(readFileSync(join(partial, "package.json"), "utf8"));
      if (nodeNeeded(pkg) > Number(process.versions.node.split(".")[0]))
        throw new HttpError(409, "needs_installer", "This release needs the new installer");
    } catch (e) {
      rmSync(partial, { recursive: true, force: true });
      throw e instanceof HttpError ? e : fail();
    }
    return partial;
  }

  // At start: record what the launcher did, and drop alerts for versions already running.
  if (install === "git" || bundle) collectResult();
  resolveAlerts((tag) => !RELEASE_TAG.test(tag) || compareVersions(tag, version) <= 0);

  return {
    check,
    view: (): UpdatesResponse => {
      // A bundle's launcher writes its result once the new version answers, after this started.
      if (bundle) collectResult();
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

    apply: (tag: string) => {
      let partial = "";
      return prepare(
        async () => {
          if (!RELEASE_TAG.test(tag)) throw new HttpError(400, "bad_tag", "Not a release tag");
          if (compareVersions(tag, version) <= 0)
            throw new HttpError(409, "not_newer", "That version is not newer");
          const pending = { action: "update", ref: tag, toVersion: tag.slice(1) };
          if (bundle) {
            partial = await fetchBundle(tag);
            const backup = await stageUndo("update");
            return { ...pending, backup, undo: undoDir, restoreDir: stagedDir(dataDir) };
          }
          await git("fetch", "origin", "tag", tag, "--no-tags").catch(() => {
            throw new HttpError(502, "fetch_failed", "Could not download the release");
          });
          const backup = await createBackup(db, dataDir, "update");
          return { ...pending, backup: backup.name };
        },
        // Only now the newest folder: the launcher always finds pending.json beside it.
        () => {
          if (!partial) return;
          const to = join(versionsDir, tag.slice(1));
          rmSync(to, { recursive: true, force: true });
          renameSync(partial, to);
        },
      );
    },

    rollback: (backup: string) =>
      prepare(async () => {
        const e = readHistory().find((h) => h.backup === backup && canRollBack(h));
        if (!e) throw new HttpError(404, "not_found", "Nothing to roll back to with that backup");
        let undo: string | undefined;
        if (bundle) {
          // The undo only needs its staged copy (its own prefix: never the target's name).
          rmSync(join(backupsDir(dataDir), await stageUndo("undo")), { force: true });
          undo = undoDir;
        }
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
          ...(undo && { undo }),
        };
      }),
  };
}

export type Updater = ReturnType<typeof createUpdater>;
