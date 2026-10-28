import { randomBytes } from "node:crypto";
import {
  apiErrorSchema,
  deviceRenameSchema,
  deviceSchema,
  pairingCodeCreateSchema,
  pairingCodeSchema,
  pairResultSchema,
  pairSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, eq, lte } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { loginLimiter } from "../lib/auth.ts";
import { readPreferences } from "../lib/preferences.ts";
import { tokenHash } from "../lib/session.ts";

const { devices, pairingCodes, users } = schema;
const params = z.object({ id: z.uuid() });
const errors = { 404: apiErrorSchema, 409: apiErrorSchema };

const CODE_TTL_MS = 10 * 60_000;
const ONLINE_MS = 60_000;
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
 * public: the connector has only the code. With the hub off, none of it exists.
 */
export const hubRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("onRequest", async () => {
      if (!readPreferences(db).hubEnabled) throw new HttpError(404, "hub_off", "The hub is off");
    });

    // ponytail: unpaginated, a hub has a handful of devices.
    app.get("/devices", { schema: { response: { 200: z.array(deviceSchema) } } }, async () => {
      const since = Date.now() - ONLINE_MS;
      return db
        .select({
          id: devices.id,
          name: devices.name,
          userId: devices.userId,
          userName: users.displayName,
          os: devices.os,
          connectorVersion: devices.connectorVersion,
          lastSeenAt: devices.lastSeenAt,
          createdAt: devices.createdAt,
        })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .orderBy(asc(devices.name))
        .all()
        .map((d) => ({ ...d, online: !!d.lastSeenAt && Date.parse(d.lastSeenAt) > since }));
    });

    app.patch(
      "/devices/:id",
      { schema: { params, body: deviceRenameSchema, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const row = db
          .update(devices)
          .set({ name: req.body.name })
          .where(eq(devices.id, req.params.id))
          .returning({ id: devices.id })
          .get();
        if (!row) throw new HttpError(404, "not_found", "Device not found");
        return reply.status(204).send(null);
      },
    );

    // Revoke: the token stops working on its next request.
    app.delete(
      "/devices/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const gone = db.delete(devices).where(eq(devices.id, req.params.id)).run().changes;
        if (!gone) throw new HttpError(404, "not_found", "Device not found");
        req.log.info({ deviceId: req.params.id }, "device revoked");
        return reply.status(204).send(null);
      },
    );

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
