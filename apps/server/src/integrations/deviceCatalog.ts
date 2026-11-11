import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogSources, IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { zipFolder } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { deviceLibraries, slicerConfigDir } from "./capabilities.ts";
import { catalogCards, catalogMismatch, catalogSource } from "./catalogSource.ts";
import { openUpload, unpackSlicerZip } from "./slicerZip.ts";

const { devices, integrations } = schema;
/** In a copy's `system/`: it came from a device. No reader looks at it, and no zip can carry it. */
const MARK = ".from-device";

/**
 * A machine whose install is a library's hub's slicer is its catalog source (ADR-0020, ADR-0022):
 * its connector sends `system/` when the fingerprint changed, and the hub keeps it where a zip's
 * goes (`keepPresets`): the worker row's `config`, which `catalogDir` reads on a hub. So the
 * catalog check, the review, user presets' parents and All settings read it as they read any folder.
 */
export function createDeviceCatalog(
  db: Db,
  adapters: IntegrationAdapter[],
  channel: HubChannel,
  dataDir: string,
  /** A copy came in: the catalog check raises what changed. */
  onReceived: () => void = () => {},
) {
  /** The device a library's copy comes from, and where it goes; null = none. */
  function target(lib: string) {
    const source = catalogSource(db, adapters, lib);
    const cards = catalogCards(db, adapters, lib);
    if (!dataDir || !source || !("deviceId" in source) || cards?.adapter.kind !== "worker")
      return null;
    const dir = join(dataDir, "slicers", cards.row.id, "config");
    return { deviceId: source.deviceId, library: cards.adapter.library, dir };
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
      const copy = hubCopy(lib);
      out[lib] = copy
        ? ((await copy.library?.catalogFingerprint?.(copy.dir).catch(() => null)) ?? null)
        : null;
    }
    return out;
  }

  /** The libraries `deviceId` is the source of, with the fingerprint of the hub's copy. */
  async function sourcesOf(deviceId: string): Promise<CatalogSources> {
    const device = db
      .select({ slicers: devices.slicers })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .get();
    const out: CatalogSources = {};
    for (const lib of device ? deviceLibraries(adapters, device.slicers) : []) {
      const t = target(lib);
      if (t?.deviceId === deviceId)
        out[lib] = (await t.library?.catalogFingerprint?.(t.dir).catch(() => null)) ?? null;
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

  /** Each map, and what each online device was last told of it, so an unchanged one isn't sent again. */
  const kinds = {
    "catalog.sources": { of: sourcesOf, told: new Map<string, string>() },
    "catalog.install": { of: installsOf, told: new Map<string, string>() },
  };
  type Kind = keyof typeof kinds;
  const ask = (type: Kind, deviceId: string, libraries: CatalogSources) =>
    channel.ask(deviceId, (requestId) => ({ type, requestId, libraries }), z.null());
  const connected = async (type: Kind, deviceId: string) => {
    const libraries = await kinds[type].of(deviceId);
    kinds[type].told.set(deviceId, JSON.stringify(libraries));
    return libraries;
  };

  return {
    sourcesOf,
    installsOf,

    /** A connect's `X-Catalog-Sources`: what the device now knows. */
    connected: (deviceId: string) => connected("catalog.sources", deviceId),
    /** A connect's `X-Catalog-Install`. */
    connectedInstall: (deviceId: string) => connected("catalog.install", deviceId),

    /** Before a pick of `deviceId`: 409 `device_outdated` from a connector that can't send. */
    async confirm(deviceId: string) {
      if (channel.online(deviceId))
        await ask("catalog.sources", deviceId, await sourcesOf(deviceId));
    },

    /** Before Receive catalog goes on: 409 `device_outdated` from a connector that can't write. */
    async confirmInstall(deviceId: string) {
      if (channel.online(deviceId))
        await ask("catalog.install", deviceId, await installsOf(deviceId));
    },

    /**
     * Tells each online device whose sources or receives changed (the tick, a pick, a new copy): a
     * device that stops being the source stops sending, and a receiver hears of a new copy. One
     * too old to know it isn't asked again.
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
            const libraries = await of(id);
            const text = JSON.stringify(libraries);
            if (told.get(id) === text) return;
            await ask(type, id, libraries).then(
              () => told.set(id, text),
              (err: HttpError) => err.code === "device_outdated" && told.set(id, text),
            );
          }),
        ),
      );
    },

    /** The hub's copy of `lib`'s `system/`, zipped, for a device that receives it; else 403. */
    async zipCopy(deviceId: string, lib: string) {
      const copy = (await installsOf(deviceId))[lib] ? hubCopy(lib) : null;
      if (!copy)
        throw new HttpError(403, "not_receiving", "This device doesn't receive that catalog");
      const tmp = mkdtempSync(join(tmpdir(), "catalog-"));
      try {
        const file = join(tmp, "system.zip");
        // The mark goes too: the connector writes only preset files (catalogInstall.ts).
        await zipFolder(join(copy.dir, "system"), file, "system/");
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
      } finally {
        rmSync(join(base, id), { recursive: true, force: true });
      }
      onReceived();
    },
  };
}

export type DeviceCatalog = ReturnType<typeof createDeviceCatalog>;
