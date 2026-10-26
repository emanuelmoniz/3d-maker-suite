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
import { HttpError } from "../errors.ts";
import { idByName, modelIdFor, modelIdOf } from "../lib/catalog.ts";
import { printerImport } from "./printers.ts";
import type { ImportHandler, WriteRow } from "./review.ts";
import { names, num, str } from "./spools.ts";

const {
  brands,
  filamentBrands,
  filamentMaterials,
  machineProfiles,
  printerModels,
  printProfiles,
  prints,
} = schema;

type RowError = { column: string; code: ImportErrorCode };

const modelOf = (db: Db, v: ImportValues) => modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? "");
const hasModel = (v: ImportValues) => !!str(v.brand) && !!str(v.model);
const printProfileValues = (db: Db, v: ImportValues) => ({
  name: str(v.name) ?? "",
  printerModelId: hasModel(v) ? modelOf(db, v) : null,
  nozzleDiameterMm: num(v.nozzleDiameterMm),
  layerHeightMm: num(v.layerHeightMm),
});

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

/**
 * What a slicer ships besides filament (printer brands, printer models, machine and print
 * profiles, filament brands and materials), and the same types from a file. Rows are matched on
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
      targets: (db) =>
        db
          .select()
          .from(brands)
          .orderBy(brands.name)
          .all()
          .map((b) => ({ id: b.id, label: b.name, values: { name: b.name } })),
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
      update: (db, target, patch) => save(db, brands, target.id, patch),
    },

    printerModels: {
      targets: (db) =>
        db
          .select({ model: printerModels, brand: brands.name })
          .from(printerModels)
          .innerJoin(brands, eq(brands.id, printerModels.brandId))
          .orderBy(brands.name, printerModels.model)
          .all()
          .map(({ model: m, brand }) => ({
            id: m.id,
            label: modelLabel(brand, m.model),
            values: { brand, model: m.model, thumbnail: m.imagePath ? "yes" : null },
          })),
      match: matchRowsOn("brand", "model"),
      refs: printerImport.refs,
      check: (db, v, file) =>
        file && !idByName(db, brands, str(v.brand) ?? "")
          ? [{ column: "brand", code: "unresolved" }]
          : [],
      missing: (db, rows) => ({ brands: printerImport.missing(db, rows).brands }),
      create: (db, v, row) => thumbnail(db, modelOf(db, v), row.image),
      update: (db, target, patch, row) => {
        const { brand, model } = patch;
        save(db, printerModels, target.id, {
          ...(brand != null && { brandId: idByName(db, brands, String(brand)) }),
          ...(model != null && { model: String(model).trim() }),
        });
        if (patch.thumbnail) thumbnail(db, target.id, row.image);
      },
    },

    machineProfiles: {
      targets: (db) =>
        db
          .select({ profile: machineProfiles, model: printerModels.model, brand: brands.name })
          .from(machineProfiles)
          .innerJoin(printerModels, eq(printerModels.id, machineProfiles.printerModelId))
          .innerJoin(brands, eq(brands.id, printerModels.brandId))
          .where(isNull(machineProfiles.archivedAt))
          .orderBy(brands.name, printerModels.model, machineProfiles.name)
          .all()
          .map(({ profile: p, model, brand }) => ({
            id: p.id,
            label: p.name,
            values: { brand, model, name: p.name, nozzleDiameterMm: p.nozzleDiameterMm },
          })),
      match: matchRowsOn("brand", "model", "name"),
      sameLibrary: true,
      refs: printerImport.refs,
      check: (db, v, file) => (file ? modelErrors(db, v) : []),
      bySource: (db) =>
        new Map(
          db
            .select({ source: machineProfiles.sourcePreset, id: machineProfiles.id })
            .from(machineProfiles)
            .where(and(isNotNull(machineProfiles.sourcePreset), isNull(machineProfiles.archivedAt)))
            .all()
            .map((r) => [r.source ?? "", r.id] as const),
        ),
      missing: printerImport.missing,
      create: (db, v, row) =>
        db
          .insert(machineProfiles)
          .values({
            name: str(v.name) ?? "",
            printerModelId: modelOf(db, v),
            nozzleDiameterMm: num(v.nozzleDiameterMm) ?? 0.4,
            sourcePreset: row.source,
          })
          .run(),
      /** The preset's own profile is updated in place, or archived and re-added when a print uses it. */
      update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
        const cur = db
          .select()
          .from(machineProfiles)
          .where(eq(machineProfiles.id, target.id))
          .get();
        if (!cur) return;
        const v = { ...target.values, ...patch };
        const values = {
          name: str(v.name) ?? cur.name,
          printerModelId: modelOf(db, v),
          nozzleDiameterMm: num(v.nozzleDiameterMm) ?? cur.nozzleDiameterMm,
        };
        const used =
          row.source &&
          cur.sourcePreset === row.source &&
          db
            .select({ id: prints.id })
            .from(prints)
            .where(eq(prints.machineProfileId, cur.id))
            .get();
        if (!used) {
          // A profile made by hand is linked to the preset, so the next run knows it.
          db.update(machineProfiles)
            .set({ ...values, sourcePreset: cur.sourcePreset ?? row.source })
            .where(eq(machineProfiles.id, cur.id))
            .run();
          return;
        }
        // Prints keep the version they were made with.
        db.update(machineProfiles)
          .set({ archivedAt: new Date().toISOString() })
          .where(eq(machineProfiles.id, cur.id))
          .run();
        db.insert(machineProfiles)
          .values({ ...values, sourcePreset: cur.sourcePreset })
          .run();
      },
    },

    // Brand and model are optional: a process preset can name no printer we know.
    printProfiles: {
      targets: (db) =>
        db
          .select({ profile: printProfiles, model: printerModels.model, brand: brands.name })
          .from(printProfiles)
          .leftJoin(printerModels, eq(printerModels.id, printProfiles.printerModelId))
          .leftJoin(brands, eq(brands.id, printerModels.brandId))
          .where(isNull(printProfiles.archivedAt))
          .orderBy(printProfiles.name)
          .all()
          .map(({ profile: p, model, brand }) => ({
            id: p.id,
            label: p.name,
            values: {
              brand,
              model,
              name: p.name,
              nozzleDiameterMm: p.nozzleDiameterMm,
              layerHeightMm: p.layerHeightMm,
            },
          })),
      match: matchRowsOn("brand", "model", "name"),
      sameLibrary: true,
      refs: printerImport.refs,
      // A brand or a model in a file: both, and a model you have.
      check: (db, v, file) => (file && (str(v.brand) || str(v.model)) ? modelErrors(db, v) : []),
      bySource: (db) =>
        new Map(
          db
            .select({ source: printProfiles.sourcePreset, id: printProfiles.id })
            .from(printProfiles)
            .where(and(isNotNull(printProfiles.sourcePreset), isNull(printProfiles.archivedAt)))
            .all()
            .map((r) => [r.source ?? "", r.id] as const),
        ),
      missing: (db, rows) => printerImport.missing(db, rows.filter(hasModel)),
      create: (db, v, row) =>
        db
          .insert(printProfiles)
          .values({ ...printProfileValues(db, v), sourcePreset: row.source })
          .run(),
      // No print points at a print profile, so it is always updated in place.
      update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
        const cur = db.select().from(printProfiles).where(eq(printProfiles.id, target.id)).get();
        if (!cur) return;
        db.update(printProfiles)
          .set({
            ...printProfileValues(db, { ...target.values, ...patch }),
            sourcePreset: cur.sourcePreset ?? row.source,
          })
          .where(eq(printProfiles.id, cur.id))
          .run();
      },
    },

    // The keys of `patch` are named like the table's columns.
    filamentBrands: {
      targets: (db) =>
        db
          .select()
          .from(filamentBrands)
          .orderBy(filamentBrands.name)
          .all()
          .map((b) => ({ id: b.id, label: b.name, values: { name: b.name, url: b.url } })),
      match: matchRowsOn("name"),
      refs: (db) => ({ filamentBrands: names(db, filamentBrands) }),
      missing: () => ({}),
      create: (db, v) =>
        db
          .insert(filamentBrands)
          .values({ name: str(v.name) ?? "", url: str(v.url) })
          .onConflictDoNothing()
          .returning({ id: filamentBrands.id })
          .get()?.id ?? false,
      update: (db, target, patch) => save(db, filamentBrands, target.id, patch),
    },

    filamentMaterials: {
      targets: (db) =>
        db
          .select()
          .from(filamentMaterials)
          .orderBy(filamentMaterials.name)
          .all()
          .map((m) => ({
            id: m.id,
            label: m.name,
            values: {
              name: m.name,
              nozzleTempC: m.nozzleTempC,
              bedTempC: m.bedTempC,
              densityGcm3: m.densityGcm3,
            },
          })),
      match: matchRowsOn("name"),
      refs: (db) => ({ filamentMaterials: names(db, filamentMaterials) }),
      missing: () => ({}),
      create: (db, v) =>
        db
          .insert(filamentMaterials)
          .values({
            name: str(v.name) ?? "",
            nozzleTempC: num(v.nozzleTempC),
            bedTempC: num(v.bedTempC),
            densityGcm3: num(v.densityGcm3),
          })
          .onConflictDoNothing()
          .returning({ id: filamentMaterials.id })
          .get()?.id ?? false,
      update: (db, target, patch) => save(db, filamentMaterials, target.id, patch),
    },
  } satisfies Record<string, ImportHandler>;
}
