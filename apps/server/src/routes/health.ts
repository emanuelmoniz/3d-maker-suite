import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { VERSION } from "../updates/updates.ts";

// The version tells the app, polling after an update, which code came back.
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/health",
    {
      schema: {
        response: { 200: z.object({ status: z.literal("ok"), version: z.string() }) },
      },
    },
    async () => ({ status: "ok" as const, version: VERSION }),
  );
};
