import {
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  lower,
  matchRowsOn,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { profileKey } from "../integrations/imports.ts";
import {
  filamentBrandIdFor,
  filamentMaterialIdFor,
  findFilamentProfile,
  profileColumns,
} from "../lib/catalog.ts";
import { keyLibrary, type WriteRow } from "./review.ts";
import { distinct, num, spoolImport, str } from "./spools.ts";

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

const profileRows = (db: Db, archived: boolean) =>
  db
    .select(profileColumns)
    .from(filamentProfiles)
    .where(archived ? isNotNull(filamentProfiles.archivedAt) : isNull(filamentProfiles.archivedAt))
    .orderBy(profileColumns.brand, profileColumns.material, filamentProfiles.name)
    .all();

/** Active profiles, or archived ones, in the shape of the import columns. */
const profileTargets = (db: Db, archived = false): ImportTarget[] =>
  profileRows(db, archived).map((p) => ({
    id: p.id,
    label: [p.brand, p.material, p.name].filter(Boolean).join(" "),
    ...(archived && { archived: true }),
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
  }));

/**
 * Filament profiles from a slicer's presets or a file. A preset's brand and material are found by
 * name or created; a file names ones you have.
 */
export const filamentProfileImport = {
  /** Active profiles, in the shape of the import columns. */
  targets: (db: Db) => profileTargets(db),

  // A profile made by hand with the same brand, material and name is the preset's twin.
  match: matchRowsOn("brand", "material", "name"),
  sameLibrary: true,

  bySource: (db: Db) =>
    new Map(
      db
        .select({ source: filamentProfiles.sourcePreset, id: filamentProfiles.id })
        .from(filamentProfiles)
        .where(and(isNotNull(filamentProfiles.sourcePreset), isNull(filamentProfiles.archivedAt)))
        .all()
        .map((r) => [r.source ?? "", r.id] as const),
    ),

  /**
   * A preset whose profile you archived comes back by its source key; one you never imported, by
   * the brand, material and name of one you archived that no active profile has, of the same
   * slicer library or made by hand (`sameLibrary`).
   */
  archived(db: Db) {
    const gone = profileRows(db, true);
    const keyOf = (p: { sourcePreset: string | null } & Parameters<typeof profileKey>[0]) =>
      `${keyLibrary(p.sourcePreset) ?? ""}|${profileKey(p)}`;
    const active = new Set(profileRows(db, false).map(keyOf));
    const bySource = new Map(gone.flatMap((p) => (p.sourcePreset ? [[p.sourcePreset, p.id]] : [])));
    const byKey = new Map(gone.filter((p) => !active.has(keyOf(p))).map((p) => [keyOf(p), p.id]));
    return {
      targets: profileTargets(db, true),
      of: (source: string | undefined, v: ImportValues) => {
        const key = profileKey({
          brand: str(v.brand) ?? "",
          material: str(v.material) ?? "",
          name: str(v.name) ?? "",
        });
        return (
          (source && bySource.get(source)) ||
          byKey.get(`${keyLibrary(source) ?? ""}|${key}`) ||
          byKey.get(`|${key}`) ||
          null
        );
      },
    };
  },

  refs: spoolImport.refs,

  check(db: Db, v: ImportValues, file: boolean) {
    const errors: { column: string; code: ImportErrorCode }[] = [];
    if (!file) return errors;
    if (v.brand && !names(db, filamentBrands).has(lower(v.brand)))
      errors.push({ column: "brand", code: "unresolved" });
    if (!names(db, filamentMaterials).has(lower(v.material)))
      errors.push({ column: "material", code: "unresolved" });
    return errors;
  },

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
    // Two presets of one slicer can be the same filament: the second one adds nothing. Another
    // slicer's of that name is its own profile (`sameLibrary`).
    if (findFilamentProfile(db, brandId, materialId, name, keyLibrary(row.source))) return false;
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
    if (target.archived) set.archivedAt = null;
    // Nothing to change (one you archived coming back) is never a new version.
    const changes = Object.keys(patch).length > 0;
    if (!(changes && row.source && cur.sourcePreset === row.source && inUse(db, cur.id))) {
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
