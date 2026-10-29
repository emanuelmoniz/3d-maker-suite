import { randomBytes } from "node:crypto";
import {
  apiErrorSchema,
  connectorInfoSchema,
  connectorUpdateFailureSchema,
  deviceSchema,
  deviceUpdateSchema,
  HUB_HEARTBEAT_MS,
  type HubEvent,
  type HubVersionsUsage,
  hubVersionsUsageSchema,
  pairingCodeCreateSchema,
  pairingCodeSchema,
  pairResultSchema,
  pairSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, eq, lte } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { loginLimiter } from "../lib/auth.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { readPreferences } from "../lib/preferences.ts";
import { tokenHash } from "../lib/session.ts";
import { VERSION } from "../updates/updates.ts";

const { deviceProjects, devices, hubEvents, pairingCodes, projects, users } = schema;
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
 * public: the connector has only the code, and `GET /events`, which any paired device may hold. With
 * the hub off, none of it exists.
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
      const info = connectorInfoSchema.safeParse({
        connectorVersion: req.headers["x-connector-version"],
        os: req.headers["x-connector-os"],
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

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
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
      const beat = setInterval(() => {
        const live = db
          .select({ disabled: users.disabled })
          .from(devices)
          .innerJoin(users, eq(users.id, devices.userId))
          .where(eq(devices.id, deviceId))
          .get();
        if (!live || live.disabled || !readPreferences(db).hubEnabled) return res.end();
        db.update(devices)
          .set({ lastSeenAt: new Date().toISOString() })
          .where(eq(devices.id, deviceId))
          .run();
        res.write(": hb\n\n");
      }, HUB_HEARTBEAT_MS);
      res.on("close", () => {
        clearInterval(beat);
        detach();
      });
    });

    app.post(
      "/pairing-codes",
      {
        schema: {
          body: pairingCodeCreateSchema,
          response: { 201: pairingCodeSchema, ...errors },
        },
      },
      async (req, reply) => {
        const user = db.select().from(users).where(eq(users.id, req.body.userId)).get();
        if (!user) throw new HttpError(404, "not_found", "User not found");
        if (user.disabled) throw new HttpError(409, "user_disabled", "The user is disabled");
        const now = new Date();
        db.delete(pairingCodes).where(lte(pairingCodes.expiresAt, now.toISOString())).run();
        const code = newCode();
        const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
        db.insert(pairingCodes)
          .values({ id: codeHash(code), userId: user.id, expiresAt })
          .run();
        return reply.status(201).send({ code, expiresAt });
      },
    );

    // Same lock as logins: 5 wrong codes per IP lock it for 15 minutes.
    const limiter = loginLimiter();
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
        const row = db.transaction((tx) => {
          const found = tx.select().from(pairingCodes).where(eq(pairingCodes.id, id)).get();
          if (!found) return null;
          tx.delete(pairingCodes).where(eq(pairingCodes.id, id)).run();
          const user = tx.select().from(users).where(eq(users.id, found.userId)).get();
          if (Date.parse(found.expiresAt) <= Date.now() || !user || user.disabled) return null;
          return tx
            .insert(devices)
            .values({ ...device, userId: user.id, tokenHash: tokenHash(token) })
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
