import {
  ADMIN_EFFECTIVE,
  apiErrorSchema,
  BUILT_IN_ROLE_IDS,
  loginSchema,
  meSchema,
  meUpdateSchema,
  setupSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { hostname, isLoopback } from "../lib/access.ts";
import { hasUsers, isHttps, isLoopbackIp, loginLimiter, sameSecret } from "../lib/auth.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  endUserSessions,
  isEnabled,
  readCookie,
  SESSION_COOKIE,
  type SessionUser,
  sessionCookie,
  sessionUser,
} from "../lib/session.ts";

const { roles, users } = schema;
const errors = { 401: apiErrorSchema, 403: apiErrorSchema, 409: apiErrorSchema };
const wrongLogin = () => new HttpError(401, "invalid_credentials", "Wrong email or password");

/** `/me` and the login answers: no user = the no-users mode, with the Admin role's rights. */
const meOf = (user: SessionUser | undefined) =>
  user ? { user, role: user.role, ...user.rights } : { user: null, role: null, ...ADMIN_EFFECTIVE };

export const authRoutes =
  (
    db: Db,
    /** `APP_PASSWORD` is set; the access guard already checked it on this request. */
    passwordSet: boolean,
    setupToken?: string,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const limiter = loginLimiter();
    // Unknown emails still pay for one scrypt, so the timing doesn't tell which emails exist.
    const dummy = hashPassword("not a password");

    const startSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
      const { token, expiresAt } = createSession(db, userId);
      reply.header("set-cookie", sessionCookie(token, expiresAt, isHttps(req)));
      req.log = req.log.child({ actor: userId });
    };
    const me = (req: FastifyRequest) => {
      if (!req.user) throw new HttpError(401, "unauthorized", "Login required");
      return req.user;
    };

    app.post(
      "/setup",
      { schema: { body: setupSchema, response: { 201: meSchema, ...errors } } },
      async (req, reply) => {
        const done = () => new HttpError(409, "setup_done", "An admin already exists");
        if (hasUsers(db)) throw done();
        const { token, password, ...rest } = req.body;
        // "On this PC" needs a loopback socket AND a loopback Host: behind a reverse proxy the
        // socket is always loopback, but an allowed public Host means another device.
        const name = hostname(req.headers.host);
        const local = isLoopbackIp(req.ip) && !!name && isLoopback(name);
        const allowed =
          local || passwordSet || (!!setupToken && !!token && sameSecret(token, setupToken));
        if (!allowed) throw new HttpError(403, "setup_token", "Setup token required");
        const passwordHash = await hashPassword(password);
        const user = db.transaction((tx) => {
          if (tx.select({ id: users.id }).from(users).limit(1).get()) throw done();
          const row = tx
            .insert(users)
            .values({
              ...rest,
              passwordHash,
              roleId: BUILT_IN_ROLE_IDS.admin,
              lastLoginAt: new Date().toISOString(),
            })
            .returning()
            .get();
          const role = tx.select().from(roles).where(eq(roles.id, row.roleId)).get();
          if (!role) throw new Error("The Admin role is missing");
          return sessionUser(row, role);
        });
        startSession(req, reply, user.id);
        if (passwordSet) req.log.warn("First admin created: APP_PASSWORD is now ignored");
        return reply.status(201).send(meOf(user));
      },
    );

    app.post(
      "/login",
      {
        schema: { body: loginSchema, response: { 200: meSchema, ...errors, 429: apiErrorSchema } },
      },
      async (req, reply) => {
        const { email, password } = req.body;
        const key = `${email}|${req.ip}`;
        if (limiter.locked(key))
          throw new HttpError(429, "too_many_attempts", "Too many failed logins, try again later");
        const row = db
          .select({ user: users, role: roles })
          .from(users)
          .innerJoin(roles, eq(roles.id, users.roleId))
          .where(eq(users.email, email))
          .get();
        const ok = await verifyPassword(password, row?.user.passwordHash ?? (await dummy));
        if (!row || !ok) {
          limiter.fail(key);
          throw wrongLogin();
        }
        limiter.clear(key);
        // A disabled role counts like a disabled account (ADR-0016).
        if (!isEnabled(row)) throw new HttpError(403, "user_disabled", "This account is disabled");
        const lastLoginAt = new Date().toISOString();
        db.update(users).set({ lastLoginAt }).where(eq(users.id, row.user.id)).run();
        startSession(req, reply, row.user.id);
        return meOf(sessionUser({ ...row.user, lastLoginAt }, row.role));
      },
    );

    app.post("/logout", { schema: { response: { 204: z.null() } } }, async (req, reply) => {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (token) deleteSession(db, token);
      return reply
        .status(204)
        .header("set-cookie", clearSessionCookie(isHttps(req)))
        .send(null);
    });

    // No users: `user` is null and every page works as before.
    app.get("/me", { schema: { response: { 200: meSchema } } }, async (req) => meOf(req.user));

    app.patch(
      "/me",
      { schema: { body: meUpdateSchema, response: { 200: meSchema, ...errors } } },
      async (req, reply) => {
        const current = me(req);
        const { id } = current;
        const { displayName, currentPassword, password } = req.body;
        const row = db.select().from(users).where(eq(users.id, id)).get();
        if (!row) throw new HttpError(401, "unauthorized", "Login required");
        if (password) {
          if (!(await verifyPassword(currentPassword ?? "", row.passwordHash)))
            throw new HttpError(403, "wrong_password", "The current password is wrong");
          const passwordHash = await hashPassword(password);
          db.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
          // Other devices are logged out; this one gets a fresh session.
          endUserSessions(db, id);
          startSession(req, reply, id);
        }
        if (displayName) db.update(users).set({ displayName }).where(eq(users.id, id)).run();
        return meOf({ ...current, ...(displayName && { displayName }) });
      },
    );
  };
