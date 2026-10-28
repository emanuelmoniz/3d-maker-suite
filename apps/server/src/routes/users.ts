import {
  apiErrorSchema,
  userCreateSchema,
  userPatchSchema,
  userSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { hashPassword } from "../lib/password.ts";
import { endUserSessions } from "../lib/session.ts";

const { users } = schema;
const params = z.object({ id: z.uuid() });
const errors = { 404: apiErrorSchema, 409: apiErrorSchema };

const isUnique = (e: unknown) => String((e as Error).message).includes("UNIQUE");
const taken = () => new HttpError(409, "email_taken", "A user with this email exists");
const lastAdmin = () =>
  new HttpError(409, "last_admin", "The last enabled admin can't be disabled, demoted or deleted");

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const enabledAdmins = (tx: Tx) =>
  tx
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.disabled, false)))
    .get()?.n ?? 0;
const get = (tx: Tx, id: string) => {
  const row = tx.select().from(users).where(eq(users.id, id)).get();
  if (!row) throw new HttpError(404, "not_found", "User not found");
  return row;
};

// Admin only (lib/auth.ts). Hashes never leave: userSchema has no such field.
// ponytail: unpaginated, a household has a handful of users.
export const usersRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/", { schema: { response: { 200: z.array(userSchema) } } }, async () =>
      db.select().from(users).orderBy(asc(users.displayName)).all(),
    );

    app.post(
      "/",
      { schema: { body: userCreateSchema, response: { 201: userSchema, ...errors } } },
      async (req, reply) => {
        const { password, ...rest } = req.body;
        const passwordHash = await hashPassword(password);
        try {
          return reply.status(201).send(
            db
              .insert(users)
              // Admins edit other devices' files unless told otherwise; editors only when allowed.
              .values({ editOtherDevices: rest.role === "admin", ...rest, passwordHash })
              .returning()
              .get(),
          );
        } catch (e) {
          throw isUnique(e) ? taken() : e;
        }
      },
    );

    app.patch(
      "/:id",
      { schema: { params, body: userPatchSchema, response: { 200: userSchema, ...errors } } },
      async (req) => {
        const { password, ...rest } = req.body;
        const passwordHash = password ? await hashPassword(password) : undefined;
        try {
          return db.transaction((tx) => {
            const row = get(tx, req.params.id);
            const roleChanged = !!rest.role && rest.role !== row.role;
            const demoted = roleChanged || rest.disabled === true;
            if (row.role === "admin" && !row.disabled && demoted && enabledAdmins(tx) <= 1)
              throw lastAdmin();
            const values = { ...rest, ...(passwordHash && { passwordHash }) };
            if (!Object.keys(values).length) return row;
            const user = tx.update(users).set(values).where(eq(users.id, row.id)).returning().get();
            // Same connection, so this is inside the transaction.
            if (demoted || passwordHash) endUserSessions(db, row.id);
            return user;
          });
        } catch (e) {
          throw isUnique(e) ? taken() : e;
        }
      },
    );

    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        db.transaction((tx) => {
          const row = get(tx, req.params.id);
          if (row.role === "admin" && !row.disabled && enabledAdmins(tx) <= 1) throw lastAdmin();
          tx.delete(users).where(eq(users.id, row.id)).run();
        });
        return reply.status(204).send(null);
      },
    );
  };
