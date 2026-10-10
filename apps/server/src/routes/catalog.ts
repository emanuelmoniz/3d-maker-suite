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
  listQuery,
  machineProfileFilters,
  machineProfileInputSchema,
  machineProfilePatchSchema,
  machineProfileSchema,
  machineProfileSortFields,
  pageOf,
  printerModelFilters,
  printerModelInputSchema,
  printerModelPatchSchema,
  printerModelSchema,
  printerModelSortFields,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { imageRoutes } from "../lib/images.ts";
import { type ListOptions, listPage } from "../lib/list.ts";

const { brands, printerModels, machineProfiles, filamentBrands, filamentMaterials } = schema;
const params = z.object({ id: z.uuid() });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

/** SQLite constraint errors -> API errors. FK on write = unknown parent id, FK on delete = in use. */
function constraint(e: unknown, op: "write" | "delete") {
  const msg = String((e as Error).message);
  if (msg.includes("UNIQUE")) return new HttpError(409, "duplicate", "This name already exists");
  if (msg.includes("FOREIGN KEY"))
    return op === "delete"
      ? new HttpError(409, "in_use", "Still used by other records")
      : new HttpError(400, "invalid_reference", "Unknown parent record");
  return e;
}

interface Entity {
  table: SQLiteTable & { id: SQLiteColumn };
  noun: string;
  row: z.ZodType;
  input: z.ZodType;
  patch: z.ZodType;
  query: z.ZodType;
  list: ListOptions;
  /** Has an `archivedAt` column: lists hide archived rows unless `?archived=true`. */
  archivable?: boolean;
  image?: { name: string; dir: string; column: string };
}

/** List / get / create / patch / hard delete (409 while referenced), plus an optional image. */
const crud =
  (db: Db, dataDir: string, o: Entity): FastifyPluginAsyncZod =>
  async (app) => {
    // Loosely typed on purpose: one implementation for three tables; zod guards both ends.
    const table = o.table as typeof brands;
    const get = (id: string) => {
      const row = db.select().from(table).where(eq(table.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", `${o.noun} not found`);
      return row as Record<string, unknown>;
    };
    const write = (run: () => unknown) => {
      try {
        return run();
      } catch (e) {
        throw constraint(e, "write");
      }
    };

    app.get("/", { schema: { querystring: o.query, response: { 200: pageOf(o.row) } } }, (req) => {
      const q = req.query as Parameters<typeof listPage>[2] & { archived?: string };
      const col = (table as unknown as typeof machineProfiles).archivedAt;
      const archived = o.archivable && (q.archived === "true" ? isNotNull(col) : isNull(col));
      return listPage(db, table, q, {
        ...o.list,
        where: [...(o.list.where ?? []), archived || undefined],
      });
    });

    app.get("/:id", { schema: { params, response: { 200: o.row, ...errors } } }, async (req) => {
      return get(req.params.id);
    });

    app.post(
      "/",
      { schema: { body: o.input, response: { 201: o.row, ...errors } } },
      (req, reply) =>
        reply.status(201).send(
          write(() =>
            db
              .insert(table)
              .values(req.body as never)
              .returning()
              .get(),
          ),
        ),
    );

    app.patch(
      "/:id",
      { schema: { params, body: o.patch, response: { 200: o.row, ...errors } } },
      async (req) => {
        get(req.params.id);
        return write(() =>
          db
            .update(table)
            .set(req.body as never)
            .where(eq(table.id, req.params.id))
            .returning()
            .get(),
        );
      },
    );

    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        get(req.params.id);
        try {
          db.delete(table).where(eq(table.id, req.params.id)).run();
        } catch (e) {
          throw constraint(e, "delete");
        }
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
        set: (id, path) =>
          db
            .update(table)
            .set({ [image.column]: path })
            .where(eq(table.id, id))
            .returning()
            .get(),
      });
  };

const brandOf = sql`(SELECT ${brands.name} FROM ${brands} WHERE ${brands.id} = ${printerModels.brandId})`;

export const brandsRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    table: brands,
    noun: "Brand",
    row: brandSchema,
    input: brandInputSchema,
    patch: brandPatchSchema,
    query: listQuery(brandSortFields, {}, brandFilters),
    list: {
      sort: { name: sql`${brands.name} COLLATE NOCASE`, createdAt: brands.createdAt },
      filters: { name: brands.name },
    },
    image: { name: "logo", dir: "brands", column: "logoPath" },
  });

export const printerModelsRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    table: printerModels,
    noun: "Printer model",
    row: printerModelSchema,
    input: printerModelInputSchema,
    patch: printerModelPatchSchema,
    query: listQuery(printerModelSortFields, {}, printerModelFilters),
    list: {
      sort: {
        model: sql`${brandOf} || ' ' || ${printerModels.model} COLLATE NOCASE`,
        createdAt: printerModels.createdAt,
        powerW: printerModels.powerW,
      },
      filters: {
        model: sql`${brandOf} || ' ' || ${printerModels.model}`,
        brandId: printerModels.brandId,
        powerW: printerModels.powerW,
      },
    },
    image: { name: "image", dir: "models", column: "imagePath" },
  });

export const machineProfilesRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    table: machineProfiles,
    noun: "Machine profile",
    row: machineProfileSchema,
    input: machineProfileInputSchema,
    patch: machineProfilePatchSchema,
    query: listQuery(machineProfileSortFields, { archived: archivedFilter }, machineProfileFilters),
    archivable: true,
    list: {
      sort: {
        name: sql`${machineProfiles.name} COLLATE NOCASE`,
        createdAt: machineProfiles.createdAt,
        nozzleDiameterMm: machineProfiles.nozzleDiameterMm,
      },
      filters: {
        name: machineProfiles.name,
        printerModelId: machineProfiles.printerModelId,
        nozzleDiameterMm: machineProfiles.nozzleDiameterMm,
      },
    },
  });

export const filamentBrandsRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    table: filamentBrands,
    noun: "Filament brand",
    row: filamentBrandSchema,
    input: filamentBrandInputSchema,
    patch: filamentBrandPatchSchema,
    query: listQuery(filamentBrandSortFields, {}, filamentCatalogFilters),
    list: {
      sort: {
        name: sql`${filamentBrands.name} COLLATE NOCASE`,
        createdAt: filamentBrands.createdAt,
      },
      filters: { name: filamentBrands.name },
    },
    image: { name: "logo", dir: "filament-brands", column: "logoPath" },
  });

export const filamentMaterialsRoutes = (db: Db, dataDir: string) =>
  crud(db, dataDir, {
    table: filamentMaterials,
    noun: "Filament material",
    row: filamentMaterialSchema,
    input: filamentMaterialInputSchema,
    patch: filamentMaterialPatchSchema,
    query: listQuery(filamentMaterialSortFields, {}, filamentCatalogFilters),
    list: {
      sort: {
        name: sql`${filamentMaterials.name} COLLATE NOCASE`,
        createdAt: filamentMaterials.createdAt,
      },
      filters: { name: filamentMaterials.name },
    },
  });
