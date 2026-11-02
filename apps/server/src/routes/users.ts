import {
  apiErrorSchema,
  deliveryInputSchema,
  deliverySchema,
  userCreateSchema,
  userPatchSchema,
  userSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { deliveryView, writeDelivery } from "../alerts/channels.ts";
import { HttpError } from "../errors.ts";
import { assertWithin } from "../lib/auth.ts";
import { hashPassword } from "../lib/password.ts";
import { endUserSessions, type SessionUser } from "../lib/session.ts";

const { roles, users } = schema;
const params = z.object({ id: z.uuid() });
const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
};

const isUnique = (e: unknown) => String((e as Error).message).includes("UNIQUE");
const taken = () => new HttpError(409, "email_taken", "A user with this email exists");
const lastAdmin = () =>
  new HttpError(409, "last_admin", "The last enabled admin can't be disabled, demoted or deleted");

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Role = typeof roles.$inferSelect;
type Body = z.infer<typeof userPatchSchema>;

const enabledAdmins = (tx: Tx) =>
  tx
    .select({ n: count() })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.builtIn, "admin"), eq(users.disabled, false)))
    .get()?.n ?? 0;
const get = (tx: Tx, id: string) => {
  const row = tx.select().from(users).where(eq(users.id, id)).get();
  if (!row) throw new HttpError(404, "not_found", "User not found");
  return row;
};
const roleOf = (tx: Tx, id: string) => {
  const role = tx.select().from(roles).where(eq(roles.id, id)).get();
  if (!role) throw new HttpError(400, "invalid_reference", "Role not found");
  return role;
};
const isAdmin = (role: Role) => role.builtIn === "admin";

/**
 * What new overrides change, as the values the user ends up with: a dropped override counts as
 * the role's value (dropping a deny is a grant). Unchanged keys are left out.
 */
function changedOverrides<T extends object>(
  next: Partial<T> | undefined,
  prev: Partial<T>,
  role: T,
) {
  if (!next) return undefined;
  const keys = new Set([...Object.keys(next), ...Object.keys(prev)] as (keyof T)[]);
  return Object.fromEntries(
    [...keys].filter((k) => next[k] !== prev[k]).map((k) => [k, next[k] ?? role[k]]),
  ) as Partial<T>;
}

/**
 * ADR-0016 rules on one account change: only the Admin role touches Admin-role users or moves
 * anyone into or out of it; an Admin-role user takes only the `editOtherDevices` override; a
 * manager picks no role and sets no override above their own rights.
 */
function assertChange(
  caller: SessionUser | undefined,
  from: Role | null,
  to: Role,
  overrides: Pick<Body, "permissions" | "projectRights">,
) {
  if (caller && !caller.rights.admin && (isAdmin(to) || (from && isAdmin(from))))
    throw new HttpError(403, "admin_only", "Only admins change admin accounts");
  const { permissions = {}, projectRights = {} } = overrides;
  if (
    isAdmin(to) &&
    (Object.keys(permissions).length ||
      Object.keys(projectRights).some((k) => k !== "projects.editOtherDevices"))
  )
    throw new HttpError(400, "admin_overrides", "Admins take only the device files override");
  if (from?.id !== to.id) assertWithin(caller, to);
  assertWithin(caller, overrides);
}

// users.manage only (lib/auth.ts). Hashes never leave: userSchema has no such field.
// ponytail: unpaginated, a household has a handful of users.
export const usersRoutes =
  (
    db: Db,
    key: Buffer,
    /** Before a user is deleted (their devices go with them): their locks are released. */
    onDelete: (userId: string) => void = () => {},
  ): FastifyPluginAsyncZod =>
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
          const user = db.transaction((tx) => {
            assertChange(req.user, null, roleOf(tx, rest.roleId), rest);
            return tx
              .insert(users)
              .values({ ...rest, passwordHash })
              .returning()
              .get();
          });
          return reply.status(201).send(user);
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
            const from = roleOf(tx, row.roleId);
            const to = rest.roleId ? roleOf(tx, rest.roleId) : from;
            // Only what actually changes counts, so a form may send every field back.
            const permissions = changedOverrides(rest.permissions, row.permissions, to.permissions);
            const projectRights = changedOverrides(
              rest.projectRights,
              row.projectRights,
              to.projectRights,
            );
            const disabling = rest.disabled !== undefined && rest.disabled !== row.disabled;
            const own =
              to.id !== from.id ||
              disabling ||
              Object.keys(permissions ?? {}).length ||
              Object.keys(projectRights ?? {}).length;
            if (req.user?.id === row.id && own)
              throw new HttpError(
                403,
                "own_account",
                "You can't change your own role, rights or state",
              );
            assertChange(req.user, from, to, { permissions, projectRights });
            const demoted = (to.id !== from.id && !isAdmin(to)) || rest.disabled === true;
            if (isAdmin(from) && !row.disabled && demoted && enabledAdmins(tx) <= 1)
              throw lastAdmin();
            const values = { ...rest, ...(passwordHash && { passwordHash }) };
            if (!Object.keys(values).length) return row;
            const user = tx.update(users).set(values).where(eq(users.id, row.id)).returning().get();
            // Rights are read per request (ADR-0016); only a disable or a reset logs out.
            // Same connection, so this is inside the transaction.
            if (rest.disabled === true || passwordHash) endUserSessions(db, row.id);
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
          const role = roleOf(tx, row.roleId);
          if (isAdmin(role) && req.user && !req.user.rights.admin)
            throw new HttpError(403, "admin_only", "Only admins change admin accounts");
          if (isAdmin(role) && !row.disabled && enabledAdmins(tx) <= 1) throw lastAdmin();
          // Same connection, so this is inside the transaction.
          onDelete(row.id);
          tx.delete(users).where(eq(users.id, row.id)).run();
        });
        return reply.status(204).send(null);
      },
    );

    // Someone's notify destinations (ADR-0016); an Admin-role user's only by an admin.
    const deliveryOf = (caller: SessionUser | undefined, id: string) =>
      db.transaction((tx) => {
        const row = get(tx, id);
        if (caller && !caller.rights.admin && isAdmin(roleOf(tx, row.roleId)))
          throw new HttpError(403, "admin_only", "Only admins change admin accounts");
        return row;
      });
    app.get(
      "/:id/delivery",
      { schema: { params, response: { 200: deliverySchema, ...errors } } },
      async (req) => deliveryView(deliveryOf(req.user, req.params.id).delivery),
    );
    app.patch(
      "/:id/delivery",
      {
        schema: { params, body: deliveryInputSchema, response: { 200: deliverySchema, ...errors } },
      },
      async (req) => writeDelivery(db, key, deliveryOf(req.user, req.params.id), req.body),
    );
  };
