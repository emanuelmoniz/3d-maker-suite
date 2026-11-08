import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogSources, IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { deviceLibraries } from "./capabilities.ts";
import { catalogCards, catalogSource } from "./catalogSource.ts";
import { openUpload, unpackSlicerZip } from "./slicerZip.ts";

const { devices, integrations } = schema;
/** In a copy's `system/`: it came from a device. No reader looks at it, and no zip can carry it. */
const MARK = ".from-device";

/**
 * A device as a library's catalog source (ADR-0020): its connector sends `system/` when the
 * fingerprint changed, and the hub keeps it where a zip's goes (`keepPresets`): the worker row's
 * `config`, which `catalogDir` reads on a hub. So the catalog check, the review, user presets'
 * parents and All settings read it as they read any folder. A device is a source only on a hub
 * with a worker row and no slicer of its own (`devicesBlocked` in catalogSource.ts).
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

  /** What each online device was last told, so an unchanged map isn't sent again. */
  const told = new Map<string, string>();
  const ask = (deviceId: string, libraries: CatalogSources) =>
    channel.ask(
      deviceId,
      (requestId) => ({ type: "catalog.sources", requestId, libraries }),
      z.null(),
    );

  return {
    sourcesOf,

    /** A connect's `X-Catalog-Sources`: what the device now knows. */
    async connected(deviceId: string) {
      const libraries = await sourcesOf(deviceId);
      told.set(deviceId, JSON.stringify(libraries));
      return libraries;
    },

    /** Before a pick of `deviceId`: 409 `device_outdated` from a connector that can't send. */
    async confirm(deviceId: string) {
      if (channel.online(deviceId)) await ask(deviceId, await sourcesOf(deviceId));
    },

    /**
     * Tells each online device whose sources changed (the tick, and after a pick): a device that
     * stops being the source stops sending. One too old to know it isn't asked again.
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
        online.map(async ({ id }) => {
          const libraries = await sourcesOf(id);
          const text = JSON.stringify(libraries);
          if (told.get(id) === text) return;
          await ask(id, libraries).then(
            () => told.set(id, text),
            (err: HttpError) => err.code === "device_outdated" && told.set(id, text),
          );
        }),
      );
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
