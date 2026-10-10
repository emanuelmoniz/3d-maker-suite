import { copyFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type {
  CatalogItem,
  FilamentLibrary,
  SLICER_CATALOG_TYPES,
  SlicerCatalog,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNull } from "drizzle-orm";
import { filamentBrandIdFor, filamentMaterialIdFor, modelIdFor } from "../lib/catalog.ts";
import type { Imported } from "./imports.ts";

const { brands, filamentBrands, filamentMaterials, machineProfiles, printerModels, prints } =
  schema;

export type CatalogType = (typeof SLICER_CATALOG_TYPES)[number];
/** A catalog row the slicer offers. `apply` writes it and says whether it added a row. */
export type Entry = CatalogItem & { apply: () => boolean };

const lc = (s: string) => s.trim().toLowerCase();
const modelKey = (brand: string, model: string) => `${lc(brand)}|${lc(model)}`;

/** Names as the slicer spells them, one per lowercase name. */
function names(values: string[]) {
  const out = new Map<string, string>();
  for (const v of values) if (v.trim() && !out.has(lc(v))) out.set(lc(v), v.trim());
  return out;
}

function brandEntries(db: Db, c: SlicerCatalog): Entry[] {
  const have = new Set(
    db
      .select({ n: brands.name })
      .from(brands)
      .all()
      .map((r) => lc(r.n)),
  );
  return [...names([...c.models, ...c.machines].map((m) => m.brand))].map(([key, name]) => ({
    key,
    kind: "brand",
    label: name,
    status: have.has(key) ? "imported" : "new",
    apply: () => !!db.insert(brands).values({ name }).run(),
  }));
}

const existingModels = (db: Db) =>
  new Map(
    db
      .select({
        id: printerModels.id,
        brand: brands.name,
        model: printerModels.model,
        imagePath: printerModels.imagePath,
      })
      .from(printerModels)
      .innerJoin(brands, eq(brands.id, printerModels.brandId))
      .all()
      .map((r) => [modelKey(r.brand, r.model), r] as const),
  );

function modelEntries(db: Db, dataDir: string, c: SlicerCatalog): Entry[] {
  const have = existingModels(db);
  return c.models.map((m) => {
    const row = have.get(modelKey(m.brand, m.model));
    return {
      key: modelKey(m.brand, m.model),
      kind: "model",
      label: `${m.brand} ${m.model}`,
      // The thumbnail fills a missing image, never replaces one you chose.
      status: !row ? "new" : !row.imagePath && m.image && dataDir ? "changed" : "imported",
      apply: () => {
        const id = modelIdFor(db, m.brand, m.model);
        if (m.image && dataDir && !row?.imagePath) {
          const path = `models/${id}${extname(m.image)}`;
          try {
            mkdirSync(join(dataDir, "models"), { recursive: true });
            copyFileSync(m.image, join(dataDir, path));
            db.update(printerModels).set({ imagePath: path }).where(eq(printerModels.id, id)).run();
          } catch {
            // ponytail: an unreadable thumbnail is skipped silently; the model is still imported.
          }
        }
        return !row;
      },
    };
  });
}

function machineEntries(db: Db, libraryId: string, c: SlicerCatalog): Entry[] {
  const models = existingModels(db);
  const current = new Map(
    db
      .select()
      .from(machineProfiles)
      .where(isNull(machineProfiles.archivedAt))
      .all()
      .map((r) => [r.sourcePreset, r] as const),
  );
  return c.machines.map((m) => {
    const sourcePreset = `${libraryId}:${m.presetId}`;
    const cur = current.get(sourcePreset);
    const changed =
      cur &&
      (cur.name !== m.name ||
        cur.printerModelId !== models.get(modelKey(m.brand, m.model))?.id ||
        cur.nozzleDiameterMm !== m.nozzleDiameterMm);
    return {
      key: m.presetId,
      kind: "machine",
      label: m.name,
      status: !cur ? "new" : changed ? "changed" : "imported",
      apply: () => {
        const values = {
          name: m.name,
          printerModelId: modelIdFor(db, m.brand, m.model),
          nozzleDiameterMm: m.nozzleDiameterMm,
        };
        if (!cur) {
          db.insert(machineProfiles)
            .values({ ...values, sourcePreset })
            .run();
          return true;
        }
        const used = db
          .select({ id: prints.id })
          .from(prints)
          .where(eq(prints.machineProfileId, cur.id))
          .get();
        if (!used) {
          db.update(machineProfiles).set(values).where(eq(machineProfiles.id, cur.id)).run();
          return false;
        }
        // Prints keep the version they were made with.
        db.update(machineProfiles)
          .set({ archivedAt: new Date().toISOString() })
          .where(eq(machineProfiles.id, cur.id))
          .run();
        db.insert(machineProfiles)
          .values({ ...values, sourcePreset })
          .run();
        return true;
      },
    };
  });
}

/** Filament vendors -> filament brands, filament types -> materials, from the filament presets. */
async function filamentEntries(db: Db, lib: FilamentLibrary, dir: string): Promise<Entry[]> {
  const presets = await lib.read(dir, { includeSystem: true });
  const have = (table: typeof filamentBrands | typeof filamentMaterials) =>
    new Set(
      db
        .select({ n: table.name })
        .from(table)
        .all()
        .map((r) => lc(r.n)),
    );
  const [haveBrands, haveMaterials] = [have(filamentBrands), have(filamentMaterials)];
  return [
    ...[...names(presets.map((p) => p.brand))].map(
      ([key, name]): Entry => ({
        key: `brand:${key}`,
        kind: "filamentBrand",
        label: name,
        status: haveBrands.has(key) ? "imported" : "new",
        apply: () => !!filamentBrandIdFor(db, name),
      }),
    ),
    ...[...names(presets.map((p) => p.material))].map(
      ([key, name]): Entry => ({
        key: `material:${key}`,
        kind: "material",
        label: name,
        status: haveMaterials.has(key) ? "imported" : "new",
        apply: () => !!filamentMaterialIdFor(db, name),
      }),
    ),
  ];
}

/** What the slicer's folder offers for one catalog type, with each row's status against the DB. */
export async function catalogEntries(
  db: Db,
  lib: FilamentLibrary,
  dir: string,
  type: CatalogType,
  dataDir: string,
): Promise<Entry[]> {
  if (type === "filamentBrands") return filamentEntries(db, lib, dir);
  const c = (await lib.readCatalog?.(dir)) ?? { models: [], machines: [] };
  if (type === "brands") return brandEntries(db, c);
  if (type === "printerModels") return modelEntries(db, dataDir, c);
  return machineEntries(db, lib.id, c);
}

/**
 * Writes the entries that are new or changed: the picked ones, or without a pick all of them (a
 * catalog row needs no decision, so `pending` stays 0).
 */
export function importCatalog(db: Db, entries: Entry[], picked?: Set<string>): Imported {
  const out = { created: 0, skipped: 0, pending: 0 };
  db.transaction(() => {
    for (const e of entries) {
      if (e.status === "imported") out.skipped++;
      else if ((!picked || picked.has(e.key)) && e.apply()) out.created++;
    }
  });
  return out;
}
