import { randomBytes } from "node:crypto";
import type { FilamentLibrary, IntegrationAdapter } from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Cron } from "croner";
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { HttpError } from "./errors.ts";
import { loadKey } from "./integrations/secrets.ts";
import { createSyncer } from "./integrations/sync.ts";
import { createProjectScanner } from "./projects/scanner.ts";
import { filamentRoutes } from "./routes/filament.ts";
import { healthRoutes } from "./routes/health.ts";
import { integrationsRoutes } from "./routes/integrations.ts";
import { maintenanceRoutes } from "./routes/maintenance.ts";
import { preferencesRoutes } from "./routes/preferences.ts";
import { printersRoutes } from "./routes/printers.ts";
import { printsRoutes } from "./routes/prints.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { collectionsRoutes, tagsRoutes } from "./routes/tags.ts";

export async function buildApp(
  db: Db,
  logger: FastifyServerOptions["logger"] = false,
  dataDir = "",
  opts: {
    adapters?: IntegrationAdapter[];
    filamentLibraries?: FilamentLibrary[];
    syncSchedule?: string;
    /** Watch the project folders and scan once at startup (off in tests). */
    watchProjects?: boolean;
  } = {},
) {
  const app = Fastify({ logger });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: { info: { title: "3D Maker Suite API", version: "0.0.0" } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  // Every error leaves as { error: { code, message, details? } }.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid request", details: err.validation },
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const status = isResponseSerializationError(err) ? 500 : (err.statusCode ?? 500);
    if (status >= 500) req.log.error(err);
    reply.status(status).send({
      error: {
        code: status >= 500 ? "internal_error" : (err.code ?? "error"),
        message: status >= 500 ? "Internal server error" : err.message,
      },
    });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  await app.register(healthRoutes);
  await app.register(settingsRoutes(db), { prefix: "/api/settings" });
  await app.register(preferencesRoutes(db, dataDir), { prefix: "/api/preferences" });
  await app.register(printersRoutes(db, dataDir), { prefix: "/api/printers" });
  await app.register(maintenanceRoutes(db), { prefix: "/api/maintenance" });
  await app.register(filamentRoutes(db, opts.filamentLibraries ?? []), { prefix: "/api/filament" });
  await app.register(printsRoutes(db), { prefix: "/api/prints" });
  const scanner = createProjectScanner(db, dataDir, app.log, { watch: opts.watchProjects });
  await app.register(projectsRoutes(db, dataDir, scanner), { prefix: "/api/projects" });
  app.addHook("onClose", () => scanner.close());
  if (opts.watchProjects) app.addHook("onReady", async () => scanner.boot());
  await app.register(tagsRoutes(db), { prefix: "/api/tags" });
  await app.register(collectionsRoutes(db), { prefix: "/api/collections" });

  // Without a data dir (tests) secrets use a throwaway in-memory key.
  const key = dataDir ? loadKey(dataDir) : randomBytes(32);
  const syncer = createSyncer(db, opts.adapters ?? [], key, app.log);
  await app.register(integrationsRoutes(db, key, syncer), { prefix: "/api/integrations" });
  if (opts.syncSchedule) {
    const job = new Cron(opts.syncSchedule, { protect: true }, () => syncer.runAll());
    app.addHook("onClose", async () => job.stop());
  }
  return app;
}
