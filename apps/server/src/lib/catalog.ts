import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, getTableColumns, isNull, type SQLWrapper, sql } from "drizzle-orm";

const { brands, printerModels } = schema;

/** "Brand Model" of the printer model `modelId` points at (for sort/filter on other tables). */
export const modelName = (modelId: SQLWrapper) =>
  sql`(SELECT ${brands.name} || ' ' || ${printerModels.model} FROM ${printerModels}
    JOIN ${brands} ON ${brands.id} = ${printerModels.brandId} WHERE ${printerModels.id} = ${modelId})`;

/** Finds (case-insensitive) or creates the brand and model, for imported printers. */
export function modelIdFor(db: Db, brand: string, model: string): string {
  const brandName = brand.trim() || "Unknown";
  const trimmed = model.trim() || "Unknown";
  const brandId =
    db
      .select({ id: brands.id })
      .from(brands)
      .where(sql`${brands.name} = ${brandName} COLLATE NOCASE`)
      .get()?.id ?? db.insert(brands).values({ name: brandName }).returning().get().id;
  return (
    db
      .select({ id: printerModels.id })
      .from(printerModels)
      .where(
        and(
          eq(printerModels.brandId, brandId),
          sql`${printerModels.model} = ${trimmed} COLLATE NOCASE`,
        ),
      )
      .get()?.id ??
    db.insert(printerModels).values({ brandId, model: trimmed }).returning().get().id
  );
}

const { filamentBrands, filamentMaterials, filamentProfiles } = schema;

/** Finds (case-insensitive) or creates a filament brand; empty = no brand. */
export function filamentBrandIdFor(db: Db, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return (
    db
      .select({ id: filamentBrands.id })
      .from(filamentBrands)
      .where(sql`${filamentBrands.name} = ${trimmed} COLLATE NOCASE`)
      .get()?.id ?? db.insert(filamentBrands).values({ name: trimmed }).returning().get().id
  );
}

/** Finds (case-insensitive) or creates a filament material; empty = "Unknown". */
export function filamentMaterialIdFor(db: Db, name: string): string {
  const trimmed = name.trim() || "Unknown";
  return (
    db
      .select({ id: filamentMaterials.id })
      .from(filamentMaterials)
      .where(sql`${filamentMaterials.name} = ${trimmed} COLLATE NOCASE`)
      .get()?.id ?? db.insert(filamentMaterials).values({ name: trimmed }).returning().get().id
  );
}

/** Brand / material names of a profile row (empty brand = none), for labels, sort and filters. */
export const profileBrand = sql<string>`coalesce((SELECT ${filamentBrands.name} FROM ${filamentBrands} WHERE ${filamentBrands.id} = ${filamentProfiles.brandId}), '')`;
export const profileMaterial = sql<string>`(SELECT ${filamentMaterials.name} FROM ${filamentMaterials} WHERE ${filamentMaterials.id} = ${filamentProfiles.materialId})`;

/** `select()` map for profiles: the row plus `brand` / `material` names, as the API returns them. */
export const profileColumns = {
  ...getTableColumns(filamentProfiles),
  brand: profileBrand,
  material: profileMaterial,
};

/** The active profile with that brand, material and name (case-insensitive), if there is one. */
export const findFilamentProfile = (
  db: Db,
  brandId: string | null,
  materialId: string,
  name: string,
) =>
  db
    .select({ id: filamentProfiles.id })
    .from(filamentProfiles)
    .where(
      and(
        brandId ? eq(filamentProfiles.brandId, brandId) : isNull(filamentProfiles.brandId),
        eq(filamentProfiles.materialId, materialId),
        sql`${filamentProfiles.name} = ${name} COLLATE NOCASE`,
        isNull(filamentProfiles.archivedAt),
      ),
    )
    .get();

/**
 * Finds the active profile with that brand, material and name (case-insensitive) or creates it,
 * along with a brand or material you don't have yet. A new profile takes its material's density.
 */
export function filamentProfileIdFor(
  db: Db,
  p: { brand: string; material: string; name: string },
): string {
  const brandId = filamentBrandIdFor(db, p.brand);
  const materialId = filamentMaterialIdFor(db, p.material);
  const name = p.name.trim();
  const found = findFilamentProfile(db, brandId, materialId, name);
  if (found) return found.id;
  const material = db
    .select({ density: filamentMaterials.densityGcm3 })
    .from(filamentMaterials)
    .where(eq(filamentMaterials.id, materialId))
    .get();
  return (
    db
      .insert(filamentProfiles)
      // 1.24 (PLA) is what the profile form starts with too.
      .values({ brandId, materialId, name, densityGcm3: material?.density ?? 1.24 })
      .returning()
      .get().id
  );
}
