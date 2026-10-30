// The connector (ADR-0014): a status page on 127.0.0.1 and the link to the hub. The launcher
// (packaging/launcher.mjs) starts it and writes its output to logs/server.log. The device token is
// never logged.
import { existsSync } from "node:fs";
import { arch, release, type } from "node:os";
import { join } from "node:path";
import { createAutostart } from "@3d-maker-suite/host";
import { createLink } from "./hub.ts";
import {
  dataDir,
  openStore,
  PRODUCT,
  readAutostart,
  readPort,
  syncDir,
  VERSION,
  writeConfig,
} from "./state.ts";
import { createStatusPage } from "./status.ts";
import { createUpdater, RESTART } from "./update.ts";

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const dir = dataDir();
// A hub's folder (one APP_DATA_DIR for both): pruning `slicers/` would delete the hub's own.
if (existsSync(join(dir, "app.sqlite"))) {
  log(`${dir} is a hub's data folder; set APP_DATA_DIR to another folder for the connector`);
  process.exit(1);
}
const store = openStore(dir);
const updater = createUpdater({ version: VERSION, log });
const port = readPort(dir);
// Always on unless the admin turned it off on the Edit connector page. APP_LAUNCH_CMD comes from
// the launcher.
const cmd = process.env.APP_LAUNCH_CMD;
const autostart = cmd ? createAutostart(cmd, PRODUCT) : undefined;
let startAtLogin = readAutostart(dir);
const link = createLink({
  store,
  version: VERSION,
  os: `${type()} ${release()} ${arch()}`,
  port,
  onHubVersion: updater.follow,
  updateFailure: updater.failure,
  sync: { dataDir: dir, syncDir: syncDir() },
  settings: {
    get: () => ({ port, autostart: startAtLogin }),
    set: async (patch) => {
      if (patch.autostart !== undefined) {
        await autostart?.set(patch.autostart);
        startAtLogin = patch.autostart;
      }
      writeConfig(dir, {
        ...(patch.port !== undefined && { port: patch.port }),
        ...(patch.autostart !== undefined && { autostart: patch.autostart }),
      });
      const saved = readPort(dir);
      return { port: saved, autostart: startAtLogin, restartRequired: saved !== port };
    },
    restart: () => setTimeout(() => quit(RESTART), 200),
  },
  log,
});
const quit = (code: number) => {
  link.close();
  page.close();
  process.exit(code);
};
const page = createStatusPage({
  link,
  store,
  updater,
  version: VERSION,
  syncDir: syncDir(),
  exit: quit,
});
page.listen(port, "127.0.0.1", () => log(`${VERSION}, status page on http://127.0.0.1:${port}/`));
link.start();

autostart?.set(startAtLogin).catch((e) => log(`start at login: ${e.message}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => quit(0));
