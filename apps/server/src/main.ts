import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import { hasUsers } from "./lib/auth.ts";
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

const db = openDb(join(config.dataDir, "app.sqlite"));
// ADR-0012: a new one each boot while no users exist; console only, never the logs table.
const setupToken = hasUsers(db) ? undefined : randomBytes(18).toString("base64url");

const app = await buildApp(db, true, config.dataDir, {
  adapters: adapters({ mock: config.mockIntegration }),
  syncSchedule: "* * * * *",
  alertsSchedule: "0 8 * * *",
  backupSchedule: "0 3 * * *",
  logRetentionSchedule: "0 * * * *",
  updateCheckSchedule: "0 9 * * *",
  watchProjects: true,
  access: { host: config.host, password: config.password, allowedHosts: config.allowedHosts },
  setupToken,
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
if (!setupToken && config.password)
  app.log.warn(
    "APP_PASSWORD is ignored now that users exist: sign in with your account and remove it from the environment.",
  );
else if (!isLoopback(config.host) && !config.password)
  app.log.warn(
    `Listening on ${config.host} without APP_PASSWORD: only requests addressed to localhost or ${config.host} are accepted. Set APP_PASSWORD to use the app from other devices.`,
  );
if (config.allowedHosts.length)
  app.log.info(`Also accepting requests addressed to: ${config.allowedHosts.join(", ")}`);
await app.listen({ host: config.host, port: config.port });
if (setupToken)
  console.log(
    `No users yet. To create the first admin from another device, use this setup token: ${setupToken}`,
  );
// Rewrites an existing entry with today's command: 4.1.0 wrote it without --background.
if (await autostart?.get())
  autostart?.set(true).catch((e) => app.log.warn(`Start at login not updated: ${e.message}`));
