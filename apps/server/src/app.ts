import { randomBytes, randomUUID } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { IntegrationAdapter, LogModule } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { type Autostart, loadKey } from "@3d-maker-suite/host";
// Types only: reply.sendFile below; main.ts registers the plugin when it serves the web build.
import type {} from "@fastify/static";
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
import { createSlicerInstaller } from "./integrations/managedSlicer.ts";
import { createSyncer } from "./integrations/sync.ts";
import { authGuard } from "./lib/auth.ts";
import { createHubChannel } from "./lib/hubChannel.ts";
import { CUSTOM_LEVELS, createLogSink, moduleOf, pruneLogs, success } from "./lib/logSink.ts";
import { readPreferences } from "./lib/preferences.ts";
import { pruneSessions } from "./lib/session.ts";
import { autoSlice, autoSliceSlicer } from "./projects/autoSlice.ts";
import { createDeviceFiles } from "./projects/deviceFiles.ts";
import { useDeviceFiles } from "./projects/rootFs.ts";
import { createProjectScanner } from "./projects/scanner.ts";
import { createSliceQueue } from "./projects/sliceQueue.ts";
import { accessoriesRoutes } from "./routes/accessories.ts";
import { alertsRoutes } from "./routes/alerts.ts";
import { authRoutes } from "./routes/auth.ts";
import { backupsRoutes } from "./routes/backups.ts";
import { brandingRoutes } from "./routes/branding.ts";
import {
  brandsRoutes,
  filamentBrandsRoutes,
  filamentMaterialsRoutes,
  machineProfilesRoutes,
  printerModelsRoutes,
  printProfilesRoutes,
} from "./routes/catalog.ts";
import { clientsRoutes } from "./routes/clients.ts";
import { costsRoutes } from "./routes/costs.ts";
import { filamentRoutes } from "./routes/filament.ts";
import { fsRoutes } from "./routes/fs.ts";
import { healthRoutes } from "./routes/health.ts";
import { hubRoutes } from "./routes/hub.ts";
import { hubDeviceRoutes } from "./routes/hubDevice.ts";
import { importRoutes } from "./routes/import.ts";
import { integrationsRoutes } from "./routes/integrations.ts";
import { logsRoutes } from "./routes/logs.ts";
import { maintenanceRoutes } from "./routes/maintenance.ts";
import { ordersRoutes } from "./routes/orders.ts";
import { preferencesRoutes } from "./routes/preferences.ts";
import { printersRoutes } from "./routes/printers.ts";
import { printsRoutes } from "./routes/prints.ts";
import { projectFilesRoutes } from "./routes/projectFiles.ts";
import { projectSlicingRoutes } from "./routes/projectSlicing.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { rootsRoutes } from "./routes/roots.ts";
import { serverConfigRoutes } from "./routes/serverConfig.ts";
import { slicerZipRoutes } from "./routes/slicerZip.ts";
import { statsRoutes } from "./routes/stats.ts";
import { collectionsRoutes, tagsRoutes } from "./routes/tags.ts";
import { updatesRoutes } from "./routes/updates.ts";
import { usersRoutes } from "./routes/users.ts";
import { createUpdater } from "./updates/updates.ts";

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
    /** Cron for pruning the `logs` table; also prunes once at startup. */
    logRetentionSchedule?: string;
    /** Watch the project folders and scan once at startup (off in tests). */
    watchProjects?: boolean;
    /** Bind address and optional password, checked while no users exist (off in tests). */
    access?: { host: string; password?: string; allowedHosts?: string[] };
    /** Fastify `trustProxy` (`APP_TRUST_PROXY`): `req.ip` is then the client behind the proxy. */
    trustProxy?: FastifyServerOptions["trustProxy"];
    /** One-time token that allows `POST /api/auth/setup` from another device (ADR-0012). */
    setupToken?: string;
    /** Network settings editable from Settings (needs a data dir). */
    serverConfig?: Config;
    /** Makes POST /api/server-config/restart available, and lets an update restart (off in tests). */
    restart?: () => void;
    /** Makes POST /api/server-config/stop available (there may be no console to close). */
    stop?: () => void;
    /** Makes GET/PUT /api/server-config/autostart available (needs the launch command). */
    autostart?: Autostart;
    /** Cron for the update check; also checks a minute after start (ADR-0009). */
    updateCheckSchedule?: string;
    /** Test seam for the updater (install type, version, releases). */
    updater?: Parameters<typeof createUpdater>[3];
    /** Test seam for managed slicer installs (releases, download, smoke test, system). */
    slicerInstaller?: Parameters<typeof createSlicerInstaller>[4];
  } = {},
) {
  // Any logger also feeds the `logs` table (Settings -> Logs decides what is kept).
  const loggerOpts = logger === true ? {} : logger;
  const sink = loggerOpts && createLogSink(db, loggerOpts.stream ?? process.stdout);
  const app = Fastify({
    logger: sink && {
      // Never log credentials (secrets rule in CLAUDE.md, ADR-0005); this covers the table too.
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.secrets",
        "*.token",
        "*.password",
      ],
      ...loggerOpts,
      level: "debug",
      customLevels: CUSTOM_LEVELS,
      stream: sink,
    },
    trustProxy: opts.trustProxy ?? false,
    // Replaced by the one line per API call below.
    disableRequestLogging: true,
    childLoggerFactory: (log, bindings, o, raw) =>
      log.child({ ...bindings, module: moduleOf(raw.url ?? "") }, o),
  });
  if (sink) sink.configure(readPreferences(db));
  app.addHook("onResponse", async (req, reply) => {
    // The Logs page polls itself; static files and the SPA shell aren't worth a line.
    if (!req.url.startsWith("/api/") || req.url.startsWith("/api/logs")) return;
    const s = reply.statusCode;
    const line = `${req.method} ${req.url} ${s}`;
    const ms = { ms: Math.round(reply.elapsedTime) };
    if (s >= 500) return; // the error handler logged it
    if (s >= 400) req.log.warn(ms, line);
    else if (req.method === "GET") req.log.debug(ms, line);
    else req.log.info(ms, line);
  });
  app.addHook("onRequest", authGuard(db, opts.access));
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
  await app.register(authRoutes(db, !!opts.access?.password, opts.setupToken), {
    prefix: "/api/auth",
  });
  await app.register(usersRoutes(db), { prefix: "/api/users" });
  const hub = createHubChannel(db);
  // Files pulled from device roots (ADR-0014); a temp folder of its own without a data dir (tests).
  const deviceFiles = createDeviceFiles(
    db,
    hub,
    dataDir
      ? join(dataDir, "cache", "device-files")
      : join(tmpdir(), `3d-maker-suite-device-files-${randomUUID()}`),
  );
  useDeviceFiles(db, deviceFiles);
  app.addHook("onClose", async () => deviceFiles.close());
  await app.register(hubRoutes(db, hub), { prefix: "/api/hub" });
  await app.register(
    preferencesRoutes(db, dataDir, (v, patch) => {
      if (sink) sink.configure(v);
      // Folders cut off by the old size are sent again: forget their digests and wake the devices
      // (an offline one syncs when it connects).
      if (patch.deviceFolderMaxMb !== undefined) {
        db.update(schema.deviceRootFolders).set({ digest: "" }).run();
        for (const { id } of db.select({ id: schema.devices.id }).from(schema.devices).all())
          if (hub.online(id)) hub.publish(id, { type: "roots.changed" });
      }
    }),
    { prefix: "/api/preferences" },
  );
  await app.register(logsRoutes(db), { prefix: "/api/logs" });
  if (opts.logRetentionSchedule) {
    const prune = () => {
      try {
        pruneLogs(db, readPreferences(db));
        pruneSessions(db);
      } catch (err) {
        app.log.error({ err }, "log pruning failed");
      }
    };
    const job = new Cron(opts.logRetentionSchedule, { protect: true }, prune);
    app.addHook("onReady", async () => prune());
    app.addHook("onClose", async () => job.stop());
  }
  // Background work has no URL, so it names its module here.
  const logFor = (module: LogModule) => app.log.child({ module });
  if (opts.serverConfig)
    await app.register(
      serverConfigRoutes(opts.serverConfig, opts.restart, opts.stop, opts.autostart),
      { prefix: "/api/server-config" },
    );
  await app.register(fsRoutes(db, hub), { prefix: "/api/fs" });
  await app.register(brandingRoutes(dataDir), { prefix: "/api/branding" });
  await app.register(printersRoutes(db, dataDir), { prefix: "/api/printers" });
  await app.register(accessoriesRoutes(db, dataDir), { prefix: "/api/accessories" });
  await app.register(clientsRoutes(db), { prefix: "/api/clients" });
  await app.register(ordersRoutes(db), { prefix: "/api/orders" });
  await app.register(brandsRoutes(db, dataDir), { prefix: "/api/brands" });
  await app.register(filamentBrandsRoutes(db, dataDir), { prefix: "/api/filament-brands" });
  await app.register(filamentMaterialsRoutes(db, dataDir), { prefix: "/api/filament-materials" });
  await app.register(printerModelsRoutes(db, dataDir), { prefix: "/api/printer-models" });
  await app.register(machineProfilesRoutes(db, dataDir), { prefix: "/api/machine-profiles" });
  await app.register(printProfilesRoutes(db, dataDir), { prefix: "/api/print-profiles" });
  await app.register(maintenanceRoutes(db), { prefix: "/api/maintenance" });
  // Without a data dir (tests) secrets use a throwaway in-memory key.
  const key = dataDir ? loadKey(dataDir) : randomBytes(32);
  const syncer = createSyncer(db, opts.adapters ?? [], key, logFor("integrations"), dataDir);
  await app.register(filamentRoutes(db), { prefix: "/api/filament" });
  await app.register(slicerZipRoutes(db, syncer, dataDir), { prefix: "/api/slicer-zip" });
  await app.register(printsRoutes(db), { prefix: "/api/prints" });
  const projectsLog = logFor("projects");
  const sliceQueue = createSliceQueue(projectsLog);
  await app.register(costsRoutes(db, dataDir, syncer.adapters, sliceQueue), {
    prefix: "/api/costs",
  });
  await app.register(statsRoutes(db), { prefix: "/api/stats" });
  const scanner = createProjectScanner(db, dataDir, projectsLog, {
    watch: opts.watchProjects,
    onScanned: (id, before) => autoSlice(db, syncer.adapters, sliceQueue, projectsLog, id, before),
  });
  await app.register(rootsRoutes(db, hub, scanner), { prefix: "/api/roots" });
  await app.register(hubDeviceRoutes(db, hub, scanner, deviceFiles), { prefix: "/api/hub/device" });
  await app.register(projectsRoutes(db, dataDir, scanner, hub, syncer.adapters), {
    prefix: "/api/projects",
  });
  await app.register(projectFilesRoutes(db, scanner), { prefix: "/api/projects" });
  await app.register(projectSlicingRoutes(db, syncer.adapters, sliceQueue), {
    prefix: "/api/projects",
  });
  app.addHook("onClose", () => {
    sliceQueue.close();
    return scanner.close();
  });
  if (opts.watchProjects) app.addHook("onReady", async () => scanner.boot());
  await app.register(tagsRoutes(db), { prefix: "/api/tags" });
  await app.register(collectionsRoutes(db), { prefix: "/api/collections" });

  await app.register(backupsRoutes(db, dataDir), { prefix: "/api/backups" });
  await app.register(importRoutes(db, dataDir, syncer, scanner), { prefix: "/api/import" });
  if (opts.backupSchedule && dataDir) {
    const log = logFor("backups");
    const backup = new Cron(opts.backupSchedule, { protect: true }, () =>
      runAutoBackup(db, dataDir)
        .then(() => success(log, {}, "automatic backup done"))
        .catch((err) => log.error({ err }, "backup failed")),
    );
    app.addHook("onClose", async () => backup.stop());
  }

  const installer = createSlicerInstaller(db, dataDir, syncer.adapters, logFor("integrations"), {
    // A new version outdates its slices (ADR-0013); auto slicing redoes them.
    onInstalled: (id) =>
      void autoSliceSlicer(db, syncer.adapters, sliceQueue, projectsLog, id).catch((err) =>
        projectsLog.error({ err }, "auto slice after a slicer update failed"),
      ),
    ...opts.slicerInstaller,
  });
  await app.register(integrationsRoutes(db, key, syncer, installer), {
    prefix: "/api/integrations",
  });

  // Runs one at a time, so a condition can't be sent twice by overlapping checks.
  let queue = Promise.resolve();
  const net = opts.serverConfig;
  // Links in notifications; a wildcard host is reached by the machine's name.
  const baseUrl =
    net && `http://${["0.0.0.0", "::"].includes(net.host) ? hostname() : net.host}:${net.port}`;
  const alertsLog = logFor("alerts");
  const evaluate = () =>
    (queue = queue
      .then(() => evaluateAlerts(db, key, alertsLog, baseUrl))
      .catch((err) => alertsLog.error({ err }, "alert check failed")));
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

  const updater = createUpdater(db, dataDir, logFor("system"), opts.updater);
  await app.register(updatesRoutes(updater, opts.restart), { prefix: "/api/updates" });
  if (opts.updateCheckSchedule) {
    // A new release (of the app or an installed slicer) raises an alert; evaluate sends it.
    const check = () => Promise.all([updater.check(), installer.check()]).then(evaluate);
    const daily = new Cron(opts.updateCheckSchedule, { protect: true }, check);
    // Not at once: a server started for a moment (tests, a restart loop) never asks GitHub.
    const first = setTimeout(check, 60_000).unref();
    app.addHook("onClose", async () => {
      daily.stop();
      clearTimeout(first);
    });
  }
  return app;
}
