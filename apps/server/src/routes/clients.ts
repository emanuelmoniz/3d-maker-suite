import {
  apiErrorSchema,
  CLIENT_UNIQUE_FIELDS,
  type Client,
  clientFilters,
  clientInputSchema,
  clientPatchSchema,
  clientSchema,
  clientSortFields,
  listQuery,
  pageOf,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { listPage } from "../lib/list.ts";

const { clients } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

/** Runs a write; a clash with a unique index becomes a 409 `client_<field>_taken`. */
function unique<T>(write: () => T): T {
  try {
    return write();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const field = CLIENT_UNIQUE_FIELDS.find((f) => msg.startsWith("UNIQUE") && msg.includes(f));
    if (!field) throw e;
    throw new HttpError(409, `client_${field}_taken`, `Another client has this ${field}`);
  }
}

export const clientsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(clients).where(eq(clients.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Client not found");
      return row as Client;
    };

    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(clientSortFields, {}, clientFilters),
          response: { 200: pageOf(clientSchema) },
        },
      },
      async (req) =>
        listPage(db, clients, req.query, {
          sort: {
            name: clients.name,
            mobile: clients.mobile,
            vat: clients.vat,
            email: clients.email,
            createdAt: clients.createdAt,
          },
          dateColumn: clients.createdAt,
          filters: {
            name: clients.name,
            mobile: clients.mobile,
            vat: clients.vat,
            email: clients.email,
          },
        }) as { items: Client[]; page: number; pageSize: number; total: number },
    );

    app.post(
      "/",
      {
        schema: {
          body: clientInputSchema,
          response: { 201: clientSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) =>
        reply.status(201).send(unique(() => db.insert(clients).values(req.body).returning().get())),
    );

    app.get(
      "/:id",
      { schema: { params, response: { 200: clientSchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    app.patch(
      "/:id",
      {
        schema: {
          params,
          body: clientPatchSchema,
          response: { 200: clientSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        if (Object.keys(req.body).length)
          unique(() => db.update(clients).set(req.body).where(eq(clients.id, req.params.id)).run());
        return get(req.params.id);
      },
    );
  };
