import { existsSync } from "node:fs";
import {
  CAPABILITY_NEEDS,
  type Capability,
  type FilamentLibrary,
  type IntegrationAdapter,
} from "@3d-maker-suite/core";
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
  const met = {
    account: !adapter.login || !!row.secrets,
    slicerConfig: !!adapter.library && !!slicerConfigDir(row, adapter),
    slicerApp: !!row.slicerPath?.trim(),
  };
  return adapter.capabilities.filter(
    (c) => !row.disabledFeatures.includes(c) && met[CAPABILITY_NEEDS[c]],
  );
}

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
