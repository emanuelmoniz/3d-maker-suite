import {
  apiErrorSchema,
  isPresetConflict,
  presetDeviceSchema,
  presetDeviceUpdateSchema,
  type SlicerPreset,
  slicerPresetDetailSchema,
  slicerPresetSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { parsePreset } from "@3d-maker-suite/host";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { deletePreset } from "../integrations/presetLibrary.ts";
import type { HubChannel } from "../lib/hubChannel.ts";

const { devices, slicerPresets, slicerPresetVersions } = schema;
type Row = typeof slicerPresets.$inferSelect;
const params = z.object({ id: z.uuid() });

/** The hub's slicer preset library (ADR-0017): list, versions, download, delete, device switches. */
export const presetsRoutes =
  (db: Db, dataDir: string, channel: HubChannel): FastifyPluginAsyncZod =>
  async (app) => {
    const live = (id: string) => {
      const row = db.select().from(slicerPresets).where(eq(slicerPresets.id, id)).get();
      if (!row || row.deleted) throw new HttpError(404, "not_found", "Preset not found");
      return row;
    };
    const deviceNames = () =>
      new Map(
        db
          .select({ id: devices.id, name: devices.name })
          .from(devices)
          .all()
          .map((d) => [d.id, d.name]),
      );
    // A revoked device's delete says nothing any more.
    const itemOf = (
      { json, deleted: _, seq: __, ...r }: Row,
      names = deviceNames(),
    ): SlicerPreset => {
      const inherits = parsePreset(json)?.inherits;
      return {
        ...r,
        inherits: typeof inherits === "string" && inherits ? inherits : null,
        conflict: isPresetConflict(r.name),
        removedOn: r.removedOn.flatMap((id) => names.get(id) ?? []),
      };
    };

    app.get("/", { schema: { response: { 200: z.array(slicerPresetSchema) } } }, async () => {
      const names = deviceNames();
      return db
        .select()
        .from(slicerPresets)
        .where(eq(slicerPresets.deleted, false))
        .orderBy(asc(slicerPresets.library), asc(slicerPresets.kind), asc(slicerPresets.name))
        .all()
        .map((r) => itemOf(r, names));
    });

    // Only devices with a slicer have presets to share.
    app.get("/devices", { schema: { response: { 200: z.array(presetDeviceSchema) } } }, async () =>
      db
        .select()
        .from(devices)
        .orderBy(asc(devices.name))
        .all()
        .filter((d) => d.slicers.length)
        .map(({ id, name, sharePresets }) => ({
          id,
          name,
          sharePresets,
          online: channel.online(id),
        })),
    );

    app.patch(
      "/devices/:id",
      {
        schema: {
          params,
          body: presetDeviceUpdateSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const row = db.select().from(devices).where(eq(devices.id, req.params.id)).get();
        if (!row) throw new HttpError(404, "not_found", "Device not found");
        const share = req.body.sharePresets;
        if (share !== row.sharePresets) {
          db.update(devices).set({ sharePresets: share }).where(eq(devices.id, row.id)).run();
          channel.publish(row.id, { type: "device.presets", share });
        }
        return reply.status(204).send(null);
      },
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
