import {
  apiErrorSchema,
  costContextSchema,
  type Quote,
  quoteInputSchema,
  quoteSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import { costContext } from "../lib/cost.ts";

const { quotes, projects } = schema;
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

    app.get("/context", { schema: { response: { 200: costContextSchema } } }, async () =>
      costContext(db),
    );

    // ponytail: unpaginated, quotes are few. Paginate if anyone saves thousands.
    app.get(
      "/quotes",
      {
        schema: {
          querystring: z.object({ projectId: z.uuid().optional() }),
          response: { 200: z.array(quoteSchema) },
        },
      },
      async (req) =>
        db
          .select()
          .from(quotes)
          .where(req.query.projectId ? eq(quotes.projectId, req.query.projectId) : undefined)
          .orderBy(desc(quotes.createdAt))
          .all() as Quote[],
    );

    app.post(
      "/quotes",
      { schema: { body: quoteInputSchema, response: { 201: quoteSchema } } },
      async (req, reply) => {
        checkProject(req.body.projectId);
        return reply
          .status(201)
          .send(db.insert(quotes).values(req.body).returning().get() as Quote);
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
