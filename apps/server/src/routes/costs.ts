import {
  apiErrorSchema,
  costContextSchema,
  listQuery,
  type Page,
  pageOf,
  type Quote,
  quoteFilters,
  quoteInputSchema,
  quotePatchSchema,
  quoteSchema,
  quoteSortFields,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { projectLabel } from "../lib/catalog.ts";
import { costContext } from "../lib/cost.ts";
import { listPage } from "../lib/list.ts";
import { assertNumberFree, nextNumber } from "../lib/numbers.ts";

const { quotes, projects, clients } = schema;
/** "001-Vase", the same as the web's `quoteName`. */
const quoteLabel = sql<string>`printf('%03d', ${quotes.number}) || '-' || ${quotes.name}`;
const params = z.object({ id: z.uuid() });
const notFound = { 404: apiErrorSchema };

export const costsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const get = (id: string) => {
      const row = db.select().from(quotes).where(eq(quotes.id, id)).get();
      if (!row) throw new HttpError(404, "not_found", "Quote not found");
      return row as Quote;
    };
    const checkProject = (projectId?: string | null) => {
      if (projectId && !db.select().from(projects).where(eq(projects.id, projectId)).get())
        throw new HttpError(400, "invalid_project", "Project not found");
    };
    const checkClient = (clientId?: string | null) => {
      if (clientId && !db.select().from(clients).where(eq(clients.id, clientId)).get())
        throw new HttpError(400, "invalid_client", "Client not found");
    };

    app.get("/context", { schema: { response: { 200: costContextSchema } } }, async () =>
      costContext(db),
    );

    app.get(
      "/quotes",
      {
        schema: {
          querystring: listQuery(quoteSortFields, {}, quoteFilters),
          response: { 200: pageOf(quoteSchema) },
        },
      },
      async (req) =>
        listPage(db, quotes, req.query, {
          sort: {
            // The name starts with the number: sorting by it sorts the name as shown.
            name: quotes.number,
            client: sql`(SELECT ${clients.name} FROM ${clients} WHERE ${clients.id} = ${quotes.clientId})`,
            project: sql`(SELECT ${projectLabel} FROM ${projects} WHERE ${projects.id} = ${quotes.projectId})`,
            quantity: sql`json_extract(${quotes.quote}, '$.quantity')`,
            total: sql`json_extract(${quotes.quote}, '$.total')`,
            createdAt: quotes.createdAt,
          },
          defaultSort: "-name",
          filters: {
            name: quoteLabel,
            clientId: quotes.clientId,
            projectId: quotes.projectId,
            createdAt: quotes.createdAt,
          },
        }) as Page<Quote>,
    );

    app.post(
      "/quotes",
      {
        schema: {
          body: quoteInputSchema,
          response: { 201: quoteSchema, 400: apiErrorSchema, 409: apiErrorSchema },
        },
      },
      async (req, reply) => {
        checkProject(req.body.projectId);
        checkClient(req.body.clientId);
        assertNumberFree(db, quotes, "quote", req.body.number);
        const { id } = db
          .insert(quotes)
          .values({ ...req.body, number: req.body.number ?? nextNumber(quotes) })
          .returning()
          .get();
        return reply.status(201).send(get(id));
      },
    );

    app.get(
      "/quotes/:id",
      { schema: { params, response: { 200: quoteSchema, ...notFound } } },
      async (req) => get(req.params.id),
    );

    app.patch(
      "/quotes/:id",
      {
        schema: {
          params,
          body: quotePatchSchema,
          response: { 200: quoteSchema, 400: apiErrorSchema, 409: apiErrorSchema, ...notFound },
        },
      },
      async (req) => {
        get(req.params.id);
        checkProject(req.body.projectId);
        checkClient(req.body.clientId);
        assertNumberFree(db, quotes, "quote", req.body.number, req.params.id);
        if (Object.keys(req.body).length)
          db.update(quotes).set(req.body).where(eq(quotes.id, req.params.id)).run();
        return get(req.params.id);
      },
    );

    app.delete(
      "/quotes/:id",
      { schema: { params, response: { 204: z.null(), ...notFound } } },
      async (req, reply) => {
        get(req.params.id);
        db.delete(quotes).where(eq(quotes.id, req.params.id)).run();
        return reply.status(204).send(null);
      },
    );
  };
