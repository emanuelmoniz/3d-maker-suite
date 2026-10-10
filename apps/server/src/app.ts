import { randomBytes } from "node:crypto";
import type { IntegrationAdapter } from "@3d-maker-suite/core";
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
import { evaluateAlerts } from "./alerts/evaluate.ts";
import { runAutoBackup } from "./backup/backup.ts";
import type { Config } from "./config.ts";
import { HttpError } from "./errors.ts";
import { loadKey } from "./integrations/secrets.ts";
import { createSyncer } from "./integrations/sync.ts";
import { accessGuard } from "./lib/access.ts";
import { createProjectScanner } from "./projects/scanner.ts";
import { alertsRoutes } from "./routes/alerts.ts";
import { backupsRoutes } from "./routes/backups.ts";
import { brandingRoutes } from "./routes/branding.ts";
import {
  brandsRoutes,
  filamentBrandsRoutes,
  filamentMaterialsRoutes,
  machineProfilesRoutes,
  printerModelsRoutes,
} from "./routes/catalog.ts";
import { costsRoutes } from "./routes/costs.ts";
import { exportRoutes } from "./routes/export.ts";
import { filamentRoutes } from "./routes/filament.ts";
import { healthRoutes } from "./routes/health.ts";
import { importRoutes } from "./routes/import.ts";
import { integrationsRoutes } from "./routes/integrations.ts";
import { maintenanceRoutes } from "./routes/maintenance.ts";
import { preferencesRoutes } from "./routes/preferences.ts";
import { printersRoutes } from "./routes/printers.ts";
import { printsRoutes } from "./routes/prints.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { serverConfigRoutes } from "./routes/serverConfig.ts";
import { slicerCatalogRoutes } from "./routes/slicerCatalog.ts";
import { slicerZipRoutes } from "./routes/slicerZip.ts";
import { statsRoutes } from "./routes/stats.ts";
import { collectionsRoutes, tagsRoutes } from "./routes/tags.ts";

export async function buildApp(
  db: Db,
  logger: FastifyServerOptions["logger"] = false,
  dataDir = "",
  opts: {
    adapters?: IntegrationAdapter[];
    syncSchedule?: string;
    /** Cron for the alert check. Also turns on the check after every successful change. */
    alertsSchedule?: string;
    /** Cron for automatic backups (needs a data dir). */
    backupSchedule?: string;
    /** Watch the project folders and scan once at startup (off in tests). */
    watchProjects?: boolean;
    /** Bind address and optional password; checked on every request (off in tests). */
    access?: { host: string; password?: string };
    /** Network settings editable from Settings (needs a data dir). */
    serverConfig?: Config;
    /** Makes POST /api/server-config/restart available (off in tests). */
    restart?: () => void;
  } = {},
) {
  const app = Fastify({ logger });
  if (opts.access) app.addHook("onRequest", accessGuard(opts.access));
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
  app.setNotFoundHandler((req, reply) =>
    // Client-side routes (reload / deep link) get the SPA shell; `sendFile` exists only when main.ts serves the web build.
    req.method === "GET" && !req.url.startsWith("/api/") && reply.sendFile
      ? reply.sendFile("index.html")
      : reply.status(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  await app.register(healthRoutes);
  await app.register(preferencesRoutes(db, dataDir), { prefix: "/api/preferences" });
  if (opts.serverConfig)
    await app.register(serverConfigRoutes(opts.serverConfig, opts.restart), {
      prefix: "/api/server-config",
    });
  await app.register(brandingRoutes(dataDir), { prefix: "/api/branding" });
  await app.register(printersRoutes(db, dataDir), { prefix: "/api/printers" });
  await app.register(brandsRoutes(db, dataDir), { prefix: "/api/brands" });
  await app.register(filamentBrandsRoutes(db, dataDir), { prefix: "/api/filament-brands" });
  await app.register(filamentMaterialsRoutes(db, dataDir), { prefix: "/api/filament-materials" });
  await app.register(printerModelsRoutes(db, dataDir), { prefix: "/api/printer-models" });
  await app.register(machineProfilesRoutes(db, dataDir), { prefix: "/api/machine-profiles" });
  await app.register(maintenanceRoutes(db), { prefix: "/api/maintenance" });
  // Without a data dir (tests) secrets use a throwaway in-memory key.
  const key = dataDir ? loadKey(dataDir) : randomBytes(32);
  const syncer = createSyncer(db, opts.adapters ?? [], key, app.log, dataDir);
  await app.register(filamentRoutes(db, syncer), { prefix: "/api/filament" });
  await app.register(slicerCatalogRoutes(db, syncer), { prefix: "/api/slicer-catalog" });
  await app.register(slicerZipRoutes(db, syncer, dataDir), { prefix: "/api/slicer-zip" });
  await app.register(printsRoutes(db), { prefix: "/api/prints" });
  await app.register(costsRoutes(db), { prefix: "/api/costs" });
  await app.register(statsRoutes(db), { prefix: "/api/stats" });
  const scanner = createProjectScanner(db, dataDir, app.log, { watch: opts.watchProjects });
  await app.register(projectsRoutes(db, dataDir, scanner, syncer.adapters), {
    prefix: "/api/projects",
  });
  app.addHook("onClose", () => scanner.close());
  if (opts.watchProjects) app.addHook("onReady", async () => scanner.boot());
  await app.register(tagsRoutes(db), { prefix: "/api/tags" });
  await app.register(collectionsRoutes(db), { prefix: "/api/collections" });

  await app.register(exportRoutes(db), { prefix: "/api/export" });
  await app.register(backupsRoutes(db, dataDir), { prefix: "/api/backups" });
  await app.register(importRoutes(db, dataDir), { prefix: "/api/import" });
  if (opts.backupSchedule && dataDir) {
    const backup = new Cron(opts.backupSchedule, { protect: true }, () =>
      runAutoBackup(db, dataDir).catch((err) => app.log.error({ err }, "backup failed")),
    );
    app.addHook("onClose", async () => backup.stop());
  }

  await app.register(integrationsRoutes(db, key, syncer), { prefix: "/api/integrations" });

  // Runs one at a time, so a condition can't be sent twice by overlapping checks.
  let queue = Promise.resolve();
  const evaluate = () =>
    (queue = queue
      .then(() => evaluateAlerts(db, key, app.log))
      .catch((err) => app.log.error({ err }, "alert check failed")));
  await app.register(alertsRoutes(db, key, evaluate), { prefix: "/api/alerts" });
  if (opts.alertsSchedule) {
    const daily = new Cron(opts.alertsSchedule, { protect: true }, evaluate);
    app.addHook("onClose", async () => daily.stop());
    app.addHook("onReady", async () => void evaluate());
    // On-event checks: any change that went through can open or clear an alert.
    app.addHook("onResponse", async (req, reply) => {
      if (req.method !== "GET" && reply.statusCode < 400 && !req.url.startsWith("/api/alerts"))
        void evaluate();
    });
  }
  if (opts.syncSchedule) {
    const job = new Cron(opts.syncSchedule, { protect: true }, async () => {
      await syncer.runAll();
      await evaluate();
    });
    app.addHook("onClose", async () => job.stop());
  }
  return app;
}
