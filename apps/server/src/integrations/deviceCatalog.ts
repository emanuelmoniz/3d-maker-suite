import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import {
  type CatalogDirs,
  type CatalogInstallSlicer,
  type CatalogSources,
  type IntegrationAdapter,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import {
  findSlicers,
  isRunningIn,
  listProcesses,
  overlaySystem,
  zipFolder,
} from "@3d-maker-suite/host";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { deviceLibraries, hubSlicer, slicerConfigDir } from "./capabilities.ts";
import {
  catalogCards,
  catalogMismatch,
  catalogSource,
  release,
  sourceVersion,
} from "./catalogSource.ts";
import { workerSystem } from "./managedSlicer.ts";
import { openUpload, unpackSlicerZip } from "./slicerZip.ts";

const { devices, integrations } = schema;
type Row = typeof integrations.$inferSelect;
/** In a copy's `system/`: it came from a device. No reader looks at it, and no zip can carry it. */
const MARK = ".from-device";

/**
 * A machine's managed install keeps its system presets in the install, not in a config folder:
 * `<slicerPath minus the program>/<profiles>` (as the server's `config/system` link). Null = not one.
 */
export function managedSystemDir(row: Row, adapter: IntegrationAdapter, platform: string) {
  const managed = adapter.managed;
  if (!managed || !row.slicerPath) return null;
  const p = platform === "win32" ? path.win32 : path.posix;
  const up = managed
    .exe(platform)
    .split("/")
    .map(() => "..");
  return p.join(p.resolve(row.slicerPath, ...up), ...managed.profiles(platform).split("/"));
}

/**
 * A machine whose install is a library's hub's slicer is its catalog source (ADR-0020, ADR-0022):
 * its connector sends `system/` when the fingerprint changed, and the hub keeps it where a zip's
 * goes (`keepPresets`): the worker row's `config`, which `catalogDir` reads on a hub. So the
 * catalog check, the review, user presets' parents and All settings read it as they read any folder.
 * The server's own install receives the hub's copy as a machine does (`receiveHere`).
 */
export function createDeviceCatalog(
  db: Db,
  adapters: IntegrationAdapter[],
  channel: HubChannel,
  dataDir: string,
  /** A copy came in: the catalog check raises what changed. */
  onReceived: () => void = () => {},
  {
    processes = listProcesses,
    find = findSlicers,
  }: {
    /** The server's processes and installed slicers (tests). */
    processes?: () => Promise<string>;
    find?: typeof findSlicers;
  } = {},
) {
  const libraries = [...new Set(adapters.flatMap((a) => (a.library ? [a.library.id] : [])))];

  /** The device a library's copy comes from, and where it goes; null = none. */
  function target(lib: string) {
    const source = catalogSource(db, adapters, lib);
    const cards = catalogCards(db, adapters, lib);
    if (!dataDir || !source || !("deviceId" in source) || cards?.adapter.kind !== "worker")
      return null;
    const dir = join(dataDir, "slicers", cards.row.id, "config");
    return { deviceId: source.deviceId, library: cards.adapter.library, dir, row: cards.row };
  }

  /**
   * Where the hub reads a library's catalog (as `checkCatalogs` does): a source device's copy, else
   * the source row's folder; null = none.
   */
  function hubCopy(lib: string) {
    const t = target(lib);
    if (t) return t;
    const source = catalogSource(db, adapters, lib);
    const cards = catalogCards(db, adapters, lib);
    if (!source || !("integrationId" in source) || !cards) return null;
    const dir = slicerConfigDir(cards.row, cards.adapter);
    return dir ? { library: cards.adapter.library, dir } : null;
  }

  const fingerprintOf = async (copy: ReturnType<typeof hubCopy>) =>
    copy ? ((await copy.library?.catalogFingerprint?.(copy.dir).catch(() => null)) ?? null) : null;

  /** The hub's copy of `lib`'s `system/`, zipped to `file`; false = none. */
  async function zipHubCopy(lib: string, file: string) {
    const copy = hubCopy(lib);
    if (!copy) return false;
    // The mark goes too: a receiver writes only preset files (`overlaySystem`).
    await zipFolder(join(copy.dir, "system"), file, "system/");
    return true;
  }

  /**
   * The libraries `deviceId` receives the catalog of (ADR-0021), with the fingerprint of the hub's
   * copy: Receive catalog on, a slicer of it there, not its source, the same major.minor as it.
   */
  async function installsOf(deviceId: string): Promise<CatalogSources> {
    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
    const out: CatalogSources = {};
    for (const lib of device ? deviceLibraries(adapters, device.slicers) : []) {
      if (!device?.presetLibraries[lib]?.system.receive) continue;
      const source = catalogSource(db, adapters, lib);
      if (source && "deviceId" in source && source.deviceId === deviceId) continue;
      if (catalogMismatch(db, adapters, lib, device)) continue;
      out[lib] = await fingerprintOf(hubCopy(lib));
    }
    return out;
  }

  /**
   * The libraries `deviceId` is the source of, with the fingerprint of the hub's copy. Every
   * library, not only its found slicers': a managed install is found by no one.
   */
  async function sourcesOf(deviceId: string): Promise<CatalogSources> {
    const out: CatalogSources = {};
    for (const lib of libraries) {
      const t = target(lib);
      if (t?.deviceId === deviceId)
        out[lib] = (await t.library?.catalogFingerprint?.(t.dir).catch(() => null)) ?? null;
    }
    return out;
  }

  /** The `system/` folder on `deviceId` of each library it is the source of with a managed install. */
  function dirsOf(deviceId: string): CatalogDirs {
    const out: CatalogDirs = {};
    for (const lib of libraries) {
      const hub = target(lib)?.deviceId === deviceId ? hubSlicer(db, adapters, lib) : null;
      if (!hub || workerConfigSchema.safeParse(hub.row.config).data?.source !== "managed") continue;
      const platform = workerSystem(db, hub.row)?.platform;
      const dir = platform && managedSystemDir(hub.row, hub.adapter, platform);
      if (dir) out[lib] = dir;
    }
    return out;
  }

  /**
   * A copy whose library's source moved away: it goes, or user presets' parents and All settings
   * would still read it. A zip's copy has no mark (`keepPresets` replaces the whole folder).
   */
  function forgetMoved() {
    if (!dataDir) return;
    for (const row of db.select().from(integrations).all()) {
      const lib = adapters.find((a) => a.id === row.adapterId && a.kind === "worker")?.library;
      const dir = join(dataDir, "slicers", row.id, "config");
      if (lib && existsSync(join(dir, "system", MARK)) && target(lib.id)?.dir !== dir)
        rmSync(join(dir, "system"), { recursive: true, force: true });
    }
  }

  // ponytail: only the last write's backup is kept, as a machine's; keep more if one isn't enough.
  const backupOf = (row: Row) => join(dataDir, "catalog-backups", `${row.id}.zip`);

  /**
   * The server's own install receives (5.5.0 Step 11c): a local slicer with Receive on that isn't
   * its library's hub's slicer gets the hub's copy as a machine does (`catalogInstall.ts`): the
   * same major.minor, only while it's closed, a backup first, laid over its folder.
   */
  async function one(row: Row, adapter: IntegrationAdapter): Promise<CatalogInstallSlicer | null> {
    const lib = adapter.library?.id;
    const dir = slicerConfigDir(row, adapter);
    if (!lib || !adapter.desktop || !dir) return null;
    const installed = (await find([{ ...adapter.desktop, id: adapter.id, library: lib }]))[0];
    const here = release(installed?.version);
    const there = release(sourceVersion(db, adapters, lib));
    const hub = here && there && here !== there ? null : await fingerprintOf(hubCopy(lib));
    let fingerprint = await adapter.library?.catalogFingerprint?.(dir).catch(() => null);
    let waiting = false;
    let error: string | null = null;
    if (hub && fingerprint !== hub) {
      if (isRunningIn(await processes(), adapter.desktop.process)) waiting = true;
      else {
        const tmp = mkdtempSync(join(tmpdir(), "catalog-"));
        try {
          if (await zipHubCopy(lib, join(tmp, "system.zip"))) {
            await overlaySystem(join(tmp, "system.zip"), dir, backupOf(row));
            fingerprint = await adapter.library?.catalogFingerprint?.(dir).catch(() => null);
          }
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      }
    }
    const backup = await stat(backupOf(row)).then(
      (s) => ({ path: backupOf(row), at: s.mtime.toISOString() }),
      () => null,
    );
    return { library: lib, hub, fingerprint: fingerprint ?? null, waiting, backup, error };
  }

  let looking: Promise<void> | undefined;
  /** One look at a time, over every local slicer with Receive on. */
  function receiveHere() {
    looking ??= (async () => {
      if (!dataDir) return;
      for (const row of db.select().from(integrations).all()) {
        const adapter = adapters.find((a) => a.id === row.adapterId);
        if (!row.catalogReceive || adapter?.kind !== "local" || !adapter.library) continue;
        if (hubSlicer(db, adapters, adapter.library.id)?.row.id === row.id) continue;
        const state = await one(row, adapter);
        // Turned off (or picked) during the look: its state stays cleared.
        db.update(integrations)
          .set({ catalogInstall: state })
          .where(and(eq(integrations.id, row.id), eq(integrations.catalogReceive, true)))
          .run();
      }
    })().finally(() => {
      looking = undefined;
    });
    return looking;
  }

  /** Each event's payload, and what each online device was last told of it, so an unchanged one isn't sent again. */
  const kinds = {
    "catalog.sources": {
      of: async (id: string) => ({ libraries: await sourcesOf(id), dirs: dirsOf(id) }),
      told: new Map<string, string>(),
    },
    "catalog.install": {
      of: async (id: string) => ({ libraries: await installsOf(id) }),
      told: new Map<string, string>(),
    },
  };
  type Kind = keyof typeof kinds;
  type Payload = { libraries: CatalogSources; dirs?: CatalogDirs };
  const ask = (type: Kind, deviceId: string, payload: Payload) =>
    channel.ask(deviceId, (requestId) => ({ type, requestId, ...payload }), z.null());
  const connected = async (type: Kind, deviceId: string) => {
    const payload: Payload = await kinds[type].of(deviceId);
    kinds[type].told.set(deviceId, JSON.stringify(payload));
    return payload;
  };

  return {
    sourcesOf,
    installsOf,
    dirsOf,
    receiveHere,

    /** A connect's `X-Catalog-Sources` and `X-Catalog-Dirs`: what the device now knows. */
    connected: (deviceId: string) => connected("catalog.sources", deviceId),
    /** A connect's `X-Catalog-Install`. */
    connectedInstall: async (deviceId: string) =>
      (await connected("catalog.install", deviceId)).libraries,

    /** Before a pick of `deviceId`: 409 `device_outdated` from a connector that can't send. */
    async confirm(deviceId: string) {
      if (channel.online(deviceId))
        await ask("catalog.sources", deviceId, await kinds["catalog.sources"].of(deviceId));
    },

    /** Before Receive catalog goes on: 409 `device_outdated` from a connector that can't write. */
    async confirmInstall(deviceId: string) {
      if (channel.online(deviceId))
        await ask("catalog.install", deviceId, await kinds["catalog.install"].of(deviceId));
    },

    /**
     * Tells each online device whose sources or receives changed (the tick, a pick, a new copy): a
     * device that stops being the source stops sending, and a receiver hears of a new copy. One
     * too old to know it isn't asked again. Then the server's own install looks too.
     */
    async tell() {
      forgetMoved();
      // At once: a device that doesn't answer holds up no other.
      const online = db
        .select({ id: devices.id })
        .from(devices)
        .all()
        .filter((d) => channel.online(d.id));
      await Promise.all(
        online.flatMap(({ id }) =>
          (Object.keys(kinds) as Kind[]).map(async (type) => {
            const { of, told } = kinds[type];
            const payload: Payload = await of(id);
            const text = JSON.stringify(payload);
            if (told.get(id) === text) return;
            await ask(type, id, payload).then(
              () => told.set(id, text),
              (err: HttpError) => err.code === "device_outdated" && told.set(id, text),
            );
          }),
        ),
      );
      await receiveHere();
    },

    /** The hub's copy of `lib`'s `system/`, zipped, for a device that receives it; else 403. */
    async zipCopy(deviceId: string, lib: string) {
      const tmp = mkdtempSync(join(tmpdir(), "catalog-"));
      try {
        const file = join(tmp, "system.zip");
        if (!(await installsOf(deviceId))[lib] || !(await zipHubCopy(lib, file)))
          throw new HttpError(403, "not_receiving", "This device doesn't receive that catalog");
        return await readFile(file);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },

    /** The source device's `system/`, zipped; 403 `not_source` from any other device. */
    async receive(deviceId: string, lib: string, zip: Buffer) {
      const t = target(lib);
      if (t?.deviceId !== deviceId)
        throw new HttpError(403, "not_source", "This device isn't that slicer's catalog source");
      const base = join(dataDir, "slicer-zips");
      const id = crypto.randomUUID();
      await unpackSlicerZip(base, id, lib, zip);
      try {
        const system = join(openUpload(base, id).root, "system");
        if (!existsSync(system))
          throw new HttpError(400, "not_slicer_folder", "The zip has no system folder");
        mkdirSync(t.dir, { recursive: true });
        rmSync(join(t.dir, "system"), { recursive: true, force: true });
        renameSync(system, join(t.dir, "system"));
        writeFileSync(join(t.dir, "system", MARK), deviceId);
        // Its presets to slice with, as a zip's are (`keepPresets`): the worker is available now.
        if (!t.row.slicerConfigDir)
          db.update(schema.integrations)
            .set({ slicerConfigDir: t.dir, updatedAt: new Date().toISOString() })
            .where(eq(schema.integrations.id, t.row.id))
            .run();
      } finally {
        rmSync(join(base, id), { recursive: true, force: true });
      }
      onReceived();
    },
  };
}

export type DeviceCatalog = ReturnType<typeof createDeviceCatalog>;
