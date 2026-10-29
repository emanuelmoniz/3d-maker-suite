import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  compareVersions,
  type InstallableRelease,
  type IntegrationAdapter,
  installable,
  type Release,
  type SlicerInstallStatus,
  type SlicerRelease,
  type SlicerSystem,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  cleanPartials,
  InstallError,
  installSlicer,
  PHASE_ERRORS,
  removeSlicer,
  smokeTest,
  systemInfo,
} from "@3d-maker-suite/host";
import { and, eq, isNull } from "drizzle-orm";
import { raise } from "../alerts/evaluate.ts";
import { HttpError } from "../errors.ts";
import { fetchReleases, repoReleasesUrl } from "../updates/updates.ts";

// Server integrations download their slicer from the vendor's GitHub releases (ADR-0013):
// <dataDir>/slicers/<integrationId>/<version>/ holds the program (packages/host installs it),
// config/system points at its profiles and config/user keeps the user presets of an imported zip.

const { alerts, devices, integrations } = schema;
const RELEASES_TTL_MS = 60 * 60_000; // GitHub allows 60 unauthenticated requests an hour

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

/** The server and worker slicers of a slicer library (e.g. Bambu Studio (server) for "bambu-studio"). */
const managedOf = (db: Db, adapters: IntegrationAdapter[], library?: string) =>
  db
    .select()
    .from(integrations)
    .all()
    .flatMap((row) => {
      const adapter = adapters.find((a) => a.id === row.adapterId);
      return adapter?.managed && (!library || adapter.library?.id === library)
        ? [{ row, adapter, managed: adapter.managed }]
        : [];
    });

/** A worker's device's system (`X-Connector-System`); null before it reported one. */
export function workerSystem(db: Db, row: typeof integrations.$inferSelect) {
  const deviceId = workerConfigSchema.safeParse(row.config).data?.deviceId;
  return deviceId
    ? (db.select({ system: devices.system }).from(devices).where(eq(devices.id, deviceId)).get()
        ?.system ?? null)
    : null;
}

/**
 * A slicer zip's presets go to every server and worker slicer of its library, in
 * `<dataDir>/slicers/<integrationId>/config`, so slicing finds them; installed or not yet. A server
 * slicer takes its user presets (`<root>/user`; its system ones are its install's). A worker takes
 * the whole config, system and user, since the hub slices its presets for it (ADR-0014).
 */
export function keepPresets(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  library: string,
  root: string,
) {
  if (!dataDir) return;
  for (const { row, adapter } of managedOf(db, adapters, library)) {
    const config = join(dataDir, "slicers", row.id, "config");
    const parts = adapter.kind === "worker" ? ["system", "user"] : ["user"];
    for (const part of parts) {
      if (!existsSync(join(root, part))) continue;
      rmSync(join(config, part), { recursive: true, force: true });
      cpSync(join(root, part), join(config, part), { recursive: true });
    }
    if (adapter.kind === "worker" && existsSync(join(config, "system")))
      db.update(integrations)
        .set({ slicerConfigDir: config, updatedAt: new Date().toISOString() })
        .where(eq(integrations.id, row.id))
        .run();
  }
}

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
    onInstalled = () => {},
  }: {
    releases?: (url: string) => Promise<Release[]>;
    download?: typeof fetch;
    smoke?: (exe: string) => Promise<unknown>;
    system?: SlicerSystem;
    /** After a version replaced the old one (its slices are then outdated). */
    onInstalled?: (id: string) => void;
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

  /** The system a slicer runs on: the server's, or a worker's device's. */
  const systemOf = (id: string) => {
    const { row, adapter } = managedRow(id);
    return adapter.kind === "worker" ? workerSystem(db, row) : system;
  };

  async function list(id: string, pre: boolean): Promise<InstallableRelease[]> {
    const { managed } = managedRow(id);
    const sys = systemOf(id);
    if (!sys) return [];
    let hit = cache.get(managed.repo);
    if (!hit || Date.now() - hit.at > RELEASES_TTL_MS) {
      const all = await fetchAll(repoReleasesUrl(managed.repo)).catch((err) => {
        log.warn({ err, repo: managed.repo }, "slicer releases check failed");
        throw new HttpError(502, "fetch_failed", "Could not read the slicer's releases");
      });
      hit = { at: Date.now(), list: all };
      cache.set(managed.repo, hit);
    }
    return installable(hit.list, managed, sys, pre);
  }

  /** Resolves the integration's open "slicer update" alerts whose version `stale` says is no news. */
  function resolveAlerts(id: string, stale: (version: string) => boolean) {
    const now = new Date().toISOString();
    for (const a of db
      .select({ id: alerts.id, context: alerts.context })
      .from(alerts)
      .where(and(eq(alerts.kind, "slicer_update"), isNull(alerts.resolvedAt)))
      .all())
      if (a.context.integrationId === id && stale(String(a.context.version)))
        db.update(alerts).set({ resolvedAt: now, updatedAt: now }).where(eq(alerts.id, a.id)).run();
  }

  /** A version is in place: its update alerts are done, its slices outdated. */
  function installed(id: string, version: string) {
    resolveAlerts(id, (v) => compareVersions(v, version) <= 0);
    onInstalled(id);
  }

  async function run(id: string, rel: InstallableRelease) {
    const { managed } = managedRow(id);
    const dir = dirOf(id);
    const version = rel.tag.replace(/^v/i, "");
    try {
      const exe = await installSlicer(
        dir,
        { version, asset: rel.asset, exe: managed.exe(system.platform) },
        {
          download,
          smoke,
          keep: ["config"],
          onProgress: (p) => Object.assign(job, p),
        },
      );
      const config = join(dir, "config");
      const systemLink = join(config, "system");
      mkdirSync(config, { recursive: true });
      rmSync(systemLink, { recursive: true, force: true }); // the link only, never its target
      symlinkSync(join(dir, version, managed.profiles(system.platform)), systemLink, "junction");
      db.update(integrations)
        .set({
          slicerPath: exe,
          slicerConfigDir: config,
          slicerVersion: version,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(integrations.id, id))
        .run();
      Object.assign(job, { state: "done", phase: null, finishedAt: new Date().toISOString() });
      installed(id, version);
    } catch (err) {
      log.warn({ err, integrationId: id, tag: rel.tag }, "slicer install failed");
      const e =
        err instanceof InstallError
          ? err
          : new InstallError(PHASE_ERRORS[job.phase ?? "download"], String((err as Error).message));
      Object.assign(job, {
        state: "failed",
        error: e.code,
        detail: e.detail ?? null,
        phase: null,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  if (dataDir) cleanPartials(root);

  return {
    /**
     * The daily check: a newer release of an installed slicer (pre-releases only when one is
     * installed, as the card's Update) raises one alert per version; older ones resolve.
     */
    async check() {
      for (const { row } of managedOf(db, adapters)) {
        const installed = row.slicerVersion;
        if (!installed) {
          resolveAlerts(row.id, () => true);
          continue;
        }
        const newest = await list(row.id, installed.includes("-")).then(
          (l) => l[0],
          () => null, // logged by `list`; its alerts stay as they are
        );
        if (newest === null) continue;
        const version = newest?.tag.replace(/^v/i, "");
        resolveAlerts(row.id, (v) => v !== version);
        if (version && compareVersions(version, installed) > 0)
          raise(db, {
            kind: "slicer_update",
            severity: "success",
            module: "integrations",
            task: `slicer:${row.id}`,
            entityType: "integration",
            entityId: `${row.id}:${version}`,
            context: { integrationId: row.id, adapterId: row.adapterId, version },
          });
      }
    },

    /** Its installable releases (a worker's: for its device), newest first, with their assets. */
    installable: list,
    systemOf,
    installed,
    resolveAlerts,

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

    /**
     * Deletes the slicer; `forget` (Remove, not integration delete) also clears the row and keeps
     * the user presets for the next install.
     */
    remove: (id: string, forget = true) => {
      if (job.id === id) busy();
      const dir = dirOf(id);
      resolveAlerts(id, () => true);
      if (!forget) rmSync(dir, { recursive: true, force: true });
      else {
        removeSlicer(dir, ["config"]);
        rmSync(join(dir, "config", "system"), { recursive: true, force: true }); // the link only
      }
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
