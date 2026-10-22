import {
  apiErrorSchema,
  updateApplySchema,
  updateRollbackSchema,
  updatesResponseSchema,
} from "@3d-maker-suite/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Updater } from "../updates/updates.ts";

const errors = {
  400: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  502: apiErrorSchema,
};

export const updatesRoutes =
  (updater: Updater, restart?: () => void): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/", { schema: { response: { 200: updatesResponseSchema } } }, async () =>
      updater.view(),
    );

    app.post("/check", { schema: { response: { 200: updatesResponseSchema } } }, async () => {
      await updater.check();
      return updater.view();
    });

    // Both reply once the backup and the hand-over file exist; the launcher does the rest.
    const thenRestart = { 202: z.object({ ok: z.literal(true) }), ...errors };
    app.post(
      "/apply",
      { schema: { body: updateApplySchema, response: thenRestart } },
      async (req, reply) => {
        await updater.apply(req.body.tag);
        reply.raw.once("finish", () => setTimeout(() => restart?.(), 50));
        return reply.status(202).send({ ok: true as const });
      },
    );
    app.post(
      "/rollback",
      { schema: { body: updateRollbackSchema, response: thenRestart } },
      async (req, reply) => {
        await updater.rollback(req.body.backup);
        reply.raw.once("finish", () => setTimeout(() => restart?.(), 50));
        return reply.status(202).send({ ok: true as const });
      },
    );
  };
