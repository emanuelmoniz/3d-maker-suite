import {
  apiErrorSchema,
  type CatalogPreview,
  catalogImportSchema,
  catalogPreviewSchema,
  libraryImportResultSchema,
  SLICER_CATALOG_TYPES,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { catalogEntries } from "../integrations/catalogImport.ts";
import { libraryOf } from "../integrations/imports.ts";
import type { Syncer } from "../integrations/sync.ts";

const params = z.object({ id: z.uuid(), type: z.enum(SLICER_CATALOG_TYPES) });
const notFound = { 404: apiErrorSchema };

// An integration's slicer catalog (brands, printer models, machine profiles, filament brands):
// preview what the folder offers, then import the picked rows (a manual sync run of that type).
export const slicerCatalogRoutes =
  (db: Db, syncer: Syncer): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:id/:type",
      { schema: { params, response: { 200: catalogPreviewSchema, ...notFound } } },
      async (req): Promise<CatalogPreview> => {
        const { id, type } = req.params;
        const { lib, dir } = libraryOf(db, syncer.adapters, id, type);
        const entries = await catalogEntries(db, lib, dir, type, "");
        return { dir, items: entries.map(({ apply: _apply, ...item }) => item) };
      },
    );

    app.post(
      "/:id/:type/import",
      {
        schema: {
          params,
          body: catalogImportSchema,
          response: { 200: libraryImportResultSchema, ...notFound },
        },
      },
      // Re-read from the folder, so the preview is only a selection.
      async (req) => {
        const run = await syncer.run(
          req.params.id,
          "manual",
          { type: req.params.type },
          { catalog: new Set(req.body.keys) },
        );
        if (run.errorCode) throw new HttpError(502, run.errorCode, "Couldn't import");
        return { created: run.created };
      },
    );
  };
