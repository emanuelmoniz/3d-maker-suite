import {
  apiErrorSchema,
  archivedFilter,
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
import { archivedAtOf, archivedWhere } from "../lib/archive.ts";
import { unique } from "../lib/clients.ts";
import { listPage } from "../lib/list.ts";

const { clients, orders } = schema;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

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
          querystring: listQuery(clientSortFields, { archived: archivedFilter }, clientFilters),
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
          where: [archivedWhere(clients.archivedAt, req.query.archived)],
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
        const { archived, ...fields } = req.body;
        if (Object.keys(fields).length || archived !== undefined)
          unique(() =>
            db
              .update(clients)
              .set({ ...fields, archivedAt: archivedAtOf(archived) })
              .where(eq(clients.id, req.params.id))
              .run(),
          );
        return get(req.params.id);
      },
    );

    // Its quotes stay, without a client (FK set null). Orders block it.
    app.delete(
      "/:id",
      { schema: { params, response: { 204: z.null(), 409: apiErrorSchema, ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        if (
          db.select({ id: orders.id }).from(orders).where(eq(orders.clientId, req.params.id)).get()
        )
          throw new HttpError(409, "client_in_use", "This client has orders");
        db.delete(clients).where(eq(clients.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );
  };
