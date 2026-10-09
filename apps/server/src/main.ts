import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@3d-maker-suite/db";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.ts";
import { applyPendingRestore } from "./backup/backup.ts";
import { loadConfig } from "./config.ts";
import { adapters } from "./integrations/registry.ts";
import { isLoopback } from "./lib/access.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
applyPendingRestore(config.dataDir); // before the database opens

const app = await buildApp(
  openDb(join(config.dataDir, "app.sqlite")),
  {
    // Never log credentials (secrets rule in CLAUDE.md, ADR-0005).
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.secrets",
      "*.token",
      "*.password",
    ],
  },
  config.dataDir,
  {
    adapters: adapters({ mock: config.mockIntegration }),
    syncSchedule: "*/15 * * * *",
    alertsSchedule: "0 8 * * *",
    backupSchedule: "0 3 * * *",
    watchProjects: true,
    access: { host: config.host, password: config.password },
    serverConfig: config,
    // ponytail: respawns itself detached; a supervisor (pm2, systemd) would make this unnecessary.
    restart: () =>
      app.close().then(() => {
        spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          detached: true,
          stdio: "ignore",
        }).unref();
        process.exit(0);
      }),
  },
);
await app.register(fastifyStatic, {
  root: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
if (!isLoopback(config.host) && !config.password)
  app.log.warn(
    `Listening on ${config.host} without APP_PASSWORD: only requests addressed to localhost or ${config.host} are accepted. Set APP_PASSWORD to use the app from other devices.`,
  );
await app.listen({ host: config.host, port: config.port });
