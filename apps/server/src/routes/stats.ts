import { statsQuerySchema, statsSchema } from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { readStats, statsCsv } from "../lib/stats.ts";

export const statsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/",
      { schema: { querystring: statsQuerySchema, response: { 200: statsSchema } } },
      async (req) => readStats(db, req.query),
    );

    app.get("/csv", { schema: { querystring: statsQuerySchema } }, async (req, reply) =>
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="stats.csv"')
        .send(statsCsv(readStats(db, req.query))),
    );
  };
