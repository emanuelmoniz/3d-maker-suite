import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, getTableColumns, isNull, or, type SQL, type SQLWrapper, sql } from "drizzle-orm";

const { brands, deletedSources, printerModels } = schema;

/** `modelLabel` in SQL: "Brand Model", or the model alone when it already starts with the brand. */
export const brandModel = (brand: SQLWrapper, model: SQLWrapper) =>
  sql`CASE WHEN lower(${model}) = lower(${brand}) OR lower(substr(${model}, 1, length(${brand}) + 1)) = lower(${brand}) || ' '
    THEN ${model} ELSE ${brand} || ' ' || ${model} END`;

/** The brand name of a printer model row. */
export const brandOf = sql`(SELECT ${brands.name} FROM ${brands} WHERE ${brands.id} = ${printerModels.brandId})`;

/** A printer model's display name, "Brand Model". */
export const printerModelLabel = sql<string>`${brandModel(brandOf, printerModels.model)}`;

/** The slicer library of a preset (`<library>:<preset>`), null for a hand-made one. */
export const libraryOf = (preset: SQLWrapper) =>
  sql`substr(${preset}, 1, instr(${preset} || ':', ':') - 1)`;

/** A profile's `catalogSource`: "hand", else `<library>:system` / `<library>:user`. */
export const presetSource = (preset: SQLWrapper) =>
  sql<string>`CASE WHEN ${preset} IS NULL THEN 'hand' WHEN instr(${preset}, '/') > 0
    THEN substr(${preset}, 1, instr(${preset}, '/') - 1) ELSE ${preset} END`;

/**
 * The `catalogSource` of one of the four catalog types (ADR-0020): "hand", else what imported it,
 * a slicer by its library (any install of Bambu Studio is `bambu-studio`) or an account's adapter.
 */
export const importedSource = (
  entity: string,
  id: SQLWrapper,
  adapters: readonly { id: string; library?: { id: string } }[],
) => {
  const { importSnapshots: s, integrations: i } = schema;
  const libraries = adapters.filter((a) => a.library && a.library.id !== a.id);
  const product = libraries.length
    ? sql`CASE ${i.adapterId} ${sql.join(
        libraries.map((a) => sql`WHEN ${a.id} THEN ${a.library?.id}`),
        sql` `,
      )} ELSE ${i.adapterId} END`
    : sql`${i.adapterId}`;
  // ponytail: the first importer only; list them all once a row can come from two products.
  // `eq` names each column's table, so `id` is the outer row's, not the integration's.
  return sql<string>`coalesce((SELECT ${product} FROM ${s} JOIN ${i} ON ${eq(i.id, s.integrationId)}
    WHERE ${and(eq(s.entity, entity), eq(s.rowId, id))} ORDER BY ${i.createdAt} LIMIT 1), 'hand')`;
};

/** The brand id of the printer model `modelId` points at (for filters on other tables). */
export const modelBrandId = (modelId: SQLWrapper) =>
  sql`(SELECT ${printerModels.brandId} FROM ${printerModels} WHERE ${printerModels.id} = ${modelId})`;

/** The brand name of the printer model `modelId` points at (for sorts on other tables). */
export const modelBrandName = (modelId: SQLWrapper) =>
  sql`(SELECT ${brands.name} FROM ${printerModels} JOIN ${brands} ON ${brands.id} = ${printerModels.brandId}
    WHERE ${printerModels.id} = ${modelId}) COLLATE NOCASE`;

/**
 * "bambu-studio, orca-slicer": the slicer libraries of the active profiles of the models that
 * `inModels` accepts (given a profile's model id), for the sort and filter of brands and models.
 */
const slicersOf = (inModels: (modelId: SQLWrapper) => SQL) => {
  const { machineProfiles: mp, printProfiles: pp } = schema;
  return sql`(SELECT group_concat(lib, ', ') FROM (
    SELECT ${libraryOf(mp.sourcePreset)} AS lib FROM ${mp}
      WHERE ${mp.archivedAt} IS NULL AND ${inModels(mp.printerModelId)}
    UNION
    SELECT ${libraryOf(pp.sourcePreset)} FROM ${pp}
      WHERE ${pp.archivedAt} IS NULL AND ${inModels(pp.printerModelId)}
    ORDER BY 1) WHERE lib IS NOT NULL)`;
};
export const modelSlicers = slicersOf((id) => sql`${id} = ${printerModels.id}`);
export const brandSlicers = slicersOf(
  (id) =>
    sql`${id} IN (SELECT ${printerModels.id} FROM ${printerModels} WHERE ${printerModels.brandId} = ${brands.id})`,
);

/** A `where` for `?slicer=a,b`: the row's slicers (`modelSlicers`, `brandSlicers`) include any. */
export const hasSlicer =
  (slicers: SQL) =>
  ({ slicer }: { slicer?: string[] }) =>
    slicer && or(...slicer.map((s) => sql`instr(', ' || ${slicers} || ', ', ${`, ${s}, `}) > 0`));

/** What `deleted_sources` knows a row that matches by name by (ADR-0018). */
export const nameKey = (...names: (string | null | undefined)[]) =>
  names.map((n) => n?.trim().toLowerCase() ?? "").join("|");

/** The row is wanted again: a sync treats it as any other. */
export const clearDeleted = (db: Db, entity: string, source: string) =>
  db
    .delete(deletedSources)
    .where(and(eq(deletedSources.entity, entity), eq(deletedSources.source, source)))
    .run();

/** "Brand Model" of the printer model `modelId` points at (for sort/filter on other tables). */
export const modelName = (modelId: SQLWrapper) =>
  sql`(SELECT ${brandModel(brands.name, printerModels.model)} FROM ${printerModels}
    JOIN ${brands} ON ${brands.id} = ${printerModels.brandId} WHERE ${printerModels.id} = ${modelId})`;

/** A row a child needs is created even if you deleted it; the child is what you asked to keep. */
function neededAgain<T>(db: Db, entity: string, source: string, insert: () => T) {
  clearDeleted(db, entity, source);
  return insert();
}

/** Finds (case-insensitive) or creates the brand and model, for imported printers. */
export function modelIdFor(db: Db, brand: string, model: string): string {
  const brandName = brand.trim() || "Unknown";
  const trimmed = model.trim() || "Unknown";
  const brandId =
    db
      .select({ id: brands.id })
      .from(brands)
      .where(sql`${brands.name} = ${brandName} COLLATE NOCASE`)
      .get()?.id ??
    neededAgain(
      db,
      "brands",
      nameKey(brandName),
      () => db.insert(brands).values({ name: brandName }).returning().get().id,
    );
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
    neededAgain(
      db,
      "printerModels",
      nameKey(brandName, trimmed),
      () => db.insert(printerModels).values({ brandId, model: trimmed }).returning().get().id,
    )
  );
}

const { machineProfiles } = schema;

/** A preset's name from its key, `<library>:<scope>/<name>` or `<scope>/<name>`. */
export const presetName = (key: string) => key.slice(key.indexOf("/") + 1);
/** Presets as the review shows them: their names, or null for none. */
export const presetNames = (keys: string[]) => keys.map(presetName).join(", ") || null;

/** `printers.nozzle_diameter_mm`'s default. */
export const DEFAULT_NOZZLE = 0.4;

/**
 * A printer's machine profile by its model and nozzle, as migration 0107 fills it: a system preset
 * first (only those slice, ADR-0007), then by name. ponytail: two slicers' system presets for one
 * printer tie on name; the printer form picks one by hand if the order ever matters.
 */
export const machineProfileFor = (db: Db, modelId: string | null, nozzleDiameterMm: number) =>
  modelId
    ? (db
        .select({ id: machineProfiles.id })
        .from(machineProfiles)
        .where(
          and(
            eq(machineProfiles.printerModelId, modelId),
            eq(machineProfiles.nozzleDiameterMm, nozzleDiameterMm),
            isNull(machineProfiles.archivedAt),
          ),
        )
        .orderBy(
          sql`${machineProfiles.sourcePreset} LIKE '%:system/%' DESC`,
          machineProfiles.name,
          machineProfiles.createdAt,
        )
        .get()?.id ?? null)
    : null;

const { filamentBrands, filamentMaterials, filamentProfiles } = schema;

/** The id of the row with that name (case-insensitive), if there is one. Never creates it. */
export const idByName = (
  db: Db,
  table: typeof brands | typeof filamentBrands | typeof filamentMaterials,
  name: string,
) =>
  db
    .select({ id: table.id })
    .from(table)
    .where(sql`${table.name} = ${name.trim()} COLLATE NOCASE`)
    .get()?.id;

/** The id of the brand's model with that name (case-insensitive), if there is one. */
export const modelIdOf = (db: Db, brandId: string, model: string) =>
  db
    .select({ id: printerModels.id })
    .from(printerModels)
    .where(
      and(
        eq(printerModels.brandId, brandId),
        sql`${printerModels.model} = ${model.trim()} COLLATE NOCASE`,
      ),
    )
    .get()?.id;

/** Finds (case-insensitive) or creates a filament brand; empty = no brand. */
export function filamentBrandIdFor(db: Db, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return (
    db
      .select({ id: filamentBrands.id })
      .from(filamentBrands)
      .where(sql`${filamentBrands.name} = ${trimmed} COLLATE NOCASE`)
      .get()?.id ??
    neededAgain(
      db,
      "filamentBrands",
      nameKey(trimmed),
      () => db.insert(filamentBrands).values({ name: trimmed }).returning().get().id,
    )
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
      .get()?.id ??
    neededAgain(
      db,
      "filamentMaterials",
      nameKey(trimmed),
      () => db.insert(filamentMaterials).values({ name: trimmed }).returning().get().id,
    )
  );
}

/** Brand / material names of a profile row (empty brand = none), for labels, sort and filters. */
export const profileBrand = sql<string>`coalesce((SELECT ${filamentBrands.name} FROM ${filamentBrands} WHERE ${filamentBrands.id} = ${filamentProfiles.brandId}), '')`;
export const profileMaterial = sql<string>`(SELECT ${filamentMaterials.name} FROM ${filamentMaterials} WHERE ${filamentMaterials.id} = ${filamentProfiles.materialId})`;

/** The label the app shows for a profile: its name, else "brand material". */
export const profileLabel = sql<string>`coalesce(nullif(${filamentProfiles.name}, ''), trim(${profileBrand} || ' ' || ${profileMaterial}))`;

const { accessories, orders, quotes, spools, printers, projects, prints } = schema;

/** Brand / material names of a spool row (empty brand = none), for labels, sort and filters. */
export const spoolBrand = sql<string>`coalesce((SELECT ${filamentBrands.name} FROM ${filamentBrands} WHERE ${filamentBrands.id} = ${spools.brandId}), '')`;
export const spoolMaterial = sql<string>`(SELECT ${filamentMaterials.name} FROM ${filamentMaterials} WHERE ${filamentMaterials.id} = ${spools.materialId})`;

/**
 * "Bambu Lab PLA Basic": the brand, then the name, with the material in front unless the name
 * starts with it (no name = the material). The web's `filamentName()` builds the same.
 */
export const filamentName = (brand: SQLWrapper, material: SQLWrapper, name: SQLWrapper) =>
  sql<string>`trim(${brandModel(brand, brandModel(material, sql`coalesce(nullif(${name}, ''), ${material})`))})`;

/**
 * A spool's display name, "012-Bambu Lab PLA Matte Scarlet Red" (the hex without a colour name),
 * as the web's `spoolName()` builds it in English. Fixed here: import files match spools by it.
 */
export const spoolName = sql<string>`printf('%03d', ${spools.number}) || '-' || ${filamentName(spoolBrand, spoolMaterial, spools.name)} || ' ' || coalesce(nullif(${spools.colorName}, ''), ${spools.colorHex})`;

/** `select()` map for spools: the row plus `brand` / `material` names, as the API returns them. */
export const spoolColumns = {
  ...getTableColumns(spools),
  brand: spoolBrand,
  material: spoolMaterial,
};

/** A printer's display name, "02-Bambu A1". Fixed here: import files match printers by it. */
export const printerLabel = sql<string>`printf('%02d', ${printers.number}) || '-' || ${printers.name}`;

/** A print's display name, "0042-Benchy". */
export const printLabel = sql<string>`printf('%04d', ${prints.number}) || '-' || ${prints.title}`;

/** A project's display name, "001-aquaterrario" (the number padded like the folders). */
export const projectLabel = sql<string>`printf('%03d', ${projects.number}) || '-' || ${projects.name}`;

/** "01-AMS", the same as the web's `accessoryName`. */
export const accessoryLabel = sql<string>`printf('%02d', ${accessories.number}) || '-' || ${accessories.name}`;

/** "001-Vase", the same as the web's `quoteName`. */
export const quoteLabel = sql<string>`printf('%03d', ${quotes.number}) || '-' || ${quotes.name}`;

/** An order's number, as its filter reads it. */
export const orderLabel = sql<string>`printf('%03d', ${orders.number})`;

/** `select()` map for profiles: the row plus `brand` / `material` names, as the API returns them. */
export const profileColumns = {
  ...getTableColumns(filamentProfiles),
  brand: profileBrand,
  material: profileMaterial,
};

/**
 * The active profile with that brand, material and name (case-insensitive), if there is one;
 * with `library` (`bambu-studio:`), only one of that slicer library or made by hand.
 */
export const findFilamentProfile = (
  db: Db,
  brandId: string | null,
  materialId: string,
  name: string,
  library?: string | null,
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
        library
          ? sql`(${filamentProfiles.sourcePreset} is null or substr(${filamentProfiles.sourcePreset}, 1, ${library.length}) = ${library})`
          : undefined,
      ),
    )
    .get();
