import {
  apiErrorSchema,
  listQuery,
  type Page,
  pageOf,
  type Setting,
  settingSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { listPage } from "../lib/list.ts";

const { settings } = schema;
const params = z.object({ key: z.string().min(1) });
const notFound = { 404: apiErrorSchema };

// Sample CRUD route; also the reference for how list endpoints use the shared helpers.
export const settingsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (key: string) => {
      const row = db.select().from(settings).where(eq(settings.key, key)).get();
      if (!row) throw new HttpError(404, "not_found", `Setting "${key}" not found`);
      return row as Setting;
    };

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(["key"]),
          response: { 200: pageOf(settingSchema) },
        },
      },
      async (req) =>
        listPage(db, settings, req.query, { sort: { key: settings.key } }) as Page<Setting>,
    );

    app.get(
      "/:key",
      { schema: { params, response: { 200: settingSchema, ...notFound } } },
      async (req) => get(req.params.key),
    );

    app.put(
      "/:key",
      {
        schema: { params, body: z.object({ value: z.json() }), response: { 200: settingSchema } },
      },
      async (req) =>
        db
          .insert(settings)
          .values({ key: req.params.key, value: req.body.value })
          .onConflictDoUpdate({ target: settings.key, set: { value: req.body.value } })
          .returning()
          .get() as Setting,
    );

    app.delete(
      "/:key",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.key);
        db.delete(settings).where(eq(settings.key, req.params.key)).run();
        return reply.status(204).send(null);
      },
    );
  };
