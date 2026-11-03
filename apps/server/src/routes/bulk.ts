import {
  apiErrorSchema,
  BULK_ITEMS,
  type BulkResult,
  bulkInputSchema,
  bulkKindSchema,
  bulkResultSchema,
} from "@3d-maker-suite/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const FORWARDED = ["host", "cookie", "authorization"] as const;

/** Marks a replayed row, whose alert check waits for the end of its bulk request. Grants nothing. */
export const BULK_ROW_HEADER = "x-bulk-row";

/**
 * Archive, restore or delete many rows (ADR-0018). Each one is the request its own button sends, as
 * the same caller, so it runs the same code and access checks in its own transaction. A refused row
 * is reported and the rest go on. `manage` on the module is the rule in `lib/auth.ts`.
 */
export const bulkRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/:kind",
    {
      // Everything a filter lists can be selected; this is over a million ids.
      bodyLimit: 64 * 1024 * 1024,
      schema: {
        params: z.object({ kind: bulkKindSchema }),
        body: bulkInputSchema,
        response: { 200: bulkResultSchema, 400: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async (req) => {
      const { action, ids } = req.body;
      const { path } = BULK_ITEMS[req.params.kind];
      const headers = Object.fromEntries(
        FORWARDED.flatMap((h) => {
          const value = req.headers[h];
          return value ? [[h, value]] : [];
        }),
      );
      const result: BulkResult = { done: [], blocked: [] };
      for (const id of new Set(ids)) {
        const res = await app.inject({
          url: `${path}/${id}`,
          headers: { ...headers, [BULK_ROW_HEADER]: "1" },
          remoteAddress: req.ip,
          ...(action === "delete"
            ? { method: "DELETE" }
            : { method: "PATCH", payload: { archived: action === "archive" } }),
        });
        if (res.statusCode < 300) {
          result.done.push(id);
          continue;
        }
        const { code, message, details } = res.json().error;
        result.blocked.push({ id, code, message, ...(code === "in_use" && { details }) });
      }
      return result;
    },
  );
};
