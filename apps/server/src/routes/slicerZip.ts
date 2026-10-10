import { join } from "node:path";
import {
  apiErrorSchema,
  type CatalogPreview,
  catalogImportSchema,
  catalogPreviewSchema,
  type FilamentLibrary,
  libraryImportResultSchema,
  SLICER_ZIP_TYPES,
  type SlicerZipSource,
  slicerZipSourceSchema,
  slicerZipUploadSchema,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { type CatalogType, catalogEntries, importCatalog } from "../integrations/catalogImport.ts";
import { importPresets, presetStatus, profileIndex } from "../integrations/imports.ts";
import { openUpload, unpackSlicerZip } from "../integrations/slicerZip.ts";
import type { Syncer } from "../integrations/sync.ts";

const MAX_UPLOAD = 100 * 1024 ** 2;
const ZIP_TYPE = "application/zip";
const FOLDER = "slicer-zips";
const params = z.object({ id: z.uuid(), type: z.enum(SLICER_ZIP_TYPES) });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema };

// A slicer's config folder uploaded as a zip, for a server that has no slicer installed: it is
// unpacked and read by the same readers as the local folder, then previewed and imported per type.
export const slicerZipRoutes =
  (db: Db, syncer: Syncer, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const base = join(dataDir, FOLDER);
    const libraries = new Map<string, FilamentLibrary>(
      syncer.adapters.flatMap((a) =>
        a.library?.readCatalog && a.library.folders ? [[a.library.id, a.library] as const] : [],
      ),
    );
    const libraryOf = (source: string) => {
      const lib = libraries.get(source);
      if (!lib) throw new HttpError(404, "source_not_found", "Unknown slicer");
      return lib;
    };

    app.addContentTypeParser(
      ZIP_TYPE,
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD },
      (_r, b, done) => done(null, b),
    );

    app.get(
      "/sources",
      { schema: { response: { 200: z.array(slicerZipSourceSchema) } } },
      async (): Promise<SlicerZipSource[]> =>
        [...libraries.values()].flatMap((l) =>
          l.folders ? [{ id: l.id, folders: l.folders }] : [],
        ),
    );

    // Raw zip body. Nothing is written to the database.
    app.post(
      "/:source",
      {
        schema: {
          params: z.object({ source: z.string() }),
          response: { 200: slicerZipUploadSchema, ...errors },
        },
      },
      async (req) => {
        const { source } = req.params;
        libraryOf(source);
        if (!Buffer.isBuffer(req.body) || !req.body.length)
          throw new HttpError(415, "unsupported_media_type", "Send a .zip file");
        const uploadId = crypto.randomUUID();
        await unpackSlicerZip(base, uploadId, source, req.body);
        return { uploadId };
      },
    );

    app.get(
      "/:id/:type",
      { schema: { params, response: { 200: catalogPreviewSchema, ...errors } } },
      async (req): Promise<CatalogPreview> => {
        const { root, source } = openUpload(base, req.params.id);
        const lib = libraryOf(source);
        if (req.params.type !== "filamentProfiles") {
          const entries = await catalogEntries(db, lib, root, req.params.type as CatalogType, "");
          return { dir: "", items: entries.map(({ apply: _apply, ...item }) => item) };
        }
        const idx = profileIndex(db);
        const presets = await lib.read(root, { includeSystem: true });
        return {
          dir: "",
          items: presets.map((p) => ({
            key: p.presetId,
            kind: "filamentProfile",
            label: `${p.brand} ${p.name}`.trim(),
            // A hand-made twin is skipped on import, so it counts as there already.
            status: ((s) => (s === "duplicate" ? "imported" : s))(presetStatus(idx, lib.id, p)),
          })),
        };
      },
    );

    app.post(
      "/:id/:type/import",
      {
        schema: {
          params,
          body: catalogImportSchema,
          response: { 200: libraryImportResultSchema, ...errors },
        },
      },
      // Re-read from the folder, so the preview is only a selection.
      async (req) => {
        const { root, source } = openUpload(base, req.params.id);
        const lib = libraryOf(source);
        const picked = new Set(req.body.keys);
        if (req.params.type === "filamentProfiles")
          return {
            created: importPresets(
              db,
              lib.id,
              await lib.read(root, { includeSystem: true }),
              picked,
            ).created,
          };
        const entries = await catalogEntries(
          db,
          lib,
          root,
          req.params.type as CatalogType,
          dataDir,
        );
        return { created: importCatalog(db, entries, picked).created };
      },
    );
  };
