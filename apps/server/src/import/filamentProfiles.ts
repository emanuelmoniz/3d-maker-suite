import { type ImportTarget, type ImportValues, lower, matchRowsOn } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  filamentBrandIdFor,
  filamentMaterialIdFor,
  findFilamentProfile,
  profileColumns,
} from "../lib/catalog.ts";
import type { WriteRow } from "./review.ts";
import { distinct, num, str } from "./spools.ts";

const { filamentBrands, filamentMaterials, filamentProfiles, printFilamentUsages, spools } = schema;

const names = (db: Db, table: typeof filamentBrands | typeof filamentMaterials) =>
  new Set(
    db
      .select({ name: table.name })
      .from(table)
      .all()
      .map((r) => r.name.toLowerCase()),
  );

/** A spool or a print points at it, so prints keep the preset they were made with. */
const inUse = (db: Db, id: string) =>
  !!db.select({ id: spools.id }).from(spools).where(eq(spools.profileId, id)).get() ||
  !!db
    .select({ id: printFilamentUsages.id })
    .from(printFilamentUsages)
    .where(eq(printFilamentUsages.profileId, id))
    .get();

/** Filament profiles from a slicer's presets. The brand and material are found by name or created. */
export const filamentProfileImport = {
  /** Active profiles, in the shape of the import columns. */
  targets: (db: Db): ImportTarget[] =>
    db
      .select(profileColumns)
      .from(filamentProfiles)
      .where(isNull(filamentProfiles.archivedAt))
      .all()
      .map((p) => ({
        id: p.id,
        label: [p.brand, p.material, p.name].filter(Boolean).join(" "),
        values: {
          brand: p.brand || null,
          material: p.material,
          name: p.name || null,
          diameterMm: p.diameterMm,
          densityGcm3: p.densityGcm3,
          pricePerKg: p.pricePerKg,
          nozzleTempC: p.nozzleTempC,
          bedTempC: p.bedTempC,
        },
      })),

  // A profile made by hand with the same brand, material and name is the preset's twin.
  match: matchRowsOn("brand", "material", "name"),

  bySource: (db: Db) =>
    new Map(
      db
        .select({ source: filamentProfiles.sourcePreset, id: filamentProfiles.id })
        .from(filamentProfiles)
        .where(and(isNotNull(filamentProfiles.sourcePreset), isNull(filamentProfiles.archivedAt)))
        .all()
        .map((r) => [r.source ?? "", r.id] as const),
    ),

  /** Brands and materials the rows name that aren't there yet. */
  missing(db: Db, rows: ImportValues[]) {
    const brands = names(db, filamentBrands);
    const materials = names(db, filamentMaterials);
    const lacking = (key: string, have: Set<string>) =>
      distinct(rows.map((r) => str(r[key]) ?? "")).filter((n) => !have.has(n.toLowerCase()));
    return {
      filamentBrands: lacking("brand", brands),
      filamentMaterials: lacking("material", materials),
    };
  },

  /** A run never adds a brand or a material on its own. */
  held(db: Db) {
    const brands = names(db, filamentBrands);
    const materials = names(db, filamentMaterials);
    return (v: ImportValues) =>
      (!!v.brand && !brands.has(lower(v.brand))) || !materials.has(lower(v.material));
  },

  create(db: Db, v: ImportValues, row: WriteRow) {
    const brandId = filamentBrandIdFor(db, str(v.brand) ?? "");
    const materialId = filamentMaterialIdFor(db, str(v.material) ?? "");
    const name = str(v.name) ?? "";
    // Two presets can be the same filament: the second one adds nothing.
    if (findFilamentProfile(db, brandId, materialId, name)) return false;
    db.insert(filamentProfiles)
      .values({
        brandId,
        materialId,
        name,
        diameterMm: num(v.diameterMm) ?? undefined,
        densityGcm3: num(v.densityGcm3) ?? 1.24,
        pricePerKg: num(v.pricePerKg),
        nozzleTempC: num(v.nozzleTempC),
        bedTempC: num(v.bedTempC),
        sourcePreset: row.source,
      })
      .run();
  },

  /**
   * Writes `patch` (only the values that change). The preset's own profile is updated in place, or,
   * when a spool or print uses it, archived and added again as the new version.
   */
  update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
    const cur = db.select().from(filamentProfiles).where(eq(filamentProfiles.id, target.id)).get();
    if (!cur) return;
    const { brand, material, ...fields } = patch;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    if (brand != null) set.brandId = filamentBrandIdFor(db, String(brand));
    if (material != null) set.materialId = filamentMaterialIdFor(db, String(material));
    if (!(row.source && cur.sourcePreset === row.source && inUse(db, cur.id))) {
      // A twin made by hand is linked to the preset, so the next run knows it.
      db.update(filamentProfiles)
        .set({ ...set, sourcePreset: cur.sourcePreset ?? row.source })
        .where(eq(filamentProfiles.id, cur.id))
        .run();
      return;
    }
    db.update(filamentProfiles)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(filamentProfiles.id, cur.id))
      .run();
    db.insert(filamentProfiles)
      .values({
        brandId: cur.brandId,
        materialId: cur.materialId,
        name: cur.name,
        diameterMm: cur.diameterMm,
        densityGcm3: cur.densityGcm3,
        pricePerKg: cur.pricePerKg,
        nozzleTempC: cur.nozzleTempC,
        bedTempC: cur.bedTempC,
        sourcePreset: cur.sourcePreset,
        ...set,
      })
      .run();
  },
};
