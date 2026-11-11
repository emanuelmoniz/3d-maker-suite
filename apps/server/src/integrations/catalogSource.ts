import {
  allows,
  type Capability,
  type CatalogSourcePick,
  defaultPolicy,
  type IntegrationAdapter,
  type LibrarySources,
  SLICER_CATALOG_ROW_TYPES,
  SLICER_PRESET_TYPES,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, eq, like } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { readPreferences } from "../lib/preferences.ts";
import { VERSION } from "../updates/updates.ts";
import {
  activeCapabilities,
  deviceLibraries,
  hubSlicer,
  hubSlicerPicks,
  policyOf,
  presetLibrary,
  saveHubSlicerPick,
  slicerCatalogType,
  slicerConfigDir,
  slicerOptions,
  workerDevice,
} from "./capabilities.ts";

// A library's catalog and system presets come from its hub's slicer (ADR-0022): a server folder, a
// managed slicer, or a machine's worker install, whose `system/` its connector sends.

const { devices, integrations, presetRoutes, syncPolicies } = schema;
type Row = typeof integrations.$inferSelect;
type Install = { row: Row; adapter: IntegrationAdapter };
type Device = typeof devices.$inferSelect;
export type CatalogSource = CatalogSourcePick & { picked: boolean };

/** The machine a worker install is on; undefined for the server's own. */
const deviceIdOf = ({ row, adapter }: Install) =>
  adapter.kind === "worker" ? workerConfigSchema.safeParse(row.config).data?.deviceId : undefined;

/** ADR-0019's rule: a row with a readable folder and its catalog types on. */
const feeds = (db: Db, adapters: IntegrationAdapter[], { row, adapter }: Install) =>
  !!slicerConfigDir(row, adapter) &&
  activeCapabilities(db, adapters, row).some((t) => slicerCatalogType(adapter, t));

/** The library's catalog source: its hub's slicer, as its machine or its server row. */
export function catalogSource(
  db: Db,
  adapters: IntegrationAdapter[],
  lib: string,
): CatalogSource | null {
  const hub = hubSlicer(db, adapters, lib);
  if (!hub) return null;
  const picked = hubSlicerPicks(db)[lib] === hub.row.id;
  const deviceId = deviceIdOf(hub);
  return deviceId ? { deviceId, picked } : { integrationId: hub.row.id, picked };
}

/** The install row whose Catalog and System presets cards the source fills: the hub's slicer. */
export const catalogCards = hubSlicer;

/** A version's major.minor ("02.04.00.70" → "2.4"); null = unknown. */
export const release = (v: string | null | undefined) => {
  const parts = v?.match(/\d+/g);
  return parts && parts.length >= 2 ? `${Number(parts[0])}.${Number(parts[1])}` : null;
};

/** The version of `lib`'s slicer a device reports; null = none, or unknown. */
const deviceVersion = (adapters: IntegrationAdapter[], d: Device, lib: string) =>
  d.slicers.find((s) => {
    const a = adapters.find((x) => x.id === s.id && x.desktop);
    return a && presetLibrary(a) === lib;
  })?.version ?? null;

/**
 * The version of `lib`'s hub's slicer: its row's (a worker's from its check or install), else what
 * its machine reports of a found slicer; null = unknown.
 */
export function sourceVersion(db: Db, adapters: IntegrationAdapter[], lib: string) {
  const hub = hubSlicer(db, adapters, lib);
  if (!hub) return null;
  if (hub.row.slicerVersion) return hub.row.slicerVersion;
  const deviceId = deviceIdOf(hub);
  const from = deviceId && db.select().from(devices).where(eq(devices.id, deviceId)).get();
  return from ? deviceVersion(adapters, from, lib) : null;
}

/**
 * Receive catalog's version rule (ADR-0021): a `system/` copy goes only to a slicer of the same
 * major.minor as the source's. A newer one may not load in an older slicer, and an older one may
 * be recopied by a newer slicer at start. Null = they match, or either version is unknown.
 */
export function catalogMismatch(
  db: Db,
  adapters: IntegrationAdapter[],
  lib: string,
  device: Device,
): { here: string; source: string } | null {
  const here = release(deviceVersion(adapters, device, lib));
  const there = release(sourceVersion(db, adapters, lib));
  return here && there && here !== there ? { here, source: there } : null;
}

/**
 * Catalog → Sources, one entry per library: the accounts whose user presets go there, its hub's
 * slicer and what else could be, and the machines that offer it or receive its catalog.
 */
export function librarySources(
  db: Db,
  adapters: IntegrationAdapter[],
  online: (deviceId: string) => boolean = () => false,
): LibrarySources[] {
  const all = db.select().from(integrations).orderBy(asc(integrations.createdAt)).all();
  const libraryOf = (row: Row) => {
    const a = adapters.find((x) => x.id === row.adapterId);
    return a?.library ? presetLibrary(a) : a?.presetsLibrary;
  };
  const hub = readPreferences(db).hubEnabled;
  const machines = hub ? db.select().from(devices).orderBy(asc(devices.createdAt)).all() : [];
  const libs = new Set([
    ...all.flatMap((r) => libraryOf(r) ?? []),
    ...machines.flatMap((d) => [
      ...deviceLibraries(adapters, d.slicers),
      ...Object.keys(d.presetLibraries),
    ]),
  ]);
  return [...libs].sort().map((library) => {
    const source = catalogSource(db, adapters, library);
    const counts = new Map<string, number>();
    for (const r of db
      .select({ id: presetRoutes.integrationId })
      .from(presetRoutes)
      .where(like(presetRoutes.source, `${library}:%`))
      .all())
      counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    const isSource = (id: string) => !!source && "deviceId" in source && source.deviceId === id;
    return {
      library,
      routes: all
        // An account is a route only while it allows user presets (ADR-0021).
        .filter((r) => r.enabled && libraryOf(r) === library && allows(r.config, "userPresets"))
        .map((r) => ({ integrationId: r.id, presets: counts.get(r.id) ?? 0 })),
      source,
      options: slicerOptions(db, adapters, library).flatMap((o): LibrarySources["options"] => {
        if (o.adapter.kind !== "worker")
          return [{ integrationId: o.row.id, readable: feeds(db, adapters, o) }];
        const d = workerDevice(db, o.row);
        return d ? [{ deviceId: d.id, name: d.name }] : [];
      }),
      machines: machines
        .filter(
          (d) =>
            !!d.presetLibraries[library] ||
            isSource(d.id) ||
            deviceLibraries(adapters, d.slicers).includes(library),
        )
        .map((d) => {
          // The hub's slicer can't receive (ADR-0022): its own folder is the catalog.
          const receive = !isSource(d.id) && !!d.presetLibraries[library]?.system.receive;
          return {
            deviceId: d.id,
            name: d.name,
            userId: d.userId,
            online: online(d.id),
            outdated: !!d.connectorVersion && d.connectorVersion !== VERSION,
            slicer: !!d.presetLibraries[library]?.slicer,
            receive,
            install: (receive && d.catalogInstall?.find((s) => s.library === library)) || null,
            mismatch: receive ? catalogMismatch(db, adapters, library, d) : null,
          };
        }),
      cardsOf: hubSlicer(db, adapters, library)?.row.id ?? null,
    };
  });
}

/**
 * Picks a library's hub's slicer among its options (ADR-0022), and turns on its slicing and its
 * Catalog and System presets cards (off → their default: the cards Automatic, slicing Manual). 422
 * when it isn't an option.
 * `confirm` runs before anything is saved: a machine told it is the source, whose refusal keeps
 * the old pick. A machine's Receive catalog goes off: its own folder is the catalog.
 */
export async function pickHubSlicer(
  db: Db,
  adapters: IntegrationAdapter[],
  lib: string,
  integrationId: string,
  confirm: (deviceId: string) => Promise<unknown> = async () => {},
) {
  const option = slicerOptions(db, adapters, lib).find((o) => o.row.id === integrationId);
  if (!option)
    throw new HttpError(422, "not_an_option", "That install can't be this slicer's hub's slicer");
  const deviceId = deviceIdOf(option);
  if (deviceId) await confirm(deviceId);
  const d = deviceId ? db.select().from(devices).where(eq(devices.id, deviceId)).get() : undefined;
  const now = d?.presetLibraries[lib];
  if (d && now?.system.receive)
    db.update(devices)
      .set({
        presetLibraries: { ...d.presetLibraries, [lib]: { ...now, system: { receive: false } } },
        catalogInstall: d.catalogInstall?.filter((s) => s.library !== lib) ?? null,
      })
      .where(eq(devices.id, d.id))
      .run();
  // The server's own install too: its folder is now the catalog.
  if (option.row.catalogReceive)
    db.update(integrations)
      .set({ catalogReceive: false, catalogInstall: null })
      .where(eq(integrations.id, integrationId))
      .run();
  saveHubSlicerPick(db, lib, integrationId);
  const { row, adapter } = option;
  const types: Capability[] = ["slice", ...SLICER_CATALOG_ROW_TYPES, ...SLICER_PRESET_TYPES];
  for (const type of types) {
    if (!adapter.capabilities.includes(type) || policyOf(db, row.id, type).mode !== "off") continue;
    db.insert(syncPolicies)
      .values({ integrationId: row.id, type, ...defaultPolicy(type) })
      .onConflictDoUpdate({
        target: [syncPolicies.integrationId, syncPolicies.type],
        set: { mode: defaultPolicy(type).mode },
      })
      .run();
  }
}
