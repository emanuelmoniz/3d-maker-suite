import { serverConfigPatchSchema, serverConfigResponseSchema } from "@3d-maker-suite/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { type Config, readSavedConfig, writeSavedConfig } from "../config.ts";

export const serverConfigRoutes =
  (config: Config, restart?: () => void, stop?: () => void): FastifyPluginAsyncZod =>
  async (app) => {
    const view = () => ({
      effective: {
        host: config.host,
        port: config.port,
        hostSource: config.hostSource,
        portSource: config.portSource,
      },
      saved: readSavedConfig(config.dataDir),
      passwordSet: !!config.password,
    });

    app.get("/", { schema: { response: { 200: serverConfigResponseSchema } } }, async () => view());

    // Only writes the file; the new values apply on restart. The password rule still holds then:
    // a non-loopback host without APP_PASSWORD only answers requests addressed to localhost/that host.
    app.patch(
      "/",
      { schema: { body: serverConfigPatchSchema, response: { 200: serverConfigResponseSchema } } },
      async (req) => {
        const next = { ...readSavedConfig(config.dataDir) };
        for (const [key, value] of Object.entries(req.body)) {
          if (value === null) delete next[key as "host" | "port"];
          else Object.assign(next, { [key]: value });
        }
        writeSavedConfig(config.dataDir, next);
        return view();
      },
    );

    // Replies first, then main.ts frees the port and starts a fresh copy of the process.
    if (restart)
      app.post("/restart", async (_req, reply) => {
        reply.raw.once("finish", () => setTimeout(restart, 50));
        return reply.status(202).send({ ok: true });
      });

    // Exit code 0 ends the launcher too; this is the only way to quit when it runs without a window.
    if (stop)
      app.post("/stop", async (_req, reply) => {
        reply.raw.once("finish", () => setTimeout(stop, 50));
        return reply.status(202).send({ ok: true });
      });
  };
