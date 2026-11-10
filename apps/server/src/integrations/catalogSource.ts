import {
  allows,
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
import {
  activeCapabilities,
  deviceLibraries,
  policyOf,
  presetLibrary,
  slicerCatalogType,
  slicerConfigDir,
} from "./capabilities.ts";

// One catalog source per slicer library for its system presets (ADR-0020): a server folder, a
// managed slicer or a device. Picked in Catalog → Sources, else the default below.

const { devices, integrations, presetRoutes, settings, syncPolicies } = schema;
const KEY = "catalogSources";
type Row = typeof integrations.$inferSelect;
type Install = { row: Row; adapter: IntegrationAdapter };
export type CatalogSource = CatalogSourcePick & { picked: boolean };

const picks = (db: Db) =>
  (db.select().from(settings).where(eq(settings.key, KEY)).get()?.value ?? {}) as Record<
    string,
    CatalogSourcePick
  >;

/** A library's install rows (this computer, the server, a workstation), oldest first. */
const installRows = (db: Db, adapters: IntegrationAdapter[], lib: string): Install[] =>
  db
    .select()
    .from(integrations)
    .orderBy(asc(integrations.createdAt))
    .all()
    .flatMap((row) => {
      const adapter = adapters.find((a) => a.id === row.adapterId);
      return adapter?.library?.id === lib && row.enabled ? [{ row, adapter }] : [];
    });

/** The devices that report the library's slicer, oldest first; none with the hub off. */
const reporting = (db: Db, adapters: IntegrationAdapter[], lib: string) =>
  readPreferences(db).hubEnabled
    ? db
        .select()
        .from(devices)
        .orderBy(asc(devices.createdAt))
        .all()
        .filter((d) => deviceLibraries(adapters, d.slicers).includes(lib))
    : [];

/** ADR-0019's rule: a row with a readable folder and its catalog types on. */
const feeds = (db: Db, { row, adapter }: Install) =>
  !!slicerConfigDir(row, adapter) &&
  activeCapabilities(db, row, adapter).some((t) => slicerCatalogType(adapter, t));

/**
 * Why no device can be the library's catalog source, if none can: the hub has a slicer of its own
 * (a server slicer or a folder on this computer), whose catalog is the one it slices with; or no
 * worker row holds the cards and the device's copy (deviceCatalog.ts).
 */
function devicesBlocked(rows: Install[]): LibrarySources["noDevices"] {
  const own = rows.find((r) => r.adapter.kind !== "worker" && !!slicerConfigDir(r.row, r.adapter));
  if (own) return { reason: "ownSlicer", integrationId: own.row.id };
  return rows.some((r) => r.adapter.kind === "worker") ? null : { reason: "noWorker" };
}

/** The devices that can be the library's source: those that report it, unless none can. */
const sourceDevices = (db: Db, adapters: IntegrationAdapter[], lib: string, rows: Install[]) =>
  devicesBlocked(rows) ? [] : reporting(db, adapters, lib);

/**
 * The library's catalog source: the pick while its row is enabled or its device can be one; else
 * the oldest row with a readable folder; else the first device that can. A server slicer installed
 * while a device is picked so takes over (the install dialog says so).
 */
export function catalogSource(
  db: Db,
  adapters: IntegrationAdapter[],
  lib: string,
): CatalogSource | null {
  const rows = installRows(db, adapters, lib);
  const pick = picks(db)[lib];
  if (
    pick &&
    ("integrationId" in pick
      ? rows.some((r) => r.row.id === pick.integrationId)
      : sourceDevices(db, adapters, lib, rows).some((d) => d.id === pick.deviceId))
  )
    return { ...pick, picked: true };
  const row = rows.find((r) => feeds(db, r));
  if (row) return { integrationId: row.row.id, picked: false };
  const device = sourceDevices(db, adapters, lib, rows)[0];
  return device ? { deviceId: device.id, picked: false } : null;
}

/**
 * The row whose Catalog and System presets cards the source fills: for a device, its own worker
 * row, else another worker's (one always is: `devicesBlocked`).
 */
function cardsOf(rows: Install[], source: CatalogSource | null) {
  if (!source) return rows[0]?.row.id ?? null;
  if ("integrationId" in source) return source.integrationId;
  const worker =
    rows.find(
      (r) => workerConfigSchema.safeParse(r.row.config).data?.deviceId === source.deviceId,
    ) ?? rows.find((r) => r.adapter.kind === "worker");
  return worker?.row.id ?? null;
}

/** The install row whose cards a library's catalog source fills, with its adapter. */
export function catalogCards(db: Db, adapters: IntegrationAdapter[], lib: string) {
  const rows = installRows(db, adapters, lib);
  const id = cardsOf(rows, catalogSource(db, adapters, lib));
  return rows.find((r) => r.row.id === id) ?? null;
}

/**
 * Catalog → Sources, one entry per library: its install rows, the accounts whose user presets go
 * there, and the slicers devices report or have switches for.
 */
export function librarySources(db: Db, adapters: IntegrationAdapter[]): LibrarySources[] {
  const all = db.select().from(integrations).orderBy(asc(integrations.createdAt)).all();
  const libraryOf = (row: Row) => {
    const a = adapters.find((x) => x.id === row.adapterId);
    return a?.library ? presetLibrary(a) : a?.presetsLibrary;
  };
  const hub = readPreferences(db).hubEnabled;
  const libs = new Set([
    ...all.flatMap((r) => libraryOf(r) ?? []),
    ...(hub
      ? db
          .select({ slicers: devices.slicers, presets: devices.presetLibraries })
          .from(devices)
          .all()
          .flatMap((d) => [...deviceLibraries(adapters, d.slicers), ...Object.keys(d.presets)])
      : []),
  ]);
  return [...libs].sort().map((library) => {
    const rows = installRows(db, adapters, library);
    const source = catalogSource(db, adapters, library);
    const counts = new Map<string, number>();
    for (const r of db
      .select({ id: presetRoutes.integrationId })
      .from(presetRoutes)
      .where(like(presetRoutes.source, `${library}:%`))
      .all())
      counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    return {
      library,
      routes: all
        // An account is a route only while it allows user presets (ADR-0021).
        .filter((r) => r.enabled && libraryOf(r) === library && allows(r.config, "userPresets"))
        .map((r) => ({ integrationId: r.id, presets: counts.get(r.id) ?? 0 })),
      source,
      options: [
        // A worker's own folder only holds a zip's copy: its device is the source to pick.
        ...rows
          .map((r) => ({ id: r.row.id, kind: r.adapter.kind, readable: feeds(db, r) }))
          .filter((r) => r.kind !== "worker" || r.readable)
          .map(({ id, readable }) => ({ integrationId: id, readable })),
        ...sourceDevices(db, adapters, library, rows).map((d) => ({
          deviceId: d.id,
          name: d.name,
        })),
      ],
      cardsOf: cardsOf(rows, source),
      noDevices: reporting(db, adapters, library).length ? devicesBlocked(rows) : null,
    };
  });
}

/**
 * Picks a library's catalog source, and turns on its Catalog and System presets cards (off →
 * Manual, ADR-0019's default; Automatic stays). 422 when it can't be one. `confirm` runs before
 * anything is saved: a device told it is the source, whose refusal keeps the old pick.
 */
export async function pickCatalogSource(
  db: Db,
  adapters: IntegrationAdapter[],
  lib: string,
  pick: CatalogSourcePick,
  confirm: () => Promise<unknown> = async () => {},
) {
  const entry = librarySources(db, adapters).find((l) => l.library === lib);
  const ok = entry?.options.some((o) =>
    "integrationId" in pick
      ? "integrationId" in o && o.integrationId === pick.integrationId
      : "deviceId" in o && o.deviceId === pick.deviceId,
  );
  if (!entry || !ok)
    throw new HttpError(422, "not_a_source", "That can't be this catalog's source");
  await confirm();
  db.insert(settings)
    .values({ key: KEY, value: { ...picks(db), [lib]: pick } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { ...picks(db), [lib]: pick } } })
    .run();
  const cards = cardsOf(installRows(db, adapters, lib), { ...pick, picked: true });
  const row = cards && db.select().from(integrations).where(eq(integrations.id, cards)).get();
  const adapter = row && adapters.find((a) => a.id === row.adapterId);
  if (!row || !adapter) return;
  for (const type of [...SLICER_CATALOG_ROW_TYPES, ...SLICER_PRESET_TYPES]) {
    if (!adapter.capabilities.includes(type) || policyOf(db, row.id, type).mode !== "off") continue;
    db.insert(syncPolicies)
      .values({ integrationId: row.id, type, ...defaultPolicy(type), mode: "manual" })
      .onConflictDoUpdate({
        target: [syncPolicies.integrationId, syncPolicies.type],
        set: { mode: "manual" },
      })
      .run();
  }
}
