import {
  apiErrorSchema,
  archivedFilter,
  brandFilters,
  brandInputSchema,
  brandPatchSchema,
  brandSchema,
  brandSortFields,
  filamentBrandInputSchema,
  filamentBrandPatchSchema,
  filamentBrandSchema,
  filamentBrandSortFields,
  filamentCatalogFilters,
  filamentMaterialInputSchema,
  filamentMaterialPatchSchema,
  filamentMaterialSchema,
  filamentMaterialSortFields,
  type IntegrationAdapter,
  listQuery,
  machinePresetFilters,
  machinePresetSchema,
  machinePresetSortFields,
  pageOf,
  presetPatchSchema,
  printerModelFilters,
  printerModelInputSchema,
  printerModelPatchSchema,
  printerModelSchema,
  printerModelSortFields,
  processPresetFilters,
  processPresetSchema,
  processPresetSortFields,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, getTableColumns, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { archivedAtOf, archivedWhere, assertPresetFree } from "../lib/archive.ts";
import {
  brandModel,
  brandOf,
  brandSlicers,
  hasSlicer,
  importedSource,
  modelBrandId,
  modelBrandName,
  modelName,
  modelSlicers,
  presetSource,
} from "../lib/catalog.ts";
import { deleteItem, type ItemKind, presetUsed } from "../lib/dependents.ts";
import { imageRoutes } from "../lib/images.ts";
import { type ListOptions, listPage } from "../lib/list.ts";

const { brands, printerModels, machinePresets, processPresets, filamentBrands, filamentMaterials } =
  schema;
const params = z.object({ id: z.uuid() });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

/** SQLite constraint errors on a write -> API errors. FK = unknown parent id. */
function constraint(e: unknown) {
  const msg = String((e as Error).message);
  if (msg.includes("UNIQUE")) return new HttpError(409, "duplicate", "This name already exists");
  if (msg.includes("FOREIGN KEY"))
    return new HttpError(400, "invalid_reference", "Unknown parent record");
  return e;
}

interface Entity {
  kind: ItemKind;
  table: SQLiteTable & { id: SQLiteColumn };
  noun: string;
  row: z.ZodType;
  /** None: rows only come from files (presets, ADR-0020). */
  input?: z.ZodType;
  patch: z.ZodType;
  query: z.ZodType;
  list: ListOptions;
  /** A filter no single column answers, built from the query. */
  where?: (q: { slicer?: string[] }) => SQL | undefined;
  /** `catalogSource`, and a preset's `presetUse`. */
  source: SQL;
  use?: SQL;
  /** What the next import finds the row by: fixed once a file brought it (ADR-0020). */
  locked?: string[];
  /** Keeps old versions of a preset, so an old one can't be restored beside the current one. */
  preset?: boolean;
  image?: { name: string; dir: string; column: string };
}

/** List / get / create / patch and archive / delete (409 while referenced), plus an optional image. */
const crud =
  (db: Db, dataDir: string, o: Entity): FastifyPluginAsyncZod =>
  async (app) => {
    // Loosely typed on purpose: one implementation for three tables; zod guards both ends.
    const table = o.table as typeof brands;
    const computed = { source: o.source, ...(o.use && { use: o.use }) };
    const select = { ...getTableColumns(table), ...computed };
    const get = (id: string) => {
      const row = db.select(select).from(table).where(eq(table.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", `${o.noun} not found`);
      return row as Record<string, unknown>;
    };
    const write = <T>(run: () => T) => {
      try {
        return run();
      } catch (e) {
        throw constraint(e);
      }
    };

    app.get("/", { schema: { querystring: o.query, response: { 200: pageOf(o.row) } } }, (req) => {
      const q = req.query as Parameters<typeof listPage>[2] & {
        archived?: string;
        slicer?: string[];
      };
      return listPage(db, table, q, {
        ...o.list,
        select,
        sort: { ...o.list.sort, ...computed },
        filters: { ...o.list.filters, ...computed },
        where: [...(o.list.where ?? []), o.where?.(q), archivedWhere(table.archivedAt, q.archived)],
      });
    });

    app.get("/:id", { schema: { params, response: { 200: o.row, ...errors } } }, async (req) => {
      return get(req.params.id);
    });

    if (o.input)
      app.post(
        "/",
        { schema: { body: o.input, response: { 201: o.row, ...errors } } },
        (req, reply) => {
          const { id } = write(() =>
            db
              .insert(table)
              .values(req.body as never)
              .returning()
              .get(),
          );
          return reply.status(201).send(get(id));
        },
      );

    app.patch(
      "/:id",
      { schema: { params, body: o.patch, response: { 200: o.row, ...errors } } },
      async (req) => {
        const cur = get(req.params.id);
        const { archived, ...fields } = req.body as { archived?: boolean } & Record<
          string,
          unknown
        >;
        if (o.preset && archived === false)
          assertPresetFree(db, o.table as typeof machinePresets, cur as never);
        if (
          cur.source !== "hand" &&
          o.locked?.some((k) => k in fields && String(fields[k]) !== String(cur[k]))
        )
          throw new HttpError(409, "name_locked", "The next import finds this row by its name");
        write(() =>
          db
            .update(table)
            .set({ ...fields, archivedAt: archivedAtOf(archived) } as never)
            .where(eq(table.id, req.params.id))
            .run(),
        );
        return get(req.params.id);
      },
    );

    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        get(req.params.id);
        deleteItem(db, o.kind, req.params.id, { user: req.user, dataDir });
        return reply.status(204).send(null);
      },
    );

    const image = o.image;
    if (image)
      imageRoutes(app, dataDir, {
        name: image.name,
        dir: image.dir,
        response: o.row,
        get: (id) => get(id)[image.column] as string | null,
        set: (id, path) => {
          db.update(table)
            .set({ [image.column]: path })
            .where(eq(table.id, id))
            .run();
          return get(id);
        },
      });
  };

export const brandsRoutes = (db: Db, dataDir: string, adapters: IntegrationAdapter[] = []) =>
  crud(db, dataDir, {
    kind: "brands",
    table: brands,
    noun: "Brand",
    row: brandSchema,
    input: brandInputSchema,
    patch: brandPatchSchema,
    query: listQuery(brandSortFields, { archived: archivedFilter }, brandFilters),
    source: importedSource("brands", brands.id, adapters),
    locked: ["name"],
    where: hasSlicer(brandSlicers),
    list: {
      sort: {
        name: sql`${brands.name} COLLATE NOCASE`,
        slicer: brandSlicers,
        createdAt: brands.createdAt,
      },
      filters: { name: brands.name },
    },
    image: { name: "logo", dir: "brands", column: "logoPath" },
  });

export const printerModelsRoutes = (db: Db, dataDir: string, adapters: IntegrationAdapter[] = []) =>
  crud(db, dataDir, {
    kind: "printerModels",
    table: printerModels,
    noun: "Printer model",
    row: printerModelSchema,
    input: printerModelInputSchema,
    patch: printerModelPatchSchema,
    query: listQuery(printerModelSortFields, { archived: archivedFilter }, printerModelFilters),
    source: importedSource("printerModels", printerModels.id, adapters),
    locked: ["brandId", "model"],
    where: hasSlicer(modelSlicers),
    list: {
      sort: {
        model: sql`${brandModel(brandOf, printerModels.model)} COLLATE NOCASE`,
        brand: sql`${brandOf} COLLATE NOCASE`,
        slicer: modelSlicers,
        createdAt: printerModels.createdAt,
        powerW: printerModels.powerW,
      },
      filters: {
        model: brandModel(brandOf, printerModels.model),
        brandId: printerModels.brandId,
        powerW: printerModels.powerW,
      },
    },
    image: { name: "image", dir: "models", column: "imagePath" },
  });

export const machinePresetsRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    kind: "machinePresets",
    table: machinePresets,
    noun: "Machine preset",
    row: machinePresetSchema,
    patch: presetPatchSchema,
    query: listQuery(machinePresetSortFields, { archived: archivedFilter }, machinePresetFilters),
    source: presetSource(machinePresets.sourcePreset),
    use: presetUsed("machinePresets"),
    preset: true,
    list: {
      sort: {
        name: sql`${machinePresets.name} COLLATE NOCASE`,
        model: modelName(machinePresets.printerModelId),
        brand: modelBrandName(machinePresets.printerModelId),
        createdAt: machinePresets.createdAt,
        nozzleDiameterMm: machinePresets.nozzleDiameterMm,
      },
      filters: {
        name: machinePresets.name,
        printerModelId: machinePresets.printerModelId,
        brandId: modelBrandId(machinePresets.printerModelId),
        nozzleDiameterMm: machinePresets.nozzleDiameterMm,
      },
    },
  });

export const processPresetsRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    kind: "processPresets",
    table: processPresets,
    noun: "Process preset",
    row: processPresetSchema,
    patch: presetPatchSchema,
    query: listQuery(processPresetSortFields, { archived: archivedFilter }, processPresetFilters),
    source: presetSource(processPresets.sourcePreset),
    use: presetUsed("processPresets"),
    preset: true,
    list: {
      sort: {
        name: sql`${processPresets.name} COLLATE NOCASE`,
        model: modelName(processPresets.printerModelId),
        brand: modelBrandName(processPresets.printerModelId),
        createdAt: processPresets.createdAt,
        nozzleDiameterMm: processPresets.nozzleDiameterMm,
        layerHeightMm: processPresets.layerHeightMm,
      },
      filters: {
        name: processPresets.name,
        printerModelId: processPresets.printerModelId,
        brandId: modelBrandId(processPresets.printerModelId),
        nozzleDiameterMm: processPresets.nozzleDiameterMm,
        layerHeightMm: processPresets.layerHeightMm,
      },
    },
  });

export const filamentBrandsRoutes = (
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[] = [],
) =>
  crud(db, dataDir, {
    kind: "filamentBrands",
    table: filamentBrands,
    noun: "Filament brand",
    row: filamentBrandSchema,
    input: filamentBrandInputSchema,
    patch: filamentBrandPatchSchema,
    query: listQuery(filamentBrandSortFields, { archived: archivedFilter }, filamentCatalogFilters),
    source: importedSource("filamentBrands", filamentBrands.id, adapters),
    locked: ["name"],
    list: {
      sort: {
        name: sql`${filamentBrands.name} COLLATE NOCASE`,
        createdAt: filamentBrands.createdAt,
      },
      filters: { name: filamentBrands.name },
    },
    image: { name: "logo", dir: "filament-brands", column: "logoPath" },
  });

export const filamentMaterialsRoutes = (
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[] = [],
) =>
  crud(db, dataDir, {
    kind: "filamentMaterials",
    table: filamentMaterials,
    noun: "Filament material",
    row: filamentMaterialSchema,
    input: filamentMaterialInputSchema,
    patch: filamentMaterialPatchSchema,
    query: listQuery(
      filamentMaterialSortFields,
      { archived: archivedFilter },
      filamentCatalogFilters,
    ),
    source: importedSource("filamentMaterials", filamentMaterials.id, adapters),
    locked: ["name"],
    list: {
      sort: {
        name: sql`${filamentMaterials.name} COLLATE NOCASE`,
        createdAt: filamentMaterials.createdAt,
      },
      filters: { name: filamentMaterials.name },
    },
  });
