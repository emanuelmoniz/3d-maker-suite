import { existsSync } from "node:fs";
import {
  type AlertSeverity,
  type Capability,
  defaultPolicy,
  type FilamentLibrary,
  type IntegrationAdapter,
  isAction,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq } from "drizzle-orm";
import { HttpError } from "../errors.ts";

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

/** The row's folder override, else the detected one; null when it doesn't exist. */
export function slicerConfigDir(row: Row, adapter: IntegrationAdapter) {
  const dir = row.slicerConfigDir?.trim() || detectedDir(adapter.library);
  return dir && existsSync(dir) ? dir : null;
}

/** The device a worker integration slices on; undefined for other kinds or a removed device. */
export const workerDevice = (db: Db, row: Row) => {
  const deviceId = workerConfigSchema.safeParse(row.config).data?.deviceId;
  return deviceId
    ? db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()
    : undefined;
};

/** Supported by the adapter, not switched off, and what it needs is set up. */
export function activeCapabilities(db: Db, row: Row, adapter?: IntegrationAdapter): Capability[] {
  if (!row.enabled || !adapter) return [];
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
      (isAction(c) ? slicerApp && (c === "openInSlicer" || source) : source),
  );
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
      (r): r is { row: Row; adapter: IntegrationAdapter } =>
        !!r.adapter && activeCapabilities(db, r.row, r.adapter).includes(cap),
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
