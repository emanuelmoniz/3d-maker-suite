import type { IntegrationAdapter, LibraryPreset, LibrarySpool } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { isNotNull, isNull } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { filamentBrandIdFor, filamentMaterialIdFor, profileColumns } from "../lib/catalog.ts";
import { createSpool } from "../lib/spools.ts";
import { capableRow, slicerConfigDir } from "./capabilities.ts";

const { filamentBrands, filamentMaterials, filamentProfiles, spools } = schema;

// Imports with a preview. With a pick (the confirmed preview) the picked rows are created; without
// one (a sync run) only the rows that need no decision are. `pending` = what is left to review.
export type Imported = { created: number; skipped: number; pending: number };

export const profileKey = (p: { brand: string; material: string; name: string }) =>
  [p.brand, p.material, p.name].map((v) => v.trim().toLowerCase()).join("|");

/** An integration's slicer presets, read from its config folder. */
export async function readLibrary(
  db: Db,
  adapters: IntegrationAdapter[],
  integrationId: string,
  includeSystem: boolean,
) {
  const { row, adapter } = capableRow(db, adapters, integrationId, "filamentProfiles");
  const dir = slicerConfigDir(row, adapter);
  const lib = adapter.library;
  if (!dir || !lib) throw new HttpError(404, "library_not_found", "Slicer config folder not found");
  return { lib, dir, presets: await lib.read(dir, { includeSystem }) };
}

/**
 * Insert-only: a preset already imported, or the same filament made by hand, is skipped. Without
 * a pick only user presets whose brand and material are already in the catalog are imported, so a
 * run never adds a brand or material on its own.
 */
export function importPresets(
  db: Db,
  libraryId: string,
  presets: LibraryPreset[],
  picked?: Set<string>,
): Imported {
  const rows = db.select(profileColumns).from(filamentProfiles).all();
  const skip = new Set([...rows.map((r) => r.sourcePreset), ...rows.map(profileKey)]);
  const names = (table: typeof filamentBrands | typeof filamentMaterials) =>
    new Set(
      db
        .select({ name: table.name })
        .from(table)
        .all()
        .map((r) => r.name.toLowerCase()),
    );
  const brands = names(filamentBrands);
  const materials = names(filamentMaterials);
  const inCatalog = (p: { brand: string; material: string }) =>
    (!p.brand.trim() || brands.has(p.brand.trim().toLowerCase())) &&
    materials.has(p.material.trim().toLowerCase());
  const out = { created: 0, skipped: 0, pending: 0 };
  db.transaction((tx) => {
    for (const { presetId, scope, ...p } of presets) {
      const sourcePreset = `${libraryId}:${presetId}`;
      if (skip.has(sourcePreset) || skip.has(profileKey(p))) {
        out.skipped++;
        continue;
      }
      if (picked ? !picked.has(presetId) : scope !== "user" || !inCatalog(p)) {
        // System presets are the vendor's whole catalogue: never "waiting", only offered.
        if (scope === "user") out.pending++;
        continue;
      }
      const { brand, material, ...fields } = p;
      tx.insert(filamentProfiles)
        .values({
          ...fields,
          brandId: filamentBrandIdFor(db, brand),
          materialId: filamentMaterialIdFor(db, material),
          sourcePreset,
        })
        .run();
      skip.add(sourcePreset).add(profileKey(p)); // two presets can be the same filament
      out.created++;
    }
  });
  return out;
}

export const importedSpools = (db: Db) =>
  new Set(
    db
      .select({ s: spools.sourceSpool })
      .from(spools)
      .where(isNotNull(spools.sourceSpool))
      .all()
      .map((r) => r.s),
  );

/**
 * The active profiles a spool could go on: the ones with the same brand, material and name, else
 * the ones named like a slicer preset of it ("PLA Basic" -> "Bambu PLA Basic").
 */
// ponytail: suffix match is a naive heuristic; match on the vendor's filament id if it misfires.
export function spoolProfiles(db: Db) {
  const active = db
    .select(profileColumns)
    .from(filamentProfiles)
    .where(isNull(filamentProfiles.archivedAt))
    .all();
  return ({ profile: s }: LibrarySpool) => {
    const same = active.filter((p) => profileKey(p) === profileKey(s));
    if (same.length) return same;
    return active.filter(
      (p) =>
        profileKey({ ...p, name: "" }) === profileKey({ ...s, name: "" }) &&
        p.name.toLowerCase().endsWith(` ${s.name.trim().toLowerCase()}`),
    );
  };
}

/**
 * Insert-only: re-importing never touches spools you already have, so their ledger stays yours.
 * `picked` maps a spool to the profile the user chose; without it a spool is imported only when
 * exactly one profile fits. Never creates a profile. `spoolId` is stored as `sourceSpool`.
 */
export function importSpools(
  db: Db,
  items: LibrarySpool[],
  picked?: Map<string, string>,
): Imported {
  const imported = importedSpools(db);
  const profilesFor = spoolProfiles(db);
  const out = { created: 0, skipped: 0, pending: 0 };
  db.transaction((tx) => {
    for (const item of items) {
      const { spoolId, profile: _profile, ...s } = item;
      if (imported.has(spoolId)) {
        out.skipped++;
        continue;
      }
      const fits = picked ? [] : profilesFor(item);
      const profileId = picked ? picked.get(spoolId) : fits.length === 1 ? fits[0]?.id : undefined;
      if (!profileId) {
        out.pending++;
        continue;
      }
      createSpool(tx, { ...s, profileId, sourceSpool: spoolId });
      imported.add(spoolId);
      out.created++;
    }
  });
  return out;
}
