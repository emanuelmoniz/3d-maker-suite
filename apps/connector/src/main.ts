// The connector (ADR-0014): a status page on 127.0.0.1 and the link to the hub. The launcher
// (packaging/launcher.mjs) starts it and writes its output to logs/server.log. The device token is
// never logged.
import { arch, release, type } from "node:os";
import { createAutostart } from "@3d-maker-suite/host";
import { createLink } from "./hub.ts";
import { dataDir, openStore, PRODUCT, readPort, syncDir, VERSION } from "./state.ts";
import { createStatusPage } from "./status.ts";
import { createUpdater } from "./update.ts";

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const dir = dataDir();
const store = openStore(dir);
const updater = createUpdater({ version: VERSION, log });
const port = readPort(dir);
const link = createLink({
  store,
  version: VERSION,
  os: `${type()} ${release()} ${arch()}`,
  port,
  onHubVersion: updater.follow,
  updateFailure: updater.failure,
  sync: { dataDir: dir, syncDir: syncDir() },
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

// Always on: the connector only helps while it runs. APP_LAUNCH_CMD comes from the launcher.
const cmd = process.env.APP_LAUNCH_CMD;
if (cmd)
  createAutostart(cmd, PRODUCT)
    .set(true)
    .catch((e) => log(`start at login: ${e.message}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => quit(0));
