import { type Db, schema } from "@3d-maker-suite/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

// Integrations (encrypted tokens) and internal tables are deliberately not exportable.
const TABLES = {
  printers: schema.printers,
  maintenance: schema.maintenanceTasks,
  "maintenance-types": schema.maintenanceTypes,
  "filament-profiles": schema.filamentProfiles,
  spools: schema.spools,
  projects: schema.projects,
  prints: schema.prints,
  quotes: schema.quotes,
};

const cell = (v: unknown) => {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Text starting like a formula (e.g. a synced name "=HYPERLINK(...)") would run in Excel.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const exportRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:table",
      {
        schema: {
          params: z.object({ table: z.enum(Object.keys(TABLES) as [keyof typeof TABLES]) }),
          querystring: z.object({ format: z.enum(["csv", "json"]).default("csv") }),
        },
      },
      async (req, reply) => {
        const { table } = req.params;
        const { format } = req.query;
        const rows = db.select().from(TABLES[table]).all() as Record<string, unknown>[];
        reply.header("content-disposition", `attachment; filename="${table}.${format}"`);
        if (format === "json") return reply.type("application/json").send(rows);
        const cols = [...new Set(rows.flatMap(Object.keys))];
        const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))];
        // BOM so Excel reads UTF-8.
        return reply.type("text/csv; charset=utf-8").send(`﻿${lines.join("\r\n")}\r\n`);
      },
    );
  };
