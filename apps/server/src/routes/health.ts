import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { VERSION } from "../updates/updates.ts";

// The version tells the app, polling after an update, which code came back.
// The start time lets Settings show how long this server has been up.
export const STARTED_AT = new Date().toISOString();
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: z.object({ status: z.literal("ok"), version: z.string(), startedAt: z.string() }),
        },
      },
    },
    async () => ({ status: "ok" as const, version: VERSION, startedAt: STARTED_AT }),
  );
};
