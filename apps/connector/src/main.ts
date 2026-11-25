// The connector (ADR-0014): a status page on 127.0.0.1 and the link to the hub. The launcher
// (packaging/launcher.mjs) starts it and writes its output to logs/server.log; headless, systemd or
// Docker starts it (ADR-0024, start.ts), and the page is only there for /api/health. The device
// token is never logged, nor is the pairing code.
import { existsSync } from "node:fs";
import { arch, release, type } from "node:os";
import { join } from "node:path";
import { createAutostart } from "@3d-maker-suite/host";
import { createLink } from "./hub.ts";
import { sourceAdapters } from "./sources/registry.ts";
import { followHubAtStart, openSpentCodes, pairAtStart, startOptions } from "./start.ts";
import {
  dataDir,
  localHub,
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
const port = readPort(dir);
// One hub per machine: a connector beside a running hub would fight it for folders and slicers.
const hubVersion = await localHub(port);
if (hubVersion) {
  log(`a hub (${hubVersion}) is running on this machine; the connector is for other machines`);
  process.exit(1);
}
const store = openStore(dir);
const started = startOptions();
const updater = createUpdater({ version: VERSION, log });
// Always on unless the admin turned it off on the Edit connector page. APP_LAUNCH_CMD comes from
// the launcher. Headless, systemd or Docker starts it: a desktop entry too would start it twice.
const cmd = started.headless ? undefined : process.env.APP_LAUNCH_CMD;
const autostart = cmd ? createAutostart(cmd, PRODUCT) : undefined;
let startAtLogin = !started.headless && readAutostart(dir);
const link = createLink({
  store,
  version: VERSION,
  os: `${type()} ${release()} ${arch()}`,
  install: started.install,
  port,
  onHubVersion: updater.follow,
  updateFailure: updater.failure,
  sync: { dataDir: dir, syncDir: syncDir() },
  sources: { dataDir: dir, adapters: sourceAdapters() },
  settings: {
    get: () => ({ port, autostart: startAtLogin }),
    set: async (patch) => {
      // Headless there is no login to start at: it stays off.
      if (patch.autostart !== undefined && !started.headless) {
        await autostart?.set(patch.autostart);
        startAtLogin = patch.autostart;
      }
      writeConfig(dir, {
        ...(patch.port !== undefined && { port: patch.port }),
        ...(patch.autostart !== undefined && !started.headless && { autostart: patch.autostart }),
      });
      const saved = readPort(dir);
      return { port: saved, autostart: startAtLogin, restartRequired: saved !== port };
    },
    restart: () => setTimeout(() => quit(RESTART), 200),
    stop: () => setTimeout(() => quit(0), 200),
  },
  log,
});
const pairing = new AbortController();
const quit = (code: number) => {
  pairing.abort();
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
// No screen to pair on: the hub and code it was started with (ADR-0024). Never exits for a refusal.
// A paired one started with a new hub address moves there first (6.3.0 Step 7b).
void (async () => {
  await followHubAtStart({ link, store, hubUrl: started.hubUrl, log, signal: pairing.signal });
  await pairAtStart({
    link,
    store,
    given: started.pair,
    spent: openSpentCodes(dir),
    log,
    signal: pairing.signal,
  });
})().catch((e) => log(`pairing: ${e.message}`));

autostart?.set(startAtLogin).catch((e) => log(`start at login: ${e.message}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => quit(0));
