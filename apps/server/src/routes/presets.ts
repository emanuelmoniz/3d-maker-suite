import {
  apiErrorSchema,
  isPresetConflict,
  type SlicerPreset,
  slicerPresetDetailSchema,
  slicerPresetSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { deletePreset, parsePreset } from "../integrations/presetLibrary.ts";

const { slicerPresets, slicerPresetVersions } = schema;
type Row = typeof slicerPresets.$inferSelect;
const params = z.object({ id: z.uuid() });

const itemOf = ({ json, deleted: _, seq: __, ...r }: Row): SlicerPreset => {
  const inherits = parsePreset(json)?.inherits;
  return {
    ...r,
    inherits: typeof inherits === "string" && inherits ? inherits : null,
    conflict: isPresetConflict(r.name),
  };
};

/** The hub's slicer preset library (ADR-0017): list, versions, download and delete. */
export const presetsRoutes =
  (db: Db, dataDir: string): FastifyPluginAsyncZod =>
  async (app) => {
    const live = (id: string) => {
      const row = db.select().from(slicerPresets).where(eq(slicerPresets.id, id)).get();
      if (!row || row.deleted) throw new HttpError(404, "not_found", "Preset not found");
      return row;
    };

    app.get("/", { schema: { response: { 200: z.array(slicerPresetSchema) } } }, async () =>
      db
        .select()
        .from(slicerPresets)
        .where(eq(slicerPresets.deleted, false))
        .orderBy(asc(slicerPresets.library), asc(slicerPresets.kind), asc(slicerPresets.name))
        .all()
        .map(itemOf),
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: slicerPresetDetailSchema, 404: apiErrorSchema } } },
      async (req) => ({
        ...itemOf(live(req.params.id)),
        versions: db
          .select({
            version: slicerPresetVersions.version,
            sha256: slicerPresetVersions.sha256,
            savedUser: slicerPresetVersions.savedUser,
            savedDevice: slicerPresetVersions.savedDevice,
            savedAt: slicerPresetVersions.savedAt,
          })
          .from(slicerPresetVersions)
          .where(eq(slicerPresetVersions.presetId, req.params.id))
          .orderBy(desc(slicerPresetVersions.version))
          .all(),
      }),
    );

    // The json as received; `version` = an earlier one.
    app.get(
      "/:id/download",
      {
        schema: {
          params,
          querystring: z.object({ version: z.coerce.number().int().optional() }),
        },
      },
      async (req, reply) => {
        const row = live(req.params.id);
        const { version } = req.query;
        const json =
          version === undefined || version === row.version
            ? row.json
            : db
                .select({ json: slicerPresetVersions.json })
                .from(slicerPresetVersions)
                .where(
                  and(
                    eq(slicerPresetVersions.presetId, row.id),
                    eq(slicerPresetVersions.version, version),
                  ),
                )
                .get()?.json;
        if (json === undefined) throw new HttpError(404, "not_found", "Version not found");
        return reply
          .type("application/json")
          .header(
            "content-disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(`${row.name}.json`)}`,
          )
          .send(json);
      },
    );

    // Gone from the hub slicer and workers; desktops keep theirs (their cloud would bring it back).
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), 404: apiErrorSchema } } },
      async (req, reply) => {
        live(req.params.id);
        deletePreset(db, dataDir, req.params.id, { user: req.user?.displayName });
        return reply.status(204).send(null);
      },
    );
  };
