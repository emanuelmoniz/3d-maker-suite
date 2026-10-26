import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import {
  type InstallableRelease,
  type IntegrationAdapter,
  installable,
  type Release,
  type SlicerInstallError,
  type SlicerInstallStatus,
  type SlicerRelease,
  type SlicerSystem,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { extract } from "../backup/backup.ts";
import { HttpError } from "../errors.ts";
import { fetchReleases, repoReleasesUrl } from "../updates/updates.ts";

// Server integrations download their slicer from the vendor's GitHub releases (ADR-0013):
// <dataDir>/slicers/<integrationId>/<version>/ holds the program, config/system points at its
// profiles. A new version replaces the old one only once its smoke test passed.

const { integrations } = schema;
const RELEASES_TTL_MS = 60 * 60_000; // GitHub allows 60 unauthenticated requests an hour
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;
const SMOKE_TIMEOUT_MS = 60_000;
/** Windows' STATUS_DLL_NOT_FOUND: Bambu's zip relies on the system's VC++ runtime. */
const DLL_NOT_FOUND = 0xc0000135 | 0;

class InstallError extends Error {
  readonly code: SlicerInstallError;
  readonly detail?: string;
  constructor(code: SlicerInstallError, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.detail = detail;
  }
}

/** Runs a program with its output ignored (an AppImage lists every file it extracts). */
const exec = (cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}) =>
  new Promise<number>((ok, fail) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: "ignore",
      windowsHide: true,
      ...(opts.timeoutMs && { signal: AbortSignal.timeout(opts.timeoutMs) }),
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => ok(code ?? (signal ? -1 : 0)));
  });

const must = async (cmd: string, args: string[], cwd?: string) => {
  const code = await exec(cmd, args, { cwd });
  if (code !== 0) throw new Error(`${cmd} exited with ${code}`);
};

/** The program starts and exits cleanly with `--help`, in a temp cwd: it writes result.json and a log. */
export async function smokeTest(exe: string) {
  const cwd = mkdtempSync(join(tmpdir(), "3dms-smoke-"));
  const code = await exec(exe, ["--help"], { cwd, timeoutMs: SMOKE_TIMEOUT_MS })
    .catch((e: Error) => {
      throw new InstallError("smoke_failed", e.message);
    })
    .finally(() => rmSync(cwd, { recursive: true, force: true }));
  if ((code | 0) === DLL_NOT_FOUND) throw new InstallError("vcredist_missing");
  if (code !== 0) throw new InstallError("smoke_failed", `exit ${code | 0}`);
}

/** By extension (ADR-0013): yauzl without debug symbols, hdiutil, or the AppImage itself. */
async function unpack(file: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  if (file.endsWith(".zip")) return extract(file, dest, (n) => !n.endsWith(".pdb"));
  if (file.endsWith(".dmg")) {
    const mnt = mkdtempSync(join(tmpdir(), "3dms-dmg-"));
    try {
      await must("hdiutil", [
        "attach",
        "-nobrowse",
        "-readonly",
        "-noautoopen",
        "-mountpoint",
        mnt,
        file,
      ]);
      try {
        for (const app of readdirSync(mnt).filter((n) => n.endsWith(".app")))
          await must("cp", ["-R", join(mnt, app), dest]);
      } finally {
        await exec("hdiutil", ["detach", mnt, "-force"]).catch(() => {});
      }
    } finally {
      rmSync(mnt, { recursive: true, force: true });
    }
    return;
  }
  chmodSync(file, 0o755);
  await must(file, ["--appimage-extract"], dest);
}

export function systemInfo(): SlicerSystem {
  const report =
    process.platform === "linux"
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
      : undefined;
  return {
    platform: process.platform,
    arch: process.arch,
    glibc: report?.header?.glibcVersionRuntime,
  };
}

const idle = (): SlicerInstallStatus => ({
  state: "idle",
  phase: null,
  tag: null,
  received: 0,
  total: 0,
  error: null,
  detail: null,
  startedAt: null,
  finishedAt: null,
});

/** A phase's error when the failure wasn't one of ours (e.g. a full disk). */
const PHASE_ERRORS = {
  download: "fetch_failed",
  verify: "bad_digest",
  unpack: "unpack_failed",
  test: "smoke_failed",
} as const;

export function createSlicerInstaller(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  log: { warn: (o: object, m: string) => void },
  {
    releases: fetchAll = fetchReleases,
    download = fetch,
    smoke = smokeTest,
    system = systemInfo(),
  }: {
    releases?: (url: string) => Promise<Release[]>;
    download?: typeof fetch;
    smoke?: (exe: string) => Promise<void>;
    system?: SlicerSystem;
  } = {},
) {
  const root = join(dataDir, "slicers");
  const dirOf = (id: string) => join(root, id);
  const cache = new Map<string, { at: number; list: Release[] }>();
  // ponytail: one install at a time, server-wide; they're 0.5 GB each.
  let job: SlicerInstallStatus & { id: string | null } = { ...idle(), id: null };

  const managedRow = (id: string) => {
    const row = db.select().from(integrations).where(eq(integrations.id, id)).get();
    if (!row) throw new HttpError(404, "not_found", "Integration not found");
    const adapter = adapters.find((a) => a.id === row.adapterId);
    if (!adapter?.managed)
      throw new HttpError(400, "not_managed", "This integration has no managed slicer");
    return { row, adapter, managed: adapter.managed };
  };
  const running = () => job.state === "running";
  const busy = () => {
    if (running()) throw new HttpError(409, "install_running", "A slicer install is running");
  };

  async function list(id: string, pre: boolean): Promise<InstallableRelease[]> {
    const { managed } = managedRow(id);
    let hit = cache.get(managed.repo);
    if (!hit || Date.now() - hit.at > RELEASES_TTL_MS) {
      const all = await fetchAll(repoReleasesUrl(managed.repo)).catch((err) => {
        log.warn({ err, repo: managed.repo }, "slicer releases check failed");
        throw new HttpError(502, "fetch_failed", "Could not read the slicer's releases");
      });
      hit = { at: Date.now(), list: all };
      cache.set(managed.repo, hit);
    }
    return installable(hit.list, managed, system, pre);
  }

  async function run(id: string, rel: InstallableRelease) {
    const { managed } = managedRow(id);
    const dir = dirOf(id);
    const version = rel.tag.replace(/^v/i, "");
    const file = join(dir, `download${extname(rel.asset.name)}`);
    const partial = join(dir, `${version}.partial`);
    const phase = (p: SlicerInstallStatus["phase"]) => {
      job.phase = p;
    };
    try {
      mkdirSync(dir, { recursive: true });
      rmSync(partial, { recursive: true, force: true });
      const res = await download(rel.asset.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) throw new InstallError("fetch_failed", `HTTP ${res.status}`);
      const hash = createHash("sha256");
      await pipeline(
        Readable.fromWeb(res.body as ReadableStream),
        new Transform({
          transform(chunk: Buffer, _enc, done) {
            hash.update(chunk);
            job.received += chunk.length;
            done(null, chunk);
          },
        }),
        createWriteStream(file),
      );

      phase("verify");
      if (`sha256:${hash.digest("hex")}` !== rel.asset.digest) throw new InstallError("bad_digest");

      phase("unpack");
      await unpack(file, partial);
      rmSync(file, { force: true });

      phase("test");
      await smoke(join(partial, managed.exe(system.platform)));

      // Only now the new version replaces the old one.
      const target = join(dir, version);
      rmSync(target, { recursive: true, force: true });
      renameSync(partial, target);
      const config = join(dir, "config");
      const systemLink = join(config, "system");
      mkdirSync(config, { recursive: true });
      rmSync(systemLink, { recursive: true, force: true }); // the link only, never its target
      symlinkSync(join(target, managed.profiles(system.platform)), systemLink, "junction");
      db.update(integrations)
        .set({
          slicerPath: join(target, managed.exe(system.platform)),
          slicerConfigDir: config,
          slicerVersion: version,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(integrations.id, id))
        .run();
      for (const old of readdirSync(dir))
        if (old !== version && old !== "config")
          rmSync(join(dir, old), { recursive: true, force: true });
      Object.assign(job, { state: "done", phase: null, finishedAt: new Date().toISOString() });
    } catch (err) {
      rmSync(partial, { recursive: true, force: true });
      rmSync(file, { force: true });
      log.warn({ err, integrationId: id, tag: rel.tag }, "slicer install failed");
      Object.assign(job, {
        state: "failed",
        error: err instanceof InstallError ? err.code : PHASE_ERRORS[job.phase ?? "download"],
        detail: err instanceof InstallError ? (err.detail ?? null) : String((err as Error).message),
        phase: null,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  // A restart mid-install leaves a half folder or download behind.
  if (dataDir && existsSync(root))
    for (const id of readdirSync(root))
      for (const f of readdirSync(dirOf(id)))
        if (f.endsWith(".partial") || f.startsWith("download."))
          rmSync(join(dirOf(id), f), { recursive: true, force: true });

  return {
    /** Installable releases of this integration's slicer, newest first. */
    releases: async (id: string, pre: boolean): Promise<SlicerRelease[]> =>
      (await list(id, pre)).map((r) => ({
        tag: r.tag,
        prerelease: r.prerelease,
        url: r.url,
        size: r.asset.size,
      })),

    status: (id: string): SlicerInstallStatus => {
      const { id: owner, ...s } = job;
      return owner === id ? s : idle();
    },

    /** Starts the job and returns at once; poll `status`. */
    install: async (id: string, tag: string) => {
      busy();
      const rel = (await list(id, true)).find((r) => r.tag === tag);
      if (!rel) throw new HttpError(404, "unknown_release", "No such release for this system");
      busy(); // the list may have taken a while
      job = {
        ...idle(),
        id,
        state: "running",
        phase: "download",
        tag,
        total: rel.asset.size,
        startedAt: new Date().toISOString(),
      };
      void run(id, rel);
      const { id: _, ...s } = job;
      return s;
    },

    /** Deletes the slicer's folder; `forget` also clears the row (Remove, not integration delete). */
    remove: (id: string, forget = true) => {
      if (job.id === id) busy();
      rmSync(dirOf(id), { recursive: true, force: true });
      if (forget)
        db.update(integrations)
          .set({
            slicerPath: null,
            slicerConfigDir: null,
            slicerVersion: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(integrations.id, id))
          .run();
    },
  };
}

export type SlicerInstaller = ReturnType<typeof createSlicerInstaller>;
