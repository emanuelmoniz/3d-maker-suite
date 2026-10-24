import {
  LOG_LEVELS,
  listQuery,
  logEntrySchema,
  logFilters,
  logSortFields,
  pageOf,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { listPage } from "../lib/list.ts";

const { logs, users } = schema;

/** The user's name while the account exists, else the id the line was written with. */
const actorName = sql<
  string | null
>`coalesce((select ${users.displayName} from ${users} where ${users.id} = ${logs.actor}), ${logs.actor})`;

/** Sorts by severity, not by name. */
const severity = sql.raw(
  `CASE level ${LOG_LEVELS.map((l, i) => `WHEN '${l}' THEN ${i}`).join(" ")} END`,
);

export const logsRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/",
      {
        schema: {
          querystring: listQuery(logSortFields, {}, logFilters),
          response: { 200: pageOf(logEntrySchema) },
        },
      },
      async (req) => {
        return listPage(db, logs, req.query, {
          // Lines are inserted as they happen: id is time order, without same-millisecond ties.
          select: {
            id: logs.id,
            time: logs.time,
            level: logs.level,
            module: logs.module,
            actor: actorName,
            message: logs.message,
            detail: logs.detail,
          },
          sort: {
            time: logs.id,
            level: severity,
            module: logs.module,
            actor: actorName,
            message: logs.message,
          },
          defaultSort: "-time",
          dateColumn: logs.time,
          filters: {
            time: logs.time,
            level: logs.level,
            module: logs.module,
            actor: actorName,
            message: logs.message,
          },
        });
      },
    );

    app.delete("/", { schema: { response: { 204: z.null() } } }, async (_req, reply) => {
      db.delete(logs).run();
      return reply.status(204).send(null);
    });
  };
