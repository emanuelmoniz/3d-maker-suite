import { randomBytes } from "node:crypto";
import {
  apiErrorSchema,
  type CatalogSources,
  connectorInfoSchema,
  connectorSettingsPatchSchema,
  connectorSettingsResultSchema,
  connectorSettingsSchema,
  connectorUpdateFailureSchema,
  deviceSchema,
  deviceUpdateSchema,
  deviceUserChangeSchema,
  deviceUserCheckSchema,
  deviceUserPreviewSchema,
  deviceUserResultSchema,
  HUB_HEARTBEAT_MS,
  type HubEvent,
  type HubVersionsUsage,
  hubVersionsUsageSchema,
  pairingCodeCreateSchema,
  pairingCodeSchema,
  pairResultSchema,
  pairSchema,
  presetSwitches,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq, inArray, lte } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { loginLimiter } from "../lib/auth.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import { isEnabled, tokenHash } from "../lib/session.ts";
import { VERSION } from "../updates/updates.ts";

const { deviceProjects, devices, hubEvents, pairingCodes, projects, roles, roots, users } = schema;
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

/**
 * Hub management and pairing (ADR-0014). Admin only (lib/auth.ts), except `POST /pair`, which is
 * public: the connector has only the code, and `GET /events` and `/device/user`, which any paired
 * device may use. With the hub off, none of it exists.
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
    /** On connect: the libraries the device is the catalog source of (`DeviceCatalog.connected`). */
    catalogSources: (deviceId: string) => Promise<CatalogSources> = async () => ({}),
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("onRequest", async () => {
      if (!readPreferences(db).hubEnabled) throw new HttpError(404, "hub_off", "The hub is off");
    });

    app.get("/versions", { schema: { response: { 200: hubVersionsUsageSchema } } }, async () =>
      versionsUsage(),
    );

    // ponytail: unpaginated, a hub has a handful of devices.
    app.get("/devices", { schema: { response: { 200: z.array(deviceSchema) } } }, async () =>
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
          syncMode: devices.syncMode,
          slicers: devices.slicers,
          sliceWorker: devices.sliceWorker,
          presets: devices.presetLibraries,
          lastSeenAt: devices.lastSeenAt,
          createdAt: devices.createdAt,
        })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .orderBy(asc(devices.name))
        .all()
        .map((d) => {
          const outdated = !!d.connectorVersion && d.connectorVersion !== VERSION;
          return {
            ...d,
            online: channel.online(d.id),
            outdated,
            updateFailed: outdated ? d.updateFailed : null,
            projects: db
              .select({ id: projects.id, name: projects.name })
              .from(deviceProjects)
              .innerJoin(projects, eq(projects.id, deviceProjects.projectId))
              .where(eq(deviceProjects.deviceId, d.id))
              .orderBy(asc(projects.name))
              .all(),
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

    // Edit connector: live requests (409 offline, 504 no answer), never queued for a reconnect.
    // ENOTSUP: a connector older than this request, which updates itself to the hub's version.
    const failed = (err: NodeJS.ErrnoException) =>
      err.code === "ENOTSUP"
        ? new HttpError(409, "device_outdated", "The connector is too old for this")
        : new HttpError(502, "device_failed", "The connector couldn't do that");
    const known = (id: string) => {
      if (!db.select({ id: devices.id }).from(devices).where(eq(devices.id, id)).get())
        throw new HttpError(404, "not_found", "Device not found");
    };
    const settingsErrors = { ...errors, 502: apiErrorSchema, 504: apiErrorSchema };

    app.get(
      "/devices/:id/settings",
      { schema: { params, response: { 200: connectorSettingsSchema, ...settingsErrors } } },
      async (req) => {
        known(req.params.id);
        return channel.ask(
          req.params.id,
          (requestId) => ({ type: "connector.settings.get", requestId }),
          connectorSettingsSchema,
          { error: failed },
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
        known(req.params.id);
        return channel.ask(
          req.params.id,
          (requestId) => ({ type: "connector.settings.set", requestId, ...req.body }),
          connectorSettingsResultSchema,
          { error: failed },
        );
      },
    );

    app.post(
      "/devices/:id/restart",
      { schema: { params, response: { 204: z.null(), ...settingsErrors } } },
      async (req, reply) => {
        known(req.params.id);
        await channel.ask(
          req.params.id,
          (requestId) => ({ type: "connector.restart", requestId }),
          z.null(),
          { error: failed },
        );
        return reply.status(204).send(null);
      },
    );

    // A new sync mode makes the connector sync again from scratch (`roots.changed`).
    app.patch(
      "/devices/:id",
      { schema: { params, body: deviceUpdateSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const { name, syncMode } = req.body;
        const row = db.select().from(devices).where(eq(devices.id, req.params.id)).get();
        if (!row) throw new HttpError(404, "not_found", "Device not found");
        if (Object.keys(req.body).length)
          db.update(devices).set(req.body).where(eq(devices.id, row.id)).run();
        if (name !== undefined && name !== row.name)
          channel.publish(row.id, { type: "device.renamed", name });
        if (syncMode !== undefined && syncMode !== row.syncMode)
          channel.publish(row.id, { type: "roots.changed" });
        return reply.status(204).send(null);
      },
    );

    // The project's local copy goes; that's not a delete on the hub.
    app.delete(
      "/devices/:id/projects/:projectId",
      {
        schema: {
          params: params.extend({ projectId: z.uuid() }),
          response: { 204: z.null(), ...errors },
        },
      },
      async (req, reply) => {
        const { id, projectId } = req.params;
        const gone = db
          .delete(deviceProjects)
          .where(and(eq(deviceProjects.deviceId, id), eq(deviceProjects.projectId, projectId)))
          .run().changes;
        if (!gone) throw new HttpError(404, "not_found", "Project not selected on this device");
        channel.publish(id, { type: "roots.changed" });
        return reply.status(204).send(null);
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
        .select({ worker: devices.sliceWorker, presets: devices.presetLibraries })
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
      const sources = await catalogSources(deviceId);
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
        const syncMode = readPreferences(db).hubDefaultSyncMode;
        const row = db.transaction((tx) => {
          const found = tx.select().from(pairingCodes).where(eq(pairingCodes.id, id)).get();
          // A code to change a device's user never pairs a new one, and isn't used up trying.
          if (!found || found.deviceId) return null;
          tx.delete(pairingCodes).where(eq(pairingCodes.id, id)).run();
          const user = tx.select().from(users).where(eq(users.id, found.userId)).get();
          if (Date.parse(found.expiresAt) <= Date.now() || !user || user.disabled) return null;
          return tx
            .insert(devices)
            .values({ ...device, syncMode, userId: user.id, tokenHash: tokenHash(token) })
            .returning({ id: devices.id })
            .get();
        });
        if (!row) {
          limiter.fail(key);
          throw new HttpError(401, "invalid_code", "The pairing code is wrong, used or expired");
        }
        limiter.clear(key);
        req.log.info({ deviceId: row.id }, "device paired");
        return reply.status(201).send({ token, deviceId: row.id });
      },
    );
  };
