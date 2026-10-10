import { join } from "node:path";
import {
  apiErrorSchema,
  type FilamentLibrary,
  importPreviewSchema,
  SLICER_ZIP_TYPES,
  type SlicerZipSource,
  slicerZipSourceSchema,
  slicerZipUploadSchema,
} from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { createReview, type Stored } from "../import/review.ts";
import { openUpload, unpackSlicerZip } from "../integrations/slicerZip.ts";
import { libraryRows } from "../integrations/sourceRows.ts";
import type { Syncer } from "../integrations/sync.ts";

const MAX_UPLOAD = 100 * 1024 ** 2;
const ZIP_TYPE = "application/zip";
const FOLDER = "slicer-zips";
const params = z.object({ id: z.uuid(), type: z.enum(SLICER_ZIP_TYPES) });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema };

// A slicer's config folder uploaded as a zip, for a server that has no slicer installed: it is
// unpacked and read by the same readers as the local folder, then reviewed per type like any import.
export const slicerZipRoutes =
  (db: Db, syncer: Syncer, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const base = join(dataDir, FOLDER);
    const review = createReview(db, dataDir);
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

    // The rows one type of the zip offers, kept for `POST /api/import/:entity/apply`.
    app.post(
      "/:id/:type",
      { schema: { params, response: { 200: importPreviewSchema, ...errors } } },
      async (req) => {
        const { id, type } = req.params;
        const { root, source } = openUpload(base, id);
        const stored: Stored = {
          entity: type,
          ignoredHeaders: [],
          from: { kind: "zip" },
          rows: await libraryRows(db, libraryOf(source), root, type, {
            includeSystem: true,
            dataDir,
          }),
        };
        return { uploadId: review.save(stored), ...review.preview(stored) };
      },
    );
  };
