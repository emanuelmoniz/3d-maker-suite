import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type AlertSeverity,
  type Capability,
  defaultPolicy,
  type FilamentLibrary,
  type IntegrationAdapter,
  isAction,
  SLICER_FILE_TYPES,
  SLICER_ZIP_TYPES,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { readPreferences } from "../lib/preferences.ts";

const { syncPolicies } = schema;
type Row = typeof schema.integrations.$inferSelect;

/** One type's sync policy: the stored row, else its default. */
export function policyOf(db: Db, integrationId: string, type: Capability) {
  const stored = db
    .select()
    .from(syncPolicies)
    .where(and(eq(syncPolicies.integrationId, integrationId), eq(syncPolicies.type, type)))
    .get();
  return (
    stored ?? {
      type,
      ...defaultPolicy(type),
      lastRunAt: null,
      cursor: null,
      pending: 0,
      goneInUse: [] as string[],
      alertSeverities: null,
      trackUsage: true,
      newWeight: "import" as const,
      newOpenedAt: "unset" as const,
      atMinute: null,
      atHour: null,
      atWeekday: null,
      atDay: null,
      editorSync: false,
      editorReview: false,
    }
  );
}

/** Does the policy raise this severity? Empty (null) = all of them. */
export const raisesSeverity = (p: { alertSeverities: AlertSeverity[] | null }, s: AlertSeverity) =>
  !p.alertSeverities || p.alertSeverities.includes(s);

/** First default config folder of the slicer that exists on this PC. */
export const detectedDir = (lib?: FilamentLibrary) =>
  lib?.defaultDirs().find((d) => existsSync(d)) ?? null;

/** The library its presets are named after (`<library>:<preset>`), shared by a slicer's kinds. */
export const presetLibrary = (adapter: IntegrationAdapter) => adapter.library?.id ?? adapter.id;

/** The libraries of the slicers a connector reports (`devices.slicers`: desktop adapters' ids). */
export const deviceLibraries = (adapters: IntegrationAdapter[], slicers: { id: string }[]) => [
  ...new Set(
    slicers.flatMap((s) => {
      const a = adapters.find((x) => x.id === s.id && x.desktop);
      return a ? presetLibrary(a) : [];
    }),
  ),
];

/** A slicer's catalog type: `checkCatalogs` looks after it (ADR-0019). */
export const slicerCatalogType = (
  adapter: IntegrationAdapter | undefined,
  type: Capability,
): type is (typeof SLICER_ZIP_TYPES)[number] =>
  !!adapter?.library && (SLICER_ZIP_TYPES as readonly string[]).includes(type);

/** Fed by a slicer's files, so it has no schedule: a change in them runs it (ADR-0019). */
export const slicerFileType = (adapter: IntegrationAdapter | undefined, type: Capability) =>
  !!adapter?.library && (SLICER_FILE_TYPES as readonly string[]).includes(type);

/** The row's folder override, else the detected one; null when it doesn't exist. */
export function slicerConfigDir(row: Row, adapter: IntegrationAdapter) {
  const dir = row.slicerConfigDir?.trim() || detectedDir(adapter.library);
  return dir && existsSync(dir) ? dir : null;
}

/** A hub's managed slicer reads the hub's library, before it has a folder of its own too (ADR-0019). */
const readsLibrary = (db: Db, adapter: IntegrationAdapter) =>
  !!adapter.managed && readPreferences(db).hubEnabled;

/**
 * Where a row's catalog is read: its folder, else the one `linkLibraries` gives a managed slicer.
 * `slicerConfigDir` stays unset there: it would count as having the system presets to slice with.
 */
export function catalogDir(db: Db, dataDir: string, row: Row, adapter: IntegrationAdapter) {
  return (
    slicerConfigDir(row, adapter) ??
    (readsLibrary(db, adapter) ? join(dataDir, "slicers", row.id, "config") : null)
  );
}

/** The device a worker integration slices on; undefined for other kinds or a removed device. */
export const workerDevice = (db: Db, row: Row) => {
  const deviceId = workerConfigSchema.safeParse(row.config).data?.deviceId;
  return deviceId
    ? db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()
    : undefined;
};

/**
 * Whether a row syncs and works: an account only while it is enabled; a slicer install always, as
 * its Enabled switch only says whether it can be the hub's slicer (`slicerOptions`).
 */
export const working = (row: Pick<Row, "enabled">, adapter?: Pick<IntegrationAdapter, "kind">) =>
  row.enabled || (!!adapter && adapter.kind !== "cloud");

/** Supported by the adapter, working, and what it needs is set up; any install's slice. */
function available(db: Db, row: Row, adapter?: IntegrationAdapter): Capability[] {
  if (!adapter || !working(row, adapter)) return [];
  // A cloud source needs its sign-in and a local one its folder; an action needs the program
  // itself, and slicing the source too (its presets).
  const source =
    adapter.kind === "cloud" ? !adapter.login || !!row.secrets : !!slicerConfigDir(row, adapter);
  const program = row.slicerPath?.trim();
  // A worker's program is on its device (ADR-0014), while that device is a slice worker. Offline,
  // it still counts: its slices wait for it.
  const slicerApp =
    !!program &&
    (adapter.kind === "worker" ? !!workerDevice(db, row)?.sliceWorker : existsSync(program));
  return adapter.capabilities.filter(
    (c) =>
      policyOf(db, row.id, c).mode !== "off" &&
      (isAction(c)
        ? slicerApp && (c === "openInSlicer" || source)
        : source || readsLibrary(db, adapter)),
  );
}

type Install = { row: Row; adapter: IntegrationAdapter };
const HUB_SLICERS = "hubSlicers";

/** The hub's slicer picked per library (`{ [library]: integrationId }`, ADR-0022). */
export const hubSlicerPicks = (db: Db) =>
  (db.select().from(schema.settings).where(eq(schema.settings.key, HUB_SLICERS)).get()?.value ??
    {}) as Record<string, string>;

export const saveHubSlicerPick = (db: Db, lib: string, integrationId: string) => {
  const value = { ...hubSlicerPicks(db), [lib]: integrationId };
  db.insert(schema.settings)
    .values({ key: HUB_SLICERS, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
};

/**
 * What can be a library's hub's slicer (ADR-0022), oldest first: the server's installs (a folder on
 * this computer, a managed slicer) and each machine's install (the hub's download, or one found
 * there).
 */
export function slicerOptions(db: Db, adapters: IntegrationAdapter[], lib: string): Install[] {
  return db
    .select()
    .from(schema.integrations)
    .orderBy(asc(schema.integrations.createdAt))
    .all()
    .flatMap((row) => {
      const adapter = adapters.find((a) => a.id === row.adapterId);
      if (!adapter || adapter.library?.id !== lib || !row.enabled) return [];
      return [{ row, adapter }];
    });
}

/**
 * A library's hub's slicer, the only install that slices and feeds its catalog (ADR-0022): the
 * pick while it is an option; else the default slicer, else the oldest option that can slice, else
 * the oldest option (a folder that only feeds the catalog). Null = none.
 */
export function hubSlicer(db: Db, adapters: IntegrationAdapter[], lib: string): Install | null {
  const options = slicerOptions(db, adapters, lib);
  const pick = hubSlicerPicks(db)[lib];
  const { defaultSlicerId } = readPreferences(db);
  const slices = (o: Install) => available(db, o.row, o.adapter).includes("slice");
  return (
    options.find((o) => o.row.id === pick) ??
    options.find((o) => o.row.id === defaultSlicerId && slices(o)) ??
    options.find(slices) ??
    options[0] ??
    null
  );
}

/** What a row can do now: `available`, with `slice` only on its library's hub's slicer. */
export function activeCapabilities(db: Db, adapters: IntegrationAdapter[], row: Row): Capability[] {
  const adapter = adapters.find((a) => a.id === row.adapterId);
  const caps = available(db, row, adapter);
  const lib = adapter?.library?.id;
  return caps.includes("slice") && lib && hubSlicer(db, adapters, lib)?.row.id !== row.id
    ? caps.filter((c) => c !== "slice")
    : caps;
}

/**
 * A local source whose folder isn't on this server (e.g. the app runs on a NAS), a server one
 * with no slicer installed yet, or a worker with no presets or no slicer on its device yet.
 */
export const unavailable = (row: Row, adapter: IntegrationAdapter) =>
  (adapter.kind !== "cloud" && !!adapter.library && !slicerConfigDir(row, adapter)) ||
  (adapter.kind === "worker" && !row.slicerPath);

/** Every integration that can do `cap` right now, oldest first. */
export function capableRows(db: Db, adapters: IntegrationAdapter[], cap: Capability) {
  return db
    .select()
    .from(schema.integrations)
    .orderBy(asc(schema.integrations.createdAt))
    .all()
    .map((row) => ({ row, adapter: adapters.find((a) => a.id === row.adapterId) }))
    .filter(
      (r): r is Install => !!r.adapter && activeCapabilities(db, adapters, r.row).includes(cap),
    );
}

/** The integration `id` if it can do `cap`, else a 404. */
export function capableRow(db: Db, adapters: IntegrationAdapter[], id: string, cap: Capability) {
  const found = capableRows(db, adapters, cap).find((r) => r.row.id === id);
  if (!found) throw new HttpError(404, "capability_unavailable", `Integration can't do "${cap}"`);
  return found;
}

/** Supported and not switched off, set up or not (sync still reports a missing sign-in). */
export const switchedOn = (db: Db, row: Row, adapter: IntegrationAdapter, cap: Capability) =>
  adapter.capabilities.includes(cap) && policyOf(db, row.id, cap).mode !== "off";
