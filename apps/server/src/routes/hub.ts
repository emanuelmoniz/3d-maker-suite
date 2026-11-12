import { randomBytes } from "node:crypto";
import { posix, win32 } from "node:path";
import {
  apiErrorSchema,
  connectorInfoSchema,
  connectorSettingsPatchSchema,
  connectorSettingsResultSchema,
  connectorSettingsSchema,
  connectorUpdateFailureSchema,
  deviceLibraryUpdateSchema,
  devicePathIn,
  deviceSchema,
  deviceUpdateSchema,
  deviceUserChangeSchema,
  deviceUserCheckSchema,
  deviceUserPreviewSchema,
  deviceUserResultSchema,
  emptyPresetLibrary,
  HUB_HEARTBEAT_MS,
  type HubEvent,
  type HubVersionsUsage,
  hasLevel,
  hubVersionsUsageSchema,
  type IntegrationAdapter,
  pairingCodeCreateSchema,
  pairingCodeSchema,
  pairResultSchema,
  pairSchema,
  pickCreateSchema,
  pickSchema,
  pickUpdateSchema,
  presetSwitches,
  ROOT_HUB,
  type SharedFolder,
  sharedFolderPathSchema,
  sharedFolderSchema,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq, inArray, lte } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { deviceLibraries, presetLibrary } from "../integrations/capabilities.ts";
import { catalogSource } from "../integrations/catalogSource.ts";
import type { DeviceCatalog } from "../integrations/deviceCatalog.ts";
import { loginLimiter, machineGuard } from "../lib/auth.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { deviceError, setPresetLibrary } from "../lib/machine.ts";
import { readPreferences } from "../lib/preferences.ts";
import { isEnabled, tokenHash } from "../lib/session.ts";
import { ensurePick, picksOf } from "../projects/picks.ts";
import { VERSION } from "../updates/updates.ts";

const {
  devicePicks,
  devices,
  hubEvents,
  integrations,
  pairingCodes,
  projects,
  roles,
  roots,
  users,
} = schema;
const params = z.object({ id: z.uuid() });
const errors = { 404: apiErrorSchema, 409: apiErrorSchema };

const CODE_TTL_MS = 10 * 60_000;
// 32 symbols, no 0/O or 1/I; 256 % 32 = 0, so a byte maps without bias. 8 symbols = 40 bits.
const SYMBOLS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => {
  const s = [...randomBytes(8)].map((b) => SYMBOLS[b % 32]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
/** Typed codes: any case, with or without the dash. */
const codeHash = (code: string) => tokenHash(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

/** No catalog work (a hub without one wired, in tests). */
const noCatalog = {
  connected: async () => ({ libraries: {} }),
  connectedInstall: async () => ({}),
  confirmInstall: async () => {},
  tell: async () => {},
};

/**
 * Hub management and pairing (ADR-0014). hub.manage (lib/auth.ts), except `POST /pair`, which is
 * public: the connector has only the code; `GET /events` and `/device/user`, which any paired
 * device may use; and the machine page's routes, which its own user may use too (ADR-0021,
 * `machineGuard`). With the hub off, none of it exists.
 */
export const hubRoutes =
  (
    db: Db,
    channel: HubChannel,
    /** A device opened its stream: its version may open or clear the outdated alert. */
    onConnect: () => void = () => {},
    /** Before a device is revoked: its locks are released. */
    onRevoke: (deviceId: string) => void = () => {},
    /** Disk used by the kept file versions. */
    versionsUsage: () => HubVersionsUsage = () => ({ files: 0, bytes: 0 }),
    /** Catalog source and Receive catalog (ADR-0020, ADR-0021): connect headers and switches. */
    catalogs: Pick<
      DeviceCatalog,
      "connected" | "connectedInstall" | "confirmInstall" | "tell"
    > = noCatalog,
    adapters: IntegrationAdapter[] = [],
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("onRequest", async () => {
      if (!readPreferences(db).hubEnabled) throw new HttpError(404, "hub_off", "The hub is off");
    });

    app.get("/versions", { schema: { response: { 200: hubVersionsUsageSchema } } }, async () =>
      versionsUsage(),
    );

    /** A machine's worker rows, with their libraries: a managed one isn't in its slicer list. */
    const workerRows = (deviceId: string) =>
      db
        .select()
        .from(integrations)
        .all()
        .flatMap((row) => {
          const a = adapters.find((x) => x.id === row.adapterId);
          return a?.kind === "worker" &&
            workerConfigSchema.safeParse(row.config).data?.deviceId === deviceId
            ? [{ row, library: presetLibrary(a) }]
            : [];
        });
    /**
     * The machine's install is the library's hub's slicer (ADR-0022), so its catalog source;
     * `picked`: by an admin, not the default.
     */
    const hubSlicerOn = (deviceId: string, library: string) => {
      const source = catalogSource(db, adapters, library);
      return source && "deviceId" in source && source.deviceId === deviceId ? source : null;
    };
    const isHubSlicer = (deviceId: string, library: string) => !!hubSlicerOn(deviceId, library);

    // ponytail: unpaginated, a hub has a handful of devices. Without hub.manage, only the caller's.
    app.get("/devices", { schema: { response: { 200: z.array(deviceSchema) } } }, async (req) =>
      db
        .select({
          id: devices.id,
          name: devices.name,
          userId: devices.userId,
          userName: users.displayName,
          os: devices.os,
          connectorVersion: devices.connectorVersion,
          updateFailed: devices.updateFailed,
          sync: devices.syncState,
          slicers: devices.slicers,
          sliceWorker: devices.sliceWorker,
          presets: devices.presetLibraries,
          receiveProjects: devices.receiveProjects,
          shareProjects: devices.shareProjects,
          sharedFolders: devices.sharedFolders,
          lastSeenAt: devices.lastSeenAt,
          createdAt: devices.createdAt,
        })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .where(
          !req.user || req.user.rights.admin || req.user.rights.permissions["hub.manage"]
            ? undefined
            : eq(devices.userId, req.user.id),
        )
        .orderBy(asc(devices.name))
        .all()
        .map((d) => {
          const outdated = !!d.connectorVersion && d.connectorVersion !== VERSION;
          const libs = new Set([
            ...deviceLibraries(adapters, d.slicers),
            ...Object.keys(d.presets),
            ...workerRows(d.id).map((w) => w.library),
          ]);
          return {
            ...d,
            libraries: Object.fromEntries(
              [...libs].map((lib) => [lib, { hubSlicer: isHubSlicer(d.id, lib) }]),
            ),
            online: channel.online(d.id),
            port: channel.port(d.id),
            outdated,
            updateFailed: outdated ? d.updateFailed : null,
            picks: picksOf(db, d.id),
          };
        }),
    );

    // Update now: the connector downloads the hub's version at once, even one that rolled back.
    app.post(
      "/devices/:id/update",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const row = db.select().from(devices).where(eq(devices.id, req.params.id)).get();
        if (!row) throw new HttpError(404, "not_found", "Device not found");
        if (!channel.online(req.params.id))
          throw new HttpError(409, "device_offline", "The device is offline");
        channel.publish(req.params.id, { type: "connector.update" });
        return reply.status(204).send(null);
      },
    );

    // The machine page's connector settings: live requests (409 offline, 504 no answer), never
    // queued for a reconnect. ENOTSUP: a connector older than this request (`deviceError`).
    const settingsErrors = { ...errors, 502: apiErrorSchema, 504: apiErrorSchema };

    app.get(
      "/devices/:id/settings",
      { schema: { params, response: { 200: connectorSettingsSchema, ...settingsErrors } } },
      async (req) => {
        machineGuard(db, req.user, req.params.id);
        return channel.ask(
          req.params.id,
          (requestId) => ({ type: "connector.settings.get", requestId }),
          connectorSettingsSchema,
          { error: deviceError },
        );
      },
    );

    app.put(
      "/devices/:id/settings",
      {
        schema: {
          params,
          body: connectorSettingsPatchSchema,
          response: { 200: connectorSettingsResultSchema, ...settingsErrors },
        },
      },
      async (req) => {
        const { port, autostart, defaultSlicer } = req.body;
        machineGuard(db, req.user, req.params.id);
        if (port !== undefined || autostart !== undefined)
          machineGuard(db, req.user, req.params.id, "connection");
        if (defaultSlicer !== undefined) machineGuard(db, req.user, req.params.id, "slicers");
        const res = await channel.ask(
          req.params.id,
          (requestId) => ({ type: "connector.settings.set", requestId, ...req.body }),
          connectorSettingsResultSchema,
          { error: deviceError },
        );
        // A connector before 5.5.0 drops a key it doesn't know and answers ok.
        if (defaultSlicer !== undefined && res.defaultSlicer === undefined)
          throw new HttpError(409, "device_outdated", "The connector is too old for this");
        return res;
      },
    );

    // Restart and Stop: answered first, then the connector exits (Stop: until login or by hand).
    for (const action of ["restart", "stop"] as const)
      app.post(
        `/devices/:id/${action}`,
        { schema: { params, response: { 204: z.null(), ...settingsErrors } } },
        async (req, reply) => {
          machineGuard(db, req.user, req.params.id, "connection");
          await channel.ask(
            req.params.id,
            (requestId) => ({ type: `connector.${action}`, requestId }),
            z.null(),
            { error: deviceError },
          );
          return reply.status(204).send(null);
        },
      );

    // Receive on or off makes the connector sync again from scratch (`roots.changed`).
    // Share goes to it first while it's online (ENOTSUP: too old, nothing saved); offline, it
    // reads it when it connects (`X-Share-Projects`).
    app.patch(
      "/devices/:id",
      {
        schema: {
          params,
          body: deviceUpdateSchema,
          response: { 204: z.null(), ...settingsErrors },
        },
      },
      async (req, reply) => {
        const { name, receiveProjects, shareProjects } = req.body;
        const row = machineGuard(db, req.user, req.params.id);
        if (name !== undefined) machineGuard(db, req.user, row.id, "manage");
        if (receiveProjects !== undefined || shareProjects !== undefined)
          machineGuard(db, req.user, row.id, "projects");
        if (
          shareProjects !== undefined &&
          shareProjects !== row.shareProjects &&
          channel.online(row.id)
        )
          await channel.ask(
            row.id,
            (requestId) => ({ type: "projects.share", requestId, on: shareProjects }),
            z.null(),
            { error: deviceError },
          );
        if (Object.keys(req.body).length)
          db.update(devices).set(req.body).where(eq(devices.id, row.id)).run();
        if (name !== undefined && name !== row.name)
          channel.publish(row.id, { type: "device.renamed", name });
        if (receiveProjects !== undefined && receiveProjects !== row.receiveProjects)
          channel.publish(row.id, { type: "roots.changed" });
        return reply.status(204).send(null);
      },
    );

    /**
     * A machine's shared folders (ADR-0021), from Projects settings → Sources: its user with
     * machine.projects and projects write, or hub.manage. Each change is saved, queued for the
     * connector (`folders.set`) and logged with its actor; the answer is the new list.
     */
    const foldersSchema = {
      params,
      response: { 200: z.array(sharedFolderSchema), ...errors, 400: apiErrorSchema },
    };
    const foldersOf = (req: FastifyRequest, id: string) => {
      const row = machineGuard(db, req.user, id, "projects");
      if (!row.sharedFolders)
        throw new HttpError(
          409,
          "device_outdated",
          "Its connector hasn't sent its shared folders yet: update it",
        );
      return { row, list: row.sharedFolders };
    };
    const saveFolders = (
      req: FastifyRequest,
      deviceId: string,
      list: SharedFolder[],
      message: string,
      path: string,
    ) => {
      db.update(devices).set({ sharedFolders: list }).where(eq(devices.id, deviceId)).run();
      channel.publish(deviceId, { type: "folders.set", folders: list });
      req.log.info({ deviceId, path }, message);
      return list;
    };
    const listed = (list: SharedFolder[], path: string) => {
      if (!list.some((f) => f.path === path))
        throw new HttpError(404, "not_found", "Not a shared folder of this machine");
    };

    // A folder inside a shared one is shared already; folders inside a new one become part of it.
    app.post(
      "/devices/:id/folders",
      { schema: { ...foldersSchema, body: sharedFolderPathSchema } },
      async (req) => {
        const { row, list } = foldersOf(req, req.params.id);
        const { path } = req.body;
        if (!win32.isAbsolute(path) && !posix.isAbsolute(path))
          throw new HttpError(400, "validation_error", "Path must be absolute");
        if (list.some((f) => devicePathIn(f.path, path)))
          throw new HttpError(409, "folder_covered", "This folder is shared already");
        const next = [...list.filter((f) => !devicePathIn(path, f.path)), { path, paused: false }];
        return saveFolders(req, row.id, next, "shared folder added", path);
      },
    );
    app.patch(
      "/devices/:id/folders",
      { schema: { ...foldersSchema, body: sharedFolderSchema } },
      async (req) => {
        const { row, list } = foldersOf(req, req.params.id);
        const { path, paused } = req.body;
        listed(list, path);
        const next = list.map((f) => (f.path === path ? { path, paused } : f));
        return saveFolders(
          req,
          row.id,
          next,
          paused ? "shared folder paused" : "shared folder resumed",
          path,
        );
      },
    );
    // Its project folders stay, "unshared", until it's shared again.
    app.delete(
      "/devices/:id/folders",
      { schema: { ...foldersSchema, body: sharedFolderPathSchema } },
      async (req) => {
        const { row, list } = foldersOf(req, req.params.id);
        const { path } = req.body;
        listed(list, path);
        const next = list.filter((f) => f.path !== path);
        return saveFolders(req, row.id, next, "shared folder removed", path);
      },
    );

    // A machine's switches for one slicer library (ADR-0022), set on Catalog settings → Sources.
    app.patch(
      "/devices/:id/slicers/:library",
      {
        schema: {
          params: params.extend({ library: z.string().max(100) }),
          body: deviceLibraryUpdateSchema,
          response: { 204: z.null(), ...settingsErrors },
        },
      },
      async (req, reply) => {
        const { library } = req.params;
        const { system, user } = req.body;
        const row = machineGuard(db, req.user, req.params.id);
        if (!adapters.some((a) => (a.desktop || a.library) && presetLibrary(a) === library))
          throw new HttpError(404, "not_found", "No such slicer");
        if (system || user) machineGuard(db, req.user, row.id, "catalog");
        // The hub's slicer's own folder is the catalog: it receives none.
        if (system?.receive && hubSlicerOn(row.id, library))
          throw new HttpError(409, "hub_slicer", "It is this slicer's hub's slicer");
        if (!system && !user) return reply.status(204).send(null);
        const old = row.presetLibraries[library] ?? emptyPresetLibrary();
        // A connector that can't write the catalog says so first, and nothing is saved.
        if (system?.receive && !old.system.receive) await catalogs.confirmInstall(row.id);
        await setPresetLibrary(db, channel, row, library, {
          ...old,
          system: { ...old.system, ...system },
          user: { ...old.user, ...user },
        });
        if (system) void catalogs.tell().catch(() => {});
        return reply.status(204).send(null);
      },
    );

    /**
     * A machine's picks (ADR-0021), from Projects settings → Sources: hub.manage or projects manage,
     * on a machine the caller can see. Each change makes the connector sync again from scratch
     * (`roots.changed`): files a pick no longer covers leave the machine, never the hub. The answer
     * is the machine's picks.
     */
    const picksSchema = {
      response: { 200: z.array(pickSchema), ...errors, 400: apiErrorSchema },
    };
    const pickParams = params.extend({ pickId: z.uuid() });
    const pickGuard = (req: FastifyRequest, deviceId: string) => {
      const row = machineGuard(db, req.user, deviceId);
      const rights = req.user?.rights;
      if (
        rights &&
        !rights.admin &&
        !rights.permissions["hub.manage"] &&
        !hasLevel(rights.permissions, "projects", "manage")
      )
        throw new HttpError(403, "forbidden", "Not allowed for your role");
      return row;
    };
    const pickOf = (deviceId: string, pickId: string) => {
      const pick = db
        .select()
        .from(devicePicks)
        .where(and(eq(devicePicks.id, pickId), eq(devicePicks.deviceId, deviceId)))
        .get();
      if (!pick) throw new HttpError(404, "not_found", "Not a pick of this machine");
      return pick;
    };
    const savedPick = (req: FastifyRequest, deviceId: string, message: string, path: string) => {
      channel.publish(deviceId, { type: "roots.changed" });
      req.log.info({ deviceId, path }, message);
      return picksOf(db, deviceId);
    };

    app.post(
      "/devices/:id/picks",
      { schema: { ...picksSchema, params, body: pickCreateSchema } },
      async (req) => {
        const row = pickGuard(req, req.params.id);
        const { rootId, path, level } = req.body;
        const root = db.select().from(roots).where(eq(roots.id, rootId)).get();
        if (root?.location !== ROOT_HUB)
          throw new HttpError(404, "not_found", "Not a project folder on the hub");
        const taken = db
          .select({ id: devicePicks.id })
          .from(devicePicks)
          .where(
            and(
              eq(devicePicks.deviceId, row.id),
              eq(devicePicks.rootId, rootId),
              eq(devicePicks.path, path),
            ),
          )
          .get();
        if (taken) throw new HttpError(409, "pick_exists", "This machine has this pick already");
        ensurePick(db, row.id, rootId, path, level);
        return savedPick(req, row.id, "pick added", `${root.name}/${path}`);
      },
    );
    app.patch(
      "/devices/:id/picks/:pickId",
      { schema: { ...picksSchema, params: pickParams, body: pickUpdateSchema } },
      async (req) => {
        const row = pickGuard(req, req.params.id);
        const pick = pickOf(row.id, req.params.pickId);
        const { paused, level } = req.body;
        if (paused !== undefined || level)
          db.update(devicePicks).set({ paused, level }).where(eq(devicePicks.id, pick.id)).run();
        const message =
          paused === undefined ? `pick at ${level}` : paused ? "pick paused" : "pick resumed";
        return savedPick(req, row.id, message, pick.path);
      },
    );
    app.delete(
      "/devices/:id/picks/:pickId",
      { schema: { ...picksSchema, params: pickParams } },
      async (req) => {
        const row = pickGuard(req, req.params.id);
        const pick = pickOf(row.id, req.params.pickId);
        db.delete(devicePicks).where(eq(devicePicks.id, pick.id)).run();
        return savedPick(req, row.id, "pick removed", pick.path);
      },
    );

    // Revoke: the token stops working at once, and its open stream ends.
    app.delete(
      "/devices/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        onRevoke(req.params.id);
        const gone = db.delete(devices).where(eq(devices.id, req.params.id)).run().changes;
        if (!gone) throw new HttpError(404, "not_found", "Device not found");
        channel.end(req.params.id);
        req.log.info({ deviceId: req.params.id }, "device revoked");
        return reply.status(204).send(null);
      },
    );

    app.addHook("preClose", async () => channel.end());

    /**
     * Hub → device commands (ADR-0014), device tokens only. `Last-Event-ID` acks (deletes) the
     * device's events up to it; the rest are replayed, then live ones follow. A `: hb` comment every
     * 15 s keeps the device online and proxies from closing a quiet stream.
     */
    app.get("/events", async (req, reply) => {
      const deviceId = req.deviceId;
      if (!deviceId) throw new HttpError(403, "forbidden", "Only a paired device can open this");
      let system: unknown;
      try {
        system = JSON.parse(String(req.headers["x-connector-system"]));
      } catch {}
      const info = connectorInfoSchema.safeParse({
        connectorVersion: req.headers["x-connector-version"],
        os: req.headers["x-connector-os"],
        system,
      });
      // The connector tried to update to the hub's version before opening this: a failure says why
      // it didn't, none clears the last one.
      let failed: unknown = null;
      try {
        failed = JSON.parse(String(req.headers["x-connector-update"] ?? "null"));
      } catch {}
      const update = connectorUpdateFailureSchema.safeParse(failed);
      db.update(devices)
        .set({
          ...(info.success && info.data),
          updateFailed: update.success ? update.data : null,
          lastSeenAt: new Date().toISOString(),
        })
        .where(eq(devices.id, deviceId))
        .run();
      onConnect();
      const cursor = Number(req.headers["last-event-id"]);
      const mine = eq(hubEvents.deviceId, deviceId);

      const switches = db
        .select({
          worker: devices.sliceWorker,
          presets: devices.presetLibraries,
          share: devices.shareProjects,
        })
        .from(devices)
        .where(eq(devices.id, deviceId))
        .get();
      const presets = presetSwitches(switches?.presets ?? {});
      const any = (k: "send" | "install") => Object.values(presets).some((s) => s[k]);
      const owner = db
        .select({ name: users.displayName })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .where(eq(devices.id, deviceId))
        .get();
      const { libraries: sources, dirs } = await catalogs.connected(deviceId);
      const installs = await catalogs.connectedInstall(deviceId);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        // The user this device acts as, for the connector's status page (percent-encoded: headers are latin-1).
        ...(owner && { "x-device-user": encodeURIComponent(owner.name) }),
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
        // On every connect, so a connector that missed `device.worker` (an older one) knows it.
        "x-slice-worker": switches?.worker ? "1" : "0",
        // Per slicer library (ADR-0020). A connector before 5.4.0 Step 21's reads only the two
        // below, any library on; the device routes keep it to the libraries that are.
        "x-preset-libraries": JSON.stringify(presets),
        "x-share-presets": any("send") ? "1" : "0",
        "x-install-presets": any("install") ? "1" : "0",
        // The libraries it is the catalog source of (ADR-0020), with the hub copy's fingerprint.
        "x-catalog-sources": JSON.stringify(sources),
        // Where a managed install keeps that `system/` (5.5.0 Step 11c).
        "x-catalog-dirs": JSON.stringify(dirs ?? {}),
        // The libraries it receives the catalog of (ADR-0021), with the hub copy's fingerprint.
        "x-catalog-install": JSON.stringify(installs),
        // Share to the hub (ADR-0021); a connector before 5.5.0 shares its folders anyway.
        "x-share-projects": switches?.share === false ? "0" : "1",
        // Once the hub ends a stream (revoke, shutdown) the socket goes too, instead of idling in
        // keep-alive, which held up the server's close.
        connection: "close",
      });
      res.write(": open\n\n");
      // Synchronous from here to the registration (better-sqlite3), so no event falls in between.
      if (Number.isSafeInteger(cursor) && cursor > 0)
        db.delete(hubEvents)
          .where(and(mine, lte(hubEvents.seq, cursor)))
          .run();
      for (const e of db.select().from(hubEvents).where(mine).orderBy(asc(hubEvents.seq)).all())
        res.write(channel.frame(e.seq, e.data as HubEvent));

      const port = z.coerce
        .number()
        .int()
        .min(1)
        .max(65535)
        .safeParse(req.headers["x-connector-port"]);
      const detach = channel.attach(deviceId, {
        write: (f: string) => res.write(f),
        end: () => res.end(),
        port: port.success ? port.data : null,
      });
      let userName = owner?.name;
      const beat = setInterval(() => {
        const live = db
          .select({ disabled: users.disabled, name: users.displayName })
          .from(devices)
          .innerJoin(users, eq(users.id, devices.userId))
          .where(eq(devices.id, deviceId))
          .get();
        if (!live || live.disabled || !readPreferences(db).hubEnabled) return res.end();
        db.update(devices)
          .set({ lastSeenAt: new Date().toISOString() })
          .where(eq(devices.id, deviceId))
          .run();
        // Here, not in every route that can rename a user or change a device's.
        if (live.name !== userName) {
          userName = live.name;
          res.write(channel.frame(null, { type: "device.user", name: live.name }));
        }
        res.write(": hb\n\n");
      }, HUB_HEARTBEAT_MS);
      res.on("close", () => {
        clearInterval(beat);
        detach();
      });
    });

    /** A code for `userId`: to pair a new device, or with `deviceId` to change that device's user. */
    const makeCode = (userId: string, deviceId: string | null = null) => {
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw new HttpError(404, "not_found", "User not found");
      if (user.disabled) throw new HttpError(409, "user_disabled", "The user is disabled");
      const now = new Date();
      db.delete(pairingCodes).where(lte(pairingCodes.expiresAt, now.toISOString())).run();
      const code = newCode();
      const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
      db.insert(pairingCodes)
        .values({ id: codeHash(code), userId: user.id, deviceId, expiresAt })
        .run();
      return { code, expiresAt };
    };

    app.post(
      "/pairing-codes",
      {
        schema: {
          body: pairingCodeCreateSchema,
          response: { 201: pairingCodeSchema, ...errors },
        },
      },
      async (req, reply) => reply.status(201).send(makeCode(req.body.userId)),
    );

    // The connector's page has no login, so its user only changes with a code from here. Its latest
    // code is the only one that works.
    app.post(
      "/devices/:id/user-code",
      {
        schema: {
          params,
          body: pairingCodeCreateSchema,
          response: { 201: pairingCodeSchema, ...errors },
        },
      },
      async (req, reply) => {
        const { userId } = req.body;
        const device = db.select().from(devices).where(eq(devices.id, req.params.id)).get();
        if (!device) throw new HttpError(404, "not_found", "Device not found");
        if (device.userId === userId)
          throw new HttpError(409, "same_user", "The device already acts as this user");
        db.delete(pairingCodes).where(eq(pairingCodes.deviceId, device.id)).run();
        const made = makeCode(userId, device.id);
        req.log.info({ deviceId: device.id, userId }, "device user code created");
        return reply.status(201).send(made);
      },
    );

    // Same lock as logins: 5 wrong codes per IP (per device for a user change) lock it for 15 minutes.
    const limiter = loginLimiter();

    /**
     * The user a device's code changes it to, or null: wrong, used, expired or another device's (none
     * of which uses it up), or a user whose token the hub would refuse, which would end the pairing.
     */
    const codeTarget = (q: Pick<Db, "select">, code: string, deviceId: string) => {
      const found = q
        .select({ code: pairingCodes, user: users, role: roles })
        .from(pairingCodes)
        .innerJoin(users, eq(users.id, pairingCodes.userId))
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(eq(pairingCodes.id, codeHash(code)))
        .get();
      const usable =
        found?.code.deviceId === deviceId &&
        Date.parse(found.code.expiresAt) > Date.now() &&
        isEnabled(found);
      return usable ? found.user : null;
    };
    /** Runs a device's code attempt under the lock; a null answer is a wrong code. */
    const attempt = <T>(req: FastifyRequest, run: (deviceId: string) => T | null) => {
      const { deviceId } = req;
      if (!deviceId) throw new HttpError(403, "forbidden", "Only a paired device can call this");
      const key = `device:${deviceId}`;
      if (limiter.locked(key))
        throw new HttpError(429, "too_many_attempts", "Too many wrong codes, try again later");
      const answer = run(deviceId);
      if (answer === null) {
        limiter.fail(key);
        throw new HttpError(400, "invalid_code", "The code is wrong, used or expired");
      }
      limiter.clear(key);
      return answer;
    };
    const inFoldersOf = (deviceId: string) =>
      inArray(
        projects.rootId,
        db.select({ id: roots.id }).from(roots).where(eq(roots.location, deviceId)),
      );
    const codeErrors = { 400: apiErrorSchema, 403: apiErrorSchema, 429: apiErrorSchema };

    // What the connector's page asks before it confirms: who, and how many projects it's about.
    app.post(
      "/device/user/check",
      {
        schema: {
          body: deviceUserCheckSchema,
          response: { 200: deviceUserPreviewSchema, ...codeErrors },
        },
      },
      async (req) =>
        attempt(req, (deviceId) => {
          const user = codeTarget(db, req.body.code, deviceId);
          if (!user) return null;
          const found = db.select({ n: count() }).from(projects).where(inFoldersOf(deviceId)).get();
          return {
            userName: user.displayName,
            currentUserName: req.user?.displayName ?? "",
            projects: found?.n ?? 0,
          };
        }),
    );

    // Everything else about the device stays: its identity, token, roots and settings. Hub-root
    // projects aren't in its folders, so they never move.
    app.post(
      "/device/user",
      {
        schema: {
          body: deviceUserChangeSchema,
          response: { 200: deviceUserResultSchema, ...codeErrors },
        },
      },
      async (req) => {
        const { code, projects: choice } = req.body;
        return attempt(req, (deviceId) => {
          const result = db.transaction((tx) => {
            const user = codeTarget(tx, code, deviceId);
            if (!user) return null;
            tx.delete(pairingCodes)
              .where(eq(pairingCodes.id, codeHash(code)))
              .run();
            tx.update(devices).set({ userId: user.id }).where(eq(devices.id, deviceId)).run();
            const moved =
              choice === "move"
                ? tx.update(projects).set({ ownerId: user.id }).where(inFoldersOf(deviceId)).run()
                    .changes
                : 0;
            return { userName: user.displayName, toUserId: user.id, moved };
          });
          if (!result) return null;
          const { userName, toUserId, moved } = result;
          // What it syncs from the hub roots goes by its user's rights.
          channel.publish(deviceId, { type: "roots.changed" });
          req.log.info(
            { deviceId, fromUserId: req.user?.id, toUserId, projects: choice, moved },
            "device user changed",
          );
          return { userName, moved };
        });
      },
    );

    app.post(
      "/pair",
      {
        schema: {
          body: pairSchema,
          response: { 201: pairResultSchema, 401: apiErrorSchema, 429: apiErrorSchema },
        },
      },
      async (req, reply) => {
        const key = req.ip;
        if (limiter.locked(key))
          throw new HttpError(429, "too_many_attempts", "Too many wrong codes, try again later");
        const { code, ...device } = req.body;
        const token = randomBytes(32).toString("base64url");
        const id = codeHash(code);
        const receive = readPreferences(db).hubDefaultSyncMode;
        const row = db.transaction((tx) => {
          const found = tx.select().from(pairingCodes).where(eq(pairingCodes.id, id)).get();
          // A code to change a device's user never pairs a new one, and isn't used up trying.
          if (!found || found.deviceId) return null;
          tx.delete(pairingCodes).where(eq(pairingCodes.id, id)).run();
          const user = tx.select().from(users).where(eq(users.id, found.userId)).get();
          if (Date.parse(found.expiresAt) <= Date.now() || !user || user.disabled) return null;
          return tx
            .insert(devices)
            .values({ ...device, userId: user.id, tokenHash: tokenHash(token) })
            .returning({ id: devices.id, userId: devices.userId })
            .get();
        });
        if (!row) {
          limiter.fail(key);
          throw new HttpError(401, "invalid_code", "The pairing code is wrong, used or expired");
        }
        limiter.clear(key);
        // New machines receive every hub project folder, or nothing until picked (ADR-0021).
        if (receive === "all")
          for (const r of db
            .select({ id: roots.id })
            .from(roots)
            .where(eq(roots.location, ROOT_HUB))
            .all())
            ensurePick(db, row.id, r.id, "", "edit");
        req.log.info({ deviceId: row.id }, "device paired");
        return reply.status(201).send({ token, deviceId: row.id });
      },
    );
  };
