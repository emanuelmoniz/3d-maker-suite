import {
  apiErrorSchema,
  type IntegrationAdapter,
  isPresetConflict,
  presetDeviceSchema,
  presetHeldActionSchema,
  presetRestoreSchema,
  type SlicerPreset,
  slicerPresetDetailSchema,
  slicerPresetSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { parsePreset } from "@3d-maker-suite/host";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { deviceLibraries } from "../integrations/capabilities.ts";
import {
  deletePreset,
  presetUses,
  resolveHeld,
  restorePreset,
} from "../integrations/presetLibrary.ts";
import type { Rights } from "../lib/auth.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { VERSION } from "../updates/updates.ts";

const { devices, slicerPresets, slicerPresetVersions, users } = schema;
type Row = typeof slicerPresets.$inferSelect;
const params = z.object({ id: z.uuid() });

/**
 * The hub's slicer preset library (ADR-0017): list, versions, download, delete, Restore, held
 * removals (ADR-0019), device switches per slicer (ADR-0020).
 */
export const presetsRoutes =
  (
    db: Db,
    dataDir: string,
    channel: HubChannel,
    adapters: IntegrationAdapter[],
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const live = (id: string) => {
      const row = db.select().from(slicerPresets).where(eq(slicerPresets.id, id)).get();
      if (!row || row.deleted) throw new HttpError(404, "not_found", "Preset not found");
      return row;
    };
    /** Device and user names now, and whose rights label what uses a preset. */
    const lookups = (user?: Rights) => ({
      devices: new Map(
        db
          .select({ id: devices.id, name: devices.name })
          .from(devices)
          .all()
          .map((d) => [d.id, d.name]),
      ),
      users: new Map(
        db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .all()
          .map((u) => [u.id, u.name]),
      ),
      user,
    });
    // A revoked device's delete says nothing any more.
    const itemOf = (
      { json, deleted: _, seq: __, ownerUserId, heldBy, heldReason, ...r }: Row,
      names: ReturnType<typeof lookups>,
    ): SlicerPreset => {
      const inherits = parsePreset(json)?.inherits;
      const heldOn = heldBy && names.devices.get(heldBy);
      return {
        ...r,
        inherits: typeof inherits === "string" && inherits ? inherits : null,
        conflict: isPresetConflict(r.name),
        owner: (ownerUserId && names.users.get(ownerUserId)) || null,
        removedOn: r.removedOn.flatMap((id) => names.devices.get(id) ?? []),
        held:
          heldBy && heldOn
            ? { deviceId: heldBy, device: heldOn, reason: heldReason ?? "mass" }
            : null,
        usedBy: r.removedOn.length ? presetUses(db, r, names.user) : [],
      };
    };
    const list = (deleted: boolean, user?: Rights) => {
      const names = lookups(user);
      return db
        .select()
        .from(slicerPresets)
        .where(eq(slicerPresets.deleted, deleted))
        .orderBy(asc(slicerPresets.library), asc(slicerPresets.kind), asc(slicerPresets.name))
        .all()
        .map((r) => itemOf(r, names));
    };

    app.get("/", { schema: { response: { 200: z.array(slicerPresetSchema) } } }, async (req) =>
      list(false, req.user),
    );
    // What Restore can bring back (ADR-0019).
    app.get(
      "/deleted",
      { schema: { response: { 200: z.array(slicerPresetSchema) } } },
      async (req) => list(true, req.user),
    );

    // The device × slicer table (ADR-0020): a row per slicer it reports, and per one it no longer
    // does but has switches for. Only devices with a slicer have presets to send or install.
    app.get(
      "/devices",
      { schema: { response: { 200: z.array(presetDeviceSchema) } } },
      async () => {
        const held = db
          .select({ device: slicerPresets.heldBy, library: slicerPresets.library })
          .from(slicerPresets)
          .where(and(eq(slicerPresets.deleted, false), isNotNull(slicerPresets.heldBy)))
          .all();
        return db
          .select()
          .from(devices)
          .orderBy(asc(devices.name))
          .all()
          .map((d) => {
            const reported = deviceLibraries(adapters, d.slicers);
            const libs = [...new Set([...reported, ...Object.keys(d.presetLibraries)])].sort();
            return {
              id: d.id,
              name: d.name,
              userId: d.userId,
              online: channel.online(d.id),
              // As `connector_outdated`: its removals are only shown, and it receives no deletes.
              outdated: !!d.connectorVersion && d.connectorVersion !== VERSION,
              libraries: libs.map((library) => {
                const s = d.presetLibraries[library];
                return {
                  library,
                  reported: reported.includes(library),
                  send: !!s?.user.share,
                  install: !!s?.user.receive,
                  shareKinds: s?.user.shareKinds ?? [],
                  sentAt: s?.sentAt ?? null,
                  held: held.filter((h) => h.device === d.id && h.library === library).length,
                  status:
                    (s?.user.receive && d.presetInstall?.find((p) => p.library === library)) ||
                    null,
                };
              }),
            };
          })
          .filter((d) => d.libraries.length);
      },
    );

    app.post(
      "/devices/:id/held",
      {
        schema: {
          params,
          body: presetHeldActionSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (req, reply) => {
        if (!db.select({ id: devices.id }).from(devices).where(eq(devices.id, req.params.id)).get())
          throw new HttpError(404, "not_found", "Device not found");
        resolveHeld(db, dataDir, req.params.id, req.body.action, {
          user: req.user?.displayName,
        });
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: slicerPresetDetailSchema, 404: apiErrorSchema } } },
      async (req) => ({
        ...itemOf(live(req.params.id), lookups(req.user)),
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

    // A deleted preset's last content, or an earlier version, as its next version; its owner stays.
    app.post(
      "/:id/restore",
      {
        schema: {
          params,
          body: presetRestoreSchema,
          response: { 200: slicerPresetSchema, 404: apiErrorSchema },
        },
      },
      async (req) => {
        const row = restorePreset(db, dataDir, req.params.id, req.body.version, {
          user: req.user?.displayName,
        });
        if (!row) throw new HttpError(404, "not_found", "Version not found");
        return itemOf(row, lookups(req.user));
      },
    );

    // Gone from the hub slicer and workers, and from Install devices that hold it unedited.
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
