import { copyFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { type ImportTarget, type ImportValues, matchRowsOn } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { filamentBrandIdFor, filamentMaterialIdFor, modelIdFor } from "../lib/catalog.ts";
import { printerImport } from "./printers.ts";
import type { ImportHandler, WriteRow } from "./review.ts";
import { num, str } from "./spools.ts";

const { brands, filamentBrands, filamentMaterials, machineProfiles, printerModels, prints } =
  schema;

const modelOf = (db: Db, v: ImportValues) => modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? "");

/**
 * What a slicer ships besides filament: printer brands, printer models, machine profiles, and
 * filament brands + materials. Rows are matched on their names. `dataDir` is where model
 * thumbnails are copied to; empty (tests) = none.
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
          .all()
          .map((b) => ({ id: b.id, label: b.name, values: { name: b.name } })),
      match: matchRowsOn("name"),
      missing: () => ({}),
      create: (db, v) =>
        db
          .insert(brands)
          .values({ name: str(v.name) ?? "" })
          .run(),
      update: () => {},
    },

    printerModels: {
      targets: (db) =>
        db
          .select({ model: printerModels, brand: brands.name })
          .from(printerModels)
          .innerJoin(brands, eq(brands.id, printerModels.brandId))
          .all()
          .map(({ model: m, brand }) => ({
            id: m.id,
            label: `${brand} ${m.model}`,
            values: { brand, model: m.model, thumbnail: m.imagePath ? "yes" : null },
          })),
      match: matchRowsOn("brand", "model"),
      missing: (db, rows) => ({ brands: printerImport.missing(db, rows).brands }),
      create: (db, v, row) => thumbnail(db, modelOf(db, v), row.image),
      update: (db, target, patch, row) => {
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
          .all()
          .map(({ profile: p, model, brand }) => ({
            id: p.id,
            label: p.name,
            values: { brand, model, name: p.name, nozzleDiameterMm: p.nozzleDiameterMm },
          })),
      match: matchRowsOn("brand", "model", "name"),
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

    // Filament vendors and filament types in one list, told apart by `kind`.
    filamentBrands: {
      targets: (db) => [
        ...db
          .select()
          .from(filamentBrands)
          .all()
          .map((b) => ({ id: b.id, label: b.name, values: { kind: "brand", name: b.name } })),
        ...db
          .select()
          .from(filamentMaterials)
          .all()
          .map((m) => ({ id: m.id, label: m.name, values: { kind: "material", name: m.name } })),
      ],
      match: matchRowsOn("kind", "name"),
      missing: () => ({}),
      create: (db, v) =>
        v.kind === "brand"
          ? filamentBrandIdFor(db, str(v.name) ?? "")
          : filamentMaterialIdFor(db, str(v.name) ?? ""),
      update: () => {},
    },
  } satisfies Record<string, ImportHandler>;
}
