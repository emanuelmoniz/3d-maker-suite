import {
  apiErrorSchema,
  NO_RIGHTS,
  roleCreateSchema,
  rolePatchSchema,
  roleSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, count, eq, getTableColumns, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { assertWithin, changed } from "../lib/auth.ts";

const { roles, sessions, users } = schema;
const params = z.object({ id: z.uuid() });
const errors = { 403: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

const isUnique = (e: unknown) => String((e as Error).message).includes("UNIQUE");
const taken = () => new HttpError(409, "name_taken", "A role with this name exists");

// Roles (ADR-0016), users.manage only (lib/auth.ts). The Admin role is fixed.
export const rolesRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const list = () =>
      db
        .select({ ...getTableColumns(roles), usersCount: count(users.id) })
        .from(roles)
        .leftJoin(users, eq(users.roleId, roles.id))
        .groupBy(roles.id);
    const out = (id: string) => {
      const role = list().where(eq(roles.id, id)).get();
      if (!role) throw new HttpError(404, "not_found", "Role not found");
      return role;
    };
    const editable = (id: string) => {
      const role = out(id);
      if (role.builtIn === "admin")
        throw new HttpError(403, "role_builtin", "The Admin role can't be changed");
      return role;
    };

    app.get("/", { schema: { response: { 200: z.array(roleSchema) } } }, async () =>
      list().orderBy(asc(roles.name)).all(),
    );

    app.post(
      "/",
      { schema: { body: roleCreateSchema, response: { 201: roleSchema, ...errors } } },
      async (req, reply) => {
        const { permissions, projectRights, ...rest } = req.body;
        assertWithin(req.user, { permissions, projectRights });
        try {
          const { id } = db
            .insert(roles)
            .values({
              ...rest,
              permissions: { ...NO_RIGHTS.permissions, ...permissions },
              projectRights: { ...NO_RIGHTS.projectRights, ...projectRights },
            })
            .returning()
            .get();
          return reply.status(201).send(out(id));
        } catch (e) {
          throw isUnique(e) ? taken() : e;
        }
      },
    );

    app.patch(
      "/:id",
      { schema: { params, body: rolePatchSchema, response: { 200: roleSchema, ...errors } } },
      async (req) => {
        const role = editable(req.params.id);
        const permissions = changed(req.body.permissions, role.permissions);
        const projectRights = changed(req.body.projectRights, role.projectRights);
        assertWithin(req.user, { permissions, projectRights });
        try {
          db.transaction((tx) => {
            tx.update(roles)
              .set({
                ...req.body,
                permissions: { ...role.permissions, ...permissions },
                projectRights: { ...role.projectRights, ...projectRights },
                // No escalation check: a kind's permission gates it anyway.
                alertKinds: { ...role.alertKinds, ...req.body.alertKinds },
              })
              .where(eq(roles.id, role.id))
              .run();
            // Like disabling each of its users (ADR-0016). Rights changes need no logout.
            if (req.body.disabled === true)
              tx.delete(sessions)
                .where(
                  inArray(
                    sessions.userId,
                    tx.select({ id: users.id }).from(users).where(eq(users.roleId, role.id)),
                  ),
                )
                .run();
          });
        } catch (e) {
          throw isUnique(e) ? taken() : e;
        }
        return out(role.id);
      },
    );

    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const role = editable(req.params.id);
        if (role.usersCount)
          throw new HttpError(409, "role_in_use", "Move this role's users to another role first");
        db.delete(roles).where(eq(roles.id, role.id)).run();
        return reply.status(204).send(null);
      },
    );
  };
