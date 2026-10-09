import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, type SQLWrapper, sql } from "drizzle-orm";

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
