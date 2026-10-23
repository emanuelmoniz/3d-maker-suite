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
import { createAutostart } from "./lib/autostart.ts";

/** Exit code that asks the launcher for a restart (RESTART in scripts/update.mjs). */
const RESTART = 75;

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
applyPendingRestore(config.dataDir); // before the database opens
// Set by the installed launcher and by `pnpm start`; without it the toggle is hidden.
const autostart = process.env.APP_LAUNCH_CMD
  ? createAutostart(process.env.APP_LAUNCH_CMD)
  : undefined;

const app = await buildApp(openDb(join(config.dataDir, "app.sqlite")), true, config.dataDir, {
  adapters: adapters({ mock: config.mockIntegration }),
  syncSchedule: "* * * * *",
  alertsSchedule: "0 8 * * *",
  backupSchedule: "0 3 * * *",
  logRetentionSchedule: "0 * * * *",
  updateCheckSchedule: "0 9 * * *",
  watchProjects: true,
  access: { host: config.host, password: config.password },
  serverConfig: config,
  autostart,
  // Under `pnpm start` the launcher (scripts/start.mjs) starts it again, applying a pending update.
  // ponytail: without it, respawns itself detached; a supervisor (pm2, systemd) would make this unnecessary.
  stop: () => app.close().then(() => process.exit(0)),
  restart: () =>
    app.close().then(() => {
      if (!process.env.APP_LAUNCHER)
        spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          detached: true,
          stdio: "ignore",
        }).unref();
      process.exit(process.env.APP_LAUNCHER ? RESTART : 0);
    }),
});
await app.register(fastifyStatic, {
  root: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
if (!isLoopback(config.host) && !config.password)
  app.log.warn(
    `Listening on ${config.host} without APP_PASSWORD: only requests addressed to localhost or ${config.host} are accepted. Set APP_PASSWORD to use the app from other devices.`,
  );
await app.listen({ host: config.host, port: config.port });
// Rewrites an existing entry with today's command: 4.1.0 wrote it without --background.
if (await autostart?.get())
  autostart?.set(true).catch((e) => app.log.warn(`Start at login not updated: ${e.message}`));
