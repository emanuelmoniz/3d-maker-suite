import type {
  Capability,
  IntegrationAdapter,
  LibraryPreset,
  LibrarySpool,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNotNull, isNull } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { filamentBrandIdFor, filamentMaterialIdFor, profileColumns } from "../lib/catalog.ts";
import { createSpool } from "../lib/spools.ts";
import { capableRow, slicerConfigDir } from "./capabilities.ts";

const { filamentBrands, filamentMaterials, filamentProfiles, printFilamentUsages, spools } = schema;

// Imports with a preview. With a pick (the confirmed preview) the picked rows are created; without
// one (a sync run) only the rows that need no decision are. `pending` = what is left to review.
export type Imported = { created: number; skipped: number; pending: number };

export const profileKey = (p: { brand: string; material: string; name: string }) =>
  [p.brand, p.material, p.name].map((v) => v.trim().toLowerCase()).join("|");

/** An integration's slicer library and its config folder, if it can do `cap` right now. */
export function libraryOf(
  db: Db,
  adapters: IntegrationAdapter[],
  integrationId: string,
  cap: Capability,
) {
  const { row, adapter } = capableRow(db, adapters, integrationId, cap);
  const dir = slicerConfigDir(row, adapter);
  const lib = adapter.library;
  if (!dir || !lib) throw new HttpError(404, "library_not_found", "Slicer config folder not found");
  return { lib, dir };
}

/** An integration's slicer presets, read from its config folder. */
export async function readLibrary(
  db: Db,
  adapters: IntegrationAdapter[],
  integrationId: string,
  includeSystem: boolean,
) {
  const { lib, dir } = libraryOf(db, adapters, integrationId, "filamentProfiles");
  return { lib, dir, presets: await lib.read(dir, { includeSystem }) };
}

type ProfileRow = Awaited<ReturnType<typeof profileRows>>[number];
const profileRows = (db: Db) => db.select(profileColumns).from(filamentProfiles).all();

/** What the catalog already holds, to tell a preset's status. */
export function profileIndex(db: Db) {
  const rows = profileRows(db);
  return {
    /** Current (not archived) imported rows by `<library>:<preset id>`. */
    current: new Map(
      rows.flatMap((r) => (r.sourcePreset && !r.archivedAt ? [[r.sourcePreset, r] as const] : [])),
    ),
    /** Every preset ever imported, so one you archived by hand doesn't come back. */
    seen: new Set(rows.map((r) => r.sourcePreset)),
    keys: new Set(rows.map(profileKey)),
  };
}

// A value the preset doesn't give (null) never counts as a change: it keeps what you entered.
const differs = (cur: ProfileRow, p: Omit<LibraryPreset, "presetId" | "scope">) =>
  profileKey(cur) !== profileKey(p) ||
  cur.diameterMm !== p.diameterMm ||
  cur.densityGcm3 !== p.densityGcm3 ||
  (p.pricePerKg !== null && cur.pricePerKg !== p.pricePerKg) ||
  (p.nozzleTempC !== null && cur.nozzleTempC !== p.nozzleTempC) ||
  (p.bedTempC !== null && cur.bedTempC !== p.bedTempC);

export function presetStatus(
  idx: ReturnType<typeof profileIndex>,
  libraryId: string,
  p: LibraryPreset,
): "new" | "imported" | "changed" | "duplicate" {
  const sourcePreset = `${libraryId}:${p.presetId}`;
  const cur = idx.current.get(sourcePreset);
  if (cur) return differs(cur, p) ? "changed" : "imported";
  if (idx.seen.has(sourcePreset)) return "imported";
  return idx.keys.has(profileKey(p)) ? "duplicate" : "new";
}

/** A spool or a print points at it, so prints keep the preset they were made with. */
const profileInUse = (db: Db, id: string) =>
  !!db.select({ id: spools.id }).from(spools).where(eq(spools.profileId, id)).get() ||
  !!db
    .select({ id: printFilamentUsages.id })
    .from(printFilamentUsages)
    .where(eq(printFilamentUsages.profileId, id))
    .get();

/**
 * A new preset is created; a hand-made twin is skipped. A changed one updates its row in place, or,
 * when a spool or print uses the row, archives it and adds the new version (prints keep the preset
 * they were made with). Presets gone from the source are never deleted. Without a pick only user
 * presets whose brand and material are already in the catalog are touched, so a run never adds a
 * brand or material on its own.
 */
export function importPresets(
  db: Db,
  libraryId: string,
  presets: LibraryPreset[],
  picked?: Set<string>,
): Imported {
  const idx = profileIndex(db);
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
  // ponytail: an in-place update isn't counted in the sync log; add an `updated` column if asked.
  db.transaction((tx) => {
    for (const preset of presets) {
      const { presetId, scope, ...p } = preset;
      const sourcePreset = `${libraryId}:${presetId}`;
      const status = presetStatus(idx, libraryId, preset);
      if (status === "imported" || status === "duplicate") {
        out.skipped++;
        continue;
      }
      if (picked ? !picked.has(presetId) : scope !== "user" || !inCatalog(p)) {
        // System presets are the vendor's whole catalogue: never "waiting", only offered.
        if (scope === "user") out.pending++;
        continue;
      }
      const { brand, material, ...fields } = p;
      const cur = idx.current.get(sourcePreset);
      // A value the preset doesn't give keeps what the existing row had.
      const values = {
        ...fields,
        pricePerKg: fields.pricePerKg ?? cur?.pricePerKg ?? null,
        nozzleTempC: fields.nozzleTempC ?? cur?.nozzleTempC ?? null,
        bedTempC: fields.bedTempC ?? cur?.bedTempC ?? null,
        brandId: filamentBrandIdFor(db, brand),
        materialId: filamentMaterialIdFor(db, material),
      };
      if (cur && !profileInUse(db, cur.id)) {
        tx.update(filamentProfiles).set(values).where(eq(filamentProfiles.id, cur.id)).run();
        continue;
      }
      if (cur)
        tx.update(filamentProfiles)
          .set({ archivedAt: new Date().toISOString() })
          .where(eq(filamentProfiles.id, cur.id))
          .run();
      tx.insert(filamentProfiles)
        .values({ ...values, sourcePreset })
        .run();
      idx.seen.add(sourcePreset);
      idx.keys.add(profileKey(p)); // two presets can be the same filament
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
