import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  apiErrorSchema,
  ROOT_DEFAULTS,
  ROOT_HUB,
  rootInputSchema,
  rootPatchSchema,
  rootSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, max } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { listRoots } from "../projects/rootFs.ts";

const { projects, roots } = schema;
const params = z.object({ id: z.uuid() });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

/** The project roots (ADR-0014). Everyone reads them (pickers); only admins change them. */
export const rootsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(roots).where(eq(roots.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Root not found");
      return row;
    };

    app.get("/", { schema: { response: { 200: z.array(rootSchema) } } }, async () => listRoots(db));

    app.post(
      "/",
      { schema: { body: rootInputSchema, response: { 201: rootSchema, ...errors } } },
      async (req, reply) => {
        const { path, name, ...settings } = req.body;
        const dir = isAbsolute(path) && (await stat(path).catch(() => null))?.isDirectory();
        if (!dir) throw new HttpError(400, "invalid_folder", "Folder not found");
        if (db.select().from(roots).where(eq(roots.path, path)).get())
          throw new HttpError(409, "root_exists", "This folder is a project root already");
        const last = db
          .select({ n: max(roots.position) })
          .from(roots)
          .get()?.n;
        const row = db
          .insert(roots)
          .values({
            ...ROOT_DEFAULTS,
            ...settings,
            name: name ?? (basename(path) || path),
            location: ROOT_HUB,
            path,
            position: (last ?? -1) + 1,
          })
          .returning()
          .get();
        return reply.status(201).send(row);
      },
    );

    app.patch(
      "/:id",
      { schema: { params, body: rootPatchSchema, response: { 200: rootSchema, ...errors } } },
      async (req) => {
        const row = get(req.params.id);
        if (!Object.keys(req.body).length) return row;
        return db.update(roots).set(req.body).where(eq(roots.id, req.params.id)).returning().get();
      },
    );

    // Projects point at their root: one still in use stays (its projects would lose their folder).
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), ...errors } } },
      async (req, reply) => {
        const { id } = get(req.params.id);
        if (db.select({ id: projects.id }).from(projects).where(eq(projects.rootId, id)).get())
          throw new HttpError(409, "root_in_use", "Projects still use this folder");
        db.delete(roots).where(eq(roots.id, id)).run();
        return reply.status(204).send(null);
      },
    );
  };
