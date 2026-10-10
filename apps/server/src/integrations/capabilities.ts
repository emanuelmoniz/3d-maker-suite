import { existsSync } from "node:fs";
import type { Capability, FilamentLibrary, IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc } from "drizzle-orm";
import { HttpError } from "../errors.ts";

type Row = typeof schema.integrations.$inferSelect;

/** First default config folder of the slicer that exists on this PC. */
export const detectedDir = (lib?: FilamentLibrary) =>
  lib?.defaultDirs().find((d) => existsSync(d)) ?? null;

/** The row's folder override, else the detected one; null when it doesn't exist. */
export function slicerConfigDir(row: Row, adapter: IntegrationAdapter) {
  const dir = row.slicerConfigDir?.trim() || detectedDir(adapter.library);
  return dir && existsSync(dir) ? dir : null;
}

/** Supported by the adapter, not switched off, and what it needs is set up. */
export function activeCapabilities(row: Row, adapter?: IntegrationAdapter): Capability[] {
  if (!row.enabled || !adapter) return [];
  // A cloud source needs its sign-in and a local one its folder; the action needs the program itself.
  const source =
    adapter.kind === "cloud" ? !adapter.login || !!row.secrets : !!slicerConfigDir(row, adapter);
  const program = row.slicerPath?.trim();
  const slicerApp = !!program && existsSync(program);
  return adapter.capabilities.filter(
    (c) => !row.disabledFeatures.includes(c) && (c === "openInSlicer" ? slicerApp : source),
  );
}

/** A local source whose folder isn't on this server (e.g. the app runs on a NAS). */
export const unavailable = (row: Row, adapter: IntegrationAdapter) =>
  adapter.kind === "local" && !!adapter.library && !slicerConfigDir(row, adapter);

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
        !!r.adapter && activeCapabilities(r.row, r.adapter).includes(cap),
    );
}

/** The integration `id` if it can do `cap`, else a 404. */
export function capableRow(db: Db, adapters: IntegrationAdapter[], id: string, cap: Capability) {
  const found = capableRows(db, adapters, cap).find((r) => r.row.id === id);
  if (!found) throw new HttpError(404, "capability_unavailable", `Integration can't do "${cap}"`);
  return found;
}

/** Supported and not switched off, set up or not (sync still reports a missing sign-in). */
export const switchedOn = (row: Row, adapter: IntegrationAdapter, cap: Capability) =>
  adapter.capabilities.includes(cap) && !row.disabledFeatures.includes(cap);
