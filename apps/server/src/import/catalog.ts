import { copyFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import {
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  matchRowsOn,
  modelLabel,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { HttpError } from "../errors.ts";
import {
  DEFAULT_NOZZLE,
  idByName,
  modelIdFor,
  modelIdOf,
  nameKey,
  presetName,
  presetNames,
} from "../lib/catalog.ts";
import { printerImport } from "./printers.ts";
import { type ImportHandler, keyLibrary, type WriteRow } from "./review.ts";
import { names, num, str } from "./spools.ts";

const {
  brands,
  filamentBrands,
  filamentMaterials,
  machinePresets,
  printerModels,
  printers,
  processPresets,
  prints,
} = schema;

type RowError = { column: string; code: ImportErrorCode };

const modelOf = (db: Db, v: ImportValues) => modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? "");
const hasModel = (v: ImportValues) => !!str(v.brand) && !!str(v.model);
const processPresetValues = (db: Db, v: ImportValues, row: WriteRow) => ({
  name: str(v.name) ?? "",
  printerModelId: hasModel(v) ? modelOf(db, v) : null,
  nozzleDiameterMm: num(v.nozzleDiameterMm),
  layerHeightMm: num(v.layerHeightMm),
  machinePresets: Array.isArray(row.raw.machinePresets) ? (row.raw.machinePresets as string[]) : [],
});
/** A machine preset's `default_print_profile` key, kept with the row besides its columns (`libraryRows`). */
const defaultProcessPresetOf = (row: WriteRow) =>
  typeof row.raw.defaultProcessPreset === "string" ? row.raw.defaultProcessPreset : null;
/** What makes a machine preset another version for the prints made with it. */
const VERSIONED = ["brand", "model", "name", "nozzleDiameterMm"];

/** A file names a printer model you have, as the API takes only one you have. */
function modelErrors(db: Db, v: ImportValues): RowError[] {
  const brandId = idByName(db, brands, str(v.brand) ?? "");
  if (!brandId) return [{ column: "brand", code: "unresolved" }];
  return modelIdOf(db, brandId, str(v.model) ?? "")
    ? []
    : [{ column: "model", code: "unresolved" }];
}

/** Writes `set` (keys named like the table's columns); a name another row has is a 409, like the API's. */
function save(
  db: Db,
  table: typeof brands | typeof printerModels | typeof filamentBrands | typeof filamentMaterials,
  id: string,
  set: Record<string, unknown>,
) {
  if (!Object.keys(set).length) return;
  try {
    // Loosely typed on purpose: one write for four tables.
    const t = table as typeof brands;
    db.update(t)
      .set(set as never)
      .where(eq(t.id, id))
      .run();
  } catch (e) {
    if (String((e as Error).message).includes("UNIQUE"))
      throw new HttpError(409, "duplicate", "This name already exists");
    throw e;
  }
}

const nameOf = (v: ImportValues) => nameKey(str(v.name));

/** An update of a row you archived restores it. */
const restored = (target: ImportTarget) => (target.archived ? { archivedAt: null } : {});
/** Active rows, or the ones you archived. */
const archivedIs = (column: SQLiteColumn, archived: boolean) =>
  archived ? isNotNull(column) : isNull(column);
const marked = (archived: boolean) => (archived ? { archived: true } : {});

/** These match by name, and names are unique: a source row with an archived row's name is that row. */
const archivedByName = (targets: ImportTarget[], ...keys: string[]) => {
  const keyOf = (v: ImportValues) => keys.map((k) => str(v[k])?.toLowerCase() ?? "").join("|");
  const byKey = new Map(targets.map((t) => [keyOf(t.values), t.id]));
  return { targets, of: (_: string | undefined, v: ImportValues) => byKey.get(keyOf(v)) ?? null };
};

type PresetRow = { source: string | null; target: ImportTarget };

/**
 * A preset whose preset you archived comes back by its source key, the newest of its versions
 * (`gone` is oldest first); one you never imported, by the brand, model and name of one you
 * archived that no active preset has, of the same slicer library or made by hand (`sameLibrary`).
 */
function archivedPresets(active: PresetRow[], gone: PresetRow[]) {
  const keyOf = (source: string | null | undefined, v: ImportValues) =>
    `${keyLibrary(source) ?? ""}|${[v.brand, v.model, v.name].map((c) => str(c)?.toLowerCase() ?? "").join("|")}`;
  const have = new Set(active.map((r) => keyOf(r.source, r.target.values)));
  const bySource = new Map(gone.flatMap((r) => (r.source ? [[r.source, r.target.id]] : [])));
  const byKey = new Map(
    gone
      .map((r) => [keyOf(r.source, r.target.values), r.target.id] as const)
      .filter(([k]) => !have.has(k)),
  );
  return {
    targets: gone.map((r) => r.target),
    of: (source: string | undefined, v: ImportValues) =>
      (source && bySource.get(source)) ||
      byKey.get(keyOf(source, v)) ||
      byKey.get(keyOf(null, v)) ||
      null,
  };
}

/** Machine presets in the shape of the import columns: active by name, archived oldest first. */
const machineRows = (db: Db, archived = false): PresetRow[] =>
  db
    .select({ preset: machinePresets, model: printerModels.model, brand: brands.name })
    .from(machinePresets)
    .innerJoin(printerModels, eq(printerModels.id, machinePresets.printerModelId))
    .innerJoin(brands, eq(brands.id, printerModels.brandId))
    .where(archivedIs(machinePresets.archivedAt, archived))
    .orderBy(
      ...(archived
        ? [machinePresets.createdAt]
        : [brands.name, printerModels.model, machinePresets.name]),
    )
    .all()
    .map(({ preset: p, model, brand }) => ({
      source: p.sourcePreset,
      target: {
        id: p.id,
        label: p.name,
        ...marked(archived),
        values: {
          brand,
          model,
          name: p.name,
          nozzleDiameterMm: p.nozzleDiameterMm,
          defaultProcessPresetName: p.defaultProcessPreset && presetName(p.defaultProcessPreset),
        },
      },
    }));

/** Process presets in the shape of the import columns: active by name, archived oldest first. */
const processPresetRows = (db: Db, archived = false): PresetRow[] =>
  db
    .select({ preset: processPresets, model: printerModels.model, brand: brands.name })
    .from(processPresets)
    .leftJoin(printerModels, eq(printerModels.id, processPresets.printerModelId))
    .leftJoin(brands, eq(brands.id, printerModels.brandId))
    .where(archivedIs(processPresets.archivedAt, archived))
    .orderBy(archived ? processPresets.createdAt : processPresets.name)
    .all()
    .map(({ preset: p, model, brand }) => ({
      source: p.sourcePreset,
      target: {
        id: p.id,
        label: p.name,
        ...marked(archived),
        values: {
          brand,
          model,
          name: p.name,
          nozzleDiameterMm: p.nozzleDiameterMm,
          layerHeightMm: p.layerHeightMm,
          printers: presetNames(p.machinePresets),
        },
      },
    }));

const brandTargets = (db: Db, archived = false): ImportTarget[] =>
  db
    .select()
    .from(brands)
    .where(archivedIs(brands.archivedAt, archived))
    .orderBy(brands.name)
    .all()
    .map((b) => ({ id: b.id, label: b.name, ...marked(archived), values: { name: b.name } }));

const modelTargets = (db: Db, archived = false): ImportTarget[] =>
  db
    .select({ model: printerModels, brand: brands.name })
    .from(printerModels)
    .innerJoin(brands, eq(brands.id, printerModels.brandId))
    .where(archivedIs(printerModels.archivedAt, archived))
    .orderBy(brands.name, printerModels.model)
    .all()
    .map(({ model: m, brand }) => ({
      id: m.id,
      label: modelLabel(brand, m.model),
      ...marked(archived),
      values: { brand, model: m.model, thumbnail: m.imagePath ? "yes" : null },
    }));

const filamentBrandTargets = (db: Db, archived = false): ImportTarget[] =>
  db
    .select()
    .from(filamentBrands)
    .where(archivedIs(filamentBrands.archivedAt, archived))
    .orderBy(filamentBrands.name)
    .all()
    .map((b) => ({
      id: b.id,
      label: b.name,
      ...marked(archived),
      values: { name: b.name, url: b.url },
    }));

const materialTargets = (db: Db, archived = false): ImportTarget[] =>
  db
    .select()
    .from(filamentMaterials)
    .where(archivedIs(filamentMaterials.archivedAt, archived))
    .orderBy(filamentMaterials.name)
    .all()
    .map((m) => ({
      id: m.id,
      label: m.name,
      ...marked(archived),
      values: {
        name: m.name,
        nozzleTempC: m.nozzleTempC,
        bedTempC: m.bedTempC,
        densityGcm3: m.densityGcm3,
        pricePerKg: m.pricePerKg,
      },
    }));

/**
 * What a slicer ships besides filament (printer brands, printer models, machine and print
 * presets, filament brands and materials), and the same types from a file. Rows are matched on
 * their names. A file names parents you have (a model's brand); a slicer's are created. `dataDir`
 * is where model thumbnails are copied to; empty (tests) = none.
 */
export function catalogImport(dataDir: string) {
  /** The thumbnail fills a missing image, never replaces one you chose. */
  const thumbnail = (db: Db, id: string, image?: string | null) => {
    if (!image || !dataDir) return;
    const model = db.select().from(printerModels).where(eq(printerModels.id, id)).get();
    if (!model || model.imagePath) return;
    const path = `models/${id}${extname(image)}`;
    try {
      mkdirSync(join(dataDir, "models"), { recursive: true });
      copyFileSync(image, join(dataDir, path));
      db.update(printerModels).set({ imagePath: path }).where(eq(printerModels.id, id)).run();
    } catch {
      // ponytail: an unreadable thumbnail is skipped silently; the model is still imported.
    }
  };

  return {
    brands: {
      targets: (db) => brandTargets(db),
      archived: (db) => archivedByName(brandTargets(db, true), "name"),
      deletedKey: nameOf,
      match: matchRowsOn("name"),
      refs: (db) => ({ brands: printerImport.refs(db).brands }),
      missing: () => ({}),
      create: (db, v) =>
        db
          .insert(brands)
          .values({ name: str(v.name) ?? "" })
          .onConflictDoNothing()
          .returning({ id: brands.id })
          .get()?.id ?? false,
      update: (db, target, patch) => save(db, brands, target.id, { ...patch, ...restored(target) }),
    },

    printerModels: {
      targets: (db) => modelTargets(db),
      archived: (db) => archivedByName(modelTargets(db, true), "brand", "model"),
      deletedKey: (v) => nameKey(str(v.brand), str(v.model)),
      match: matchRowsOn("brand", "model"),
      refs: printerImport.refs,
      check: (db, v, file) =>
        file && !idByName(db, brands, str(v.brand) ?? "")
          ? [{ column: "brand", code: "unresolved" }]
          : [],
      missing: (db, rows) => ({ brands: printerImport.missing(db, rows).brands }),
      create: (db, v, row) => {
        // A file doesn't see one you archived: it stays as it is, and nothing was added.
        const brandId = idByName(db, brands, str(v.brand) ?? "");
        const had = !!brandId && !!modelIdOf(db, brandId, str(v.model) ?? "");
        thumbnail(db, modelOf(db, v), row.image);
        return had ? false : undefined;
      },
      update: (db, target, patch, row) => {
        const { brand, model } = patch;
        save(db, printerModels, target.id, {
          ...(brand != null && { brandId: idByName(db, brands, String(brand)) }),
          ...(model != null && { model: String(model).trim() }),
          ...restored(target),
        });
        if (patch.thumbnail) thumbnail(db, target.id, row.image);
      },
    },

    machinePresets: {
      targets: (db) => machineRows(db).map((r) => r.target),
      archived: (db) => archivedPresets(machineRows(db), machineRows(db, true)),
      match: matchRowsOn("brand", "model", "name"),
      sameLibrary: true,
      refs: printerImport.refs,
      check: (db, v, file) => (file ? modelErrors(db, v) : []),
      bySource: (db) =>
        new Map(
          db
            .select({ source: machinePresets.sourcePreset, id: machinePresets.id })
            .from(machinePresets)
            .where(and(isNotNull(machinePresets.sourcePreset), isNull(machinePresets.archivedAt)))
            .all()
            .map((r) => [r.source ?? "", r.id] as const),
        ),
      missing: printerImport.missing,
      create: (db, v, row) => {
        const made = db
          .insert(machinePresets)
          .values({
            name: str(v.name) ?? "",
            printerModelId: modelOf(db, v),
            nozzleDiameterMm: num(v.nozzleDiameterMm) ?? DEFAULT_NOZZLE,
            sourcePreset: row.source,
            defaultProcessPreset: defaultProcessPresetOf(row),
          })
          .returning()
          .get();
        // A printer added before its slicer's catalog gets its machine preset now.
        db.update(printers)
          .set({ machinePresetId: made.id })
          .where(
            and(
              isNull(printers.machinePresetId),
              eq(printers.modelId, made.printerModelId),
              eq(printers.nozzleDiameterMm, made.nozzleDiameterMm),
            ),
          )
          .run();
      },
      /**
       * The preset's own preset is updated in place, or archived and re-added when a print uses it
       * and what the print was made with changes; printers move to the new version.
       */
      update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
        const cur = db.select().from(machinePresets).where(eq(machinePresets.id, target.id)).get();
        if (!cur) return;
        const v = { ...target.values, ...patch };
        const values = {
          name: str(v.name) ?? cur.name,
          printerModelId: modelOf(db, v),
          nozzleDiameterMm: num(v.nozzleDiameterMm) ?? cur.nozzleDiameterMm,
          defaultProcessPreset: defaultProcessPresetOf(row),
        };
        // Nothing to change (one you archived coming back) is never a new version.
        const used =
          VERSIONED.some((k) => k in patch) &&
          row.source &&
          cur.sourcePreset === row.source &&
          db.select({ id: prints.id }).from(prints).where(eq(prints.machinePresetId, cur.id)).get();
        if (!used) {
          // A preset made by hand is linked to the preset, so the next run knows it.
          db.update(machinePresets)
            .set({ ...values, sourcePreset: cur.sourcePreset ?? row.source, ...restored(target) })
            .where(eq(machinePresets.id, cur.id))
            .run();
          return;
        }
        // Prints keep the version they were made with.
        db.update(machinePresets)
          .set({ archivedAt: new Date().toISOString() })
          .where(eq(machinePresets.id, cur.id))
          .run();
        const made = db
          .insert(machinePresets)
          .values({ ...values, sourcePreset: cur.sourcePreset })
          .returning({ id: machinePresets.id })
          .get();
        db.update(printers)
          .set({ machinePresetId: made.id })
          .where(eq(printers.machinePresetId, cur.id))
          .run();
      },
    },

    // Brand and model are optional: a process preset can name no printer we know.
    processPresets: {
      targets: (db) => processPresetRows(db).map((r) => r.target),
      archived: (db) => archivedPresets(processPresetRows(db), processPresetRows(db, true)),
      match: matchRowsOn("brand", "model", "name"),
      sameLibrary: true,
      refs: printerImport.refs,
      // A brand or a model in a file: both, and a model you have.
      check: (db, v, file) => (file && (str(v.brand) || str(v.model)) ? modelErrors(db, v) : []),
      bySource: (db) =>
        new Map(
          db
            .select({ source: processPresets.sourcePreset, id: processPresets.id })
            .from(processPresets)
            .where(and(isNotNull(processPresets.sourcePreset), isNull(processPresets.archivedAt)))
            .all()
            .map((r) => [r.source ?? "", r.id] as const),
        ),
      missing: (db, rows) => printerImport.missing(db, rows.filter(hasModel)),
      create: (db, v, row) =>
        db
          .insert(processPresets)
          .values({ ...processPresetValues(db, v, row), sourcePreset: row.source })
          .run(),
      // No print points at a process preset, so it is always updated in place.
      update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
        const cur = db.select().from(processPresets).where(eq(processPresets.id, target.id)).get();
        if (!cur) return;
        db.update(processPresets)
          .set({
            ...processPresetValues(db, { ...target.values, ...patch }, row),
            sourcePreset: cur.sourcePreset ?? row.source,
            ...restored(target),
          })
          .where(eq(processPresets.id, cur.id))
          .run();
      },
    },

    // The keys of `patch` are named like the table's columns.
    filamentBrands: {
      targets: (db) => filamentBrandTargets(db),
      archived: (db) => archivedByName(filamentBrandTargets(db, true), "name"),
      deletedKey: nameOf,
      match: matchRowsOn("name"),
      refs: (db) => ({ filamentBrands: names(db, filamentBrands, true) }),
      missing: () => ({}),
      create: (db, v) =>
        db
          .insert(filamentBrands)
          .values({ name: str(v.name) ?? "", url: str(v.url) })
          .onConflictDoNothing()
          .returning({ id: filamentBrands.id })
          .get()?.id ?? false,
      update: (db, target, patch) =>
        save(db, filamentBrands, target.id, { ...patch, ...restored(target) }),
    },

    filamentMaterials: {
      targets: (db) => materialTargets(db),
      archived: (db) => archivedByName(materialTargets(db, true), "name"),
      deletedKey: nameOf,
      match: matchRowsOn("name"),
      refs: (db) => ({ filamentMaterials: names(db, filamentMaterials, true) }),
      missing: () => ({}),
      create: (db, v) =>
        db
          .insert(filamentMaterials)
          .values({
            name: str(v.name) ?? "",
            nozzleTempC: num(v.nozzleTempC),
            bedTempC: num(v.bedTempC),
            densityGcm3: num(v.densityGcm3),
            pricePerKg: num(v.pricePerKg),
          })
          .onConflictDoNothing()
          .returning({ id: filamentMaterials.id })
          .get()?.id ?? false,
      update: (db, target, patch) =>
        save(db, filamentMaterials, target.id, { ...patch, ...restored(target) }),
    },
  } satisfies Record<string, ImportHandler>;
}
