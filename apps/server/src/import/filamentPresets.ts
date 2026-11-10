import {
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  lower,
  matchRowsOn,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { presetKey } from "../integrations/imports.ts";
import {
  filamentBrandIdFor,
  filamentMaterialIdFor,
  findFilamentPreset,
  presetColumns,
} from "../lib/catalog.ts";
import { keyLibrary, type WriteRow } from "./review.ts";
import { distinct, num, spoolImport, str } from "./spools.ts";

const { filamentBrands, filamentMaterials, filamentPresets } = schema;

const names = (db: Db, table: typeof filamentBrands | typeof filamentMaterials) =>
  new Set(
    db
      .select({ name: table.name })
      .from(table)
      .all()
      .map((r) => r.name.toLowerCase()),
  );

const presetRows = (db: Db, archived: boolean) =>
  db
    .select(presetColumns)
    .from(filamentPresets)
    .where(archived ? isNotNull(filamentPresets.archivedAt) : isNull(filamentPresets.archivedAt))
    .orderBy(presetColumns.brand, presetColumns.material, filamentPresets.name)
    .all();

/** Active presets, or archived ones, in the shape of the import columns. */
const presetTargets = (db: Db, archived = false): ImportTarget[] =>
  presetRows(db, archived).map((p) => ({
    id: p.id,
    label: [p.brand, p.material, p.name].filter(Boolean).join(" "),
    ...(archived && { archived: true }),
    values: {
      brand: p.brand || null,
      material: p.material,
      name: p.name || null,
      diameterMm: p.diameterMm,
      densityGcm3: p.densityGcm3,
      nozzleTempC: p.nozzleTempC,
      bedTempC: p.bedTempC,
    },
  }));

/**
 * Filament presets from a slicer's presets or a file. A preset's brand and material are found by
 * name or created; a file names ones you have.
 */
export const filamentPresetImport = {
  /** Active presets, in the shape of the import columns. */
  targets: (db: Db) => presetTargets(db),

  // A preset made by hand with the same brand, material and name is the preset's twin.
  match: matchRowsOn("brand", "material", "name"),
  sameLibrary: true,

  bySource: (db: Db) =>
    new Map(
      db
        .select({ source: filamentPresets.sourcePreset, id: filamentPresets.id })
        .from(filamentPresets)
        .where(and(isNotNull(filamentPresets.sourcePreset), isNull(filamentPresets.archivedAt)))
        .all()
        .map((r) => [r.source ?? "", r.id] as const),
    ),

  /**
   * A preset whose preset you archived comes back by its source key; one you never imported, by
   * the brand, material and name of one you archived that no active preset has, of the same
   * slicer library or made by hand (`sameLibrary`).
   */
  archived(db: Db) {
    // Oldest first: where several share a source, the newest version wins.
    const gone = presetRows(db, true).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const keyOf = (p: { sourcePreset: string | null } & Parameters<typeof presetKey>[0]) =>
      `${keyLibrary(p.sourcePreset) ?? ""}|${presetKey(p)}`;
    const active = new Set(presetRows(db, false).map(keyOf));
    const bySource = new Map(gone.flatMap((p) => (p.sourcePreset ? [[p.sourcePreset, p.id]] : [])));
    const byKey = new Map(gone.filter((p) => !active.has(keyOf(p))).map((p) => [keyOf(p), p.id]));
    return {
      targets: presetTargets(db, true),
      of: (source: string | undefined, v: ImportValues) => {
        const key = presetKey({
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

  /** The names the template's dropdowns offer. */
  refs: (db: Db) => ({
    ...spoolImport.refs(db),
    filamentPresets: distinct(presetRows(db, false).map((p) => p.name)).sort(),
  }),

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

  create(db: Db, v: ImportValues, row: WriteRow) {
    const brandId = filamentBrandIdFor(db, str(v.brand) ?? "");
    const materialId = filamentMaterialIdFor(db, str(v.material) ?? "");
    const name = str(v.name) ?? "";
    // Two presets of one slicer can be the same filament: the second one adds nothing. Another
    // slicer's of that name is its own preset (`sameLibrary`).
    if (findFilamentPreset(db, brandId, materialId, name, keyLibrary(row.source))) return false;
    db.insert(filamentPresets)
      .values({
        brandId,
        materialId,
        name,
        diameterMm: num(v.diameterMm) ?? undefined,
        densityGcm3: num(v.densityGcm3) ?? 1.24,
        nozzleTempC: num(v.nozzleTempC),
        bedTempC: num(v.bedTempC),
        sourcePreset: row.source,
      })
      .run();
  },

  /**
   * Writes `patch` (only the values that change) in place: no spool or print points at a preset
   * (ADR-0020), so it needs no older version kept.
   */
  update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
    const cur = db.select().from(filamentPresets).where(eq(filamentPresets.id, target.id)).get();
    if (!cur) return;
    const { brand, material, ...fields } = patch;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    if (brand != null) set.brandId = filamentBrandIdFor(db, String(brand));
    if (material != null) set.materialId = filamentMaterialIdFor(db, String(material));
    if (target.archived) set.archivedAt = null;
    // A twin made by hand is linked to the preset, so the next run knows it.
    db.update(filamentPresets)
      .set({ ...set, sourcePreset: cur.sourcePreset ?? row.source })
      .where(eq(filamentPresets.id, cur.id))
      .run();
  },
};
