// The installed app's launcher (ADR-0011): if the app already answers, just opens the browser;
// otherwise runs the newest version in versions/ (on macOS also the one inside the .app),
// recreating its links first, logs to <install dir>/logs/server.log, opens the browser once it is
// healthy and starts it again when it exits with RESTART.
// Node stdlib only. It ships with the installer and doesn't change with updates, so keep it small.
// node launcher.mjs [server args, e.g. --port 4400]
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Exit code the server uses to ask for a restart (RESTART in scripts/update.mjs). */
const RESTART = 75;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

/** Semver order, a copy of compareVersions in packages/core: the launcher can't import workspace code. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => {
    const m = VERSION.exec(v);
    if (!m) throw new Error(`Not a version: ${v}`);
    return { core: [m[1], m[2], m[3]].map(Number), pre: m[4]?.split(".") ?? [] };
  });
  for (let i = 0; i < 3; i++) {
    const d = x.core[i] - y.core[i];
    if (d) return Math.sign(d);
  }
  // A release beats its own pre-releases.
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const m = /^\d+$/.test(p);
    const n = /^\d+$/.test(q);
    if (m && n && +p !== +q) return Math.sign(+p - +q);
    if (m !== n) return m ? -1 : 1;
    if (!m && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The newest of the finished folders in `<install>/versions` (a `4.1.1.partial` is still being
 * unpacked) and `shipped` (macOS: the version inside the .app). `{ version, app }` or undefined.
 */
export function newest(install, shipped) {
  const dir = join(install, "versions");
  const found = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => VERSION.test(n))
        .map((version) => ({ version, app: join(dir, version) }))
    : [];
  if (shipped) found.push(shipped);
  return found.sort((a, b) => compareVersions(b.version, a.version))[0];
}

/**
 * Recreates the links the bundle recorded in `<app>/links.json` (relative targets): junctions on
 * Windows (absolute, no admin needed), relative symlinks elsewhere. Existing ones are kept.
 */
export function relink(app) {
  const file = join(app, "links.json");
  if (!existsSync(file)) return;
  for (const [p, target] of JSON.parse(readFileSync(file, "utf8"))) {
    const at = join(app, p);
    if (existsSync(at)) continue;
    mkdirSync(dirname(at), { recursive: true });
    if (process.platform === "win32") symlinkSync(resolve(dirname(at), target), at, "junction");
    else symlinkSync(target, at);
  }
}

/** Same default as dataDir() in apps/server/src/config.ts (the launcher can't import it). */
export function dataDir(env = process.env, platform = process.platform) {
  if (env.APP_DATA_DIR) return env.APP_DATA_DIR;
  const home = homedir();
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "3d-maker-suite");
  if (platform === "darwin") return join(home, "Library", "Application Support", "3d-maker-suite");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "3d-maker-suite");
}

/** Where the app listens: CLI flag > env > saved config.json > default, like loadConfig(). */
export function serverUrl(dir, env = process.env, argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: { host: { type: "string" }, port: { type: "string" } },
    strict: false,
  });
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {}
  const host = String(values.host ?? env.HOST ?? saved.host ?? "127.0.0.1");
  const port = Number(values.port ?? env.PORT ?? saved.port ?? 4300);
  // A wildcard bind is reached through loopback; IPv6 literals need brackets.
  const name = ["0.0.0.0", "::", "[::]"].includes(host) ? "127.0.0.1" : host;
  return `http://${name.includes(":") && !name.startsWith("[") ? `[${name}]` : name}:${port}/`;
}

export const healthy = (url) =>
  fetch(`${url}api/health`, { signal: AbortSignal.timeout(1500) }).then(
    (r) => r.ok,
    () => false,
  );

export function openBrowser(url) {
  const [cmd, ...args] =
    process.platform === "win32"
      ? ["rundll32", "url.dll,FileProtocolHandler", url]
      : [process.platform === "darwin" ? "open" : "xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true })
    .on("error", () => {})
    .unref();
}

/** Moves `file` to `file.1` (replacing the previous one) once it is over `max` bytes. */
export function rotate(file, max = 5 * 1024 * 1024) {
  try {
    if (statSync(file).size > max) renameSync(file, `${file}.1`);
  } catch {} // nothing to rotate yet
}

async function main() {
  const here = import.meta.dirname;
  // The .app is signed and read-only: versions and logs live next to the data instead.
  const mac = process.platform === "darwin";
  const install = mac
    ? join(homedir(), "Library", "Application Support", "3d-maker-suite", "install")
    : here;
  const shipped = mac && {
    version: JSON.parse(readFileSync(join(here, "app", "package.json"), "utf8")).version,
    app: join(here, "app"),
  };
  // Single instance: a second double-click only opens the browser.
  const dir = dataDir();
  const url = serverUrl(dir);
  if (await healthy(url)) return openBrowser(url);

  mkdirSync(join(install, "logs"), { recursive: true });
  const launcherLog = openSync(join(install, "logs", "launcher.log"), "w");
  const say = (s) => writeSync(launcherLog, `${new Date().toISOString()} ${s}\n`);
  // No terminal (nodew.exe, .app, .desktop): the server's output goes here, next to launcher.log.
  // ponytail: rotated each time the launcher starts the server; a log that outgrows the limit
  // within one run is cut at the next restart.
  const serverLog = join(install, "logs", "server.log");

  // Open the browser once, when the first start is healthy (restarts are opened by Settings).
  (async () => {
    for (let i = 0; i < 120; i++) {
      if (await healthy(url)) return openBrowser(url);
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  // Ctrl+C (when started from a terminal) reaches the server too; wait for it to exit.
  process.on("SIGINT", () => {});
  let server;
  process.on("SIGTERM", () => server?.kill("SIGTERM"));
  try {
    for (;;) {
      const run = newest(install, shipped || undefined);
      if (!run) throw new Error(`No version in ${join(install, "versions")}`);
      relink(run.app);
      say(`starting ${run.version}`);
      rotate(serverLog);
      const log = openSync(serverLog, "a");
      const code = await new Promise((done) => {
        server = spawn(process.execPath, ["src/main.ts", ...process.argv.slice(2)], {
          cwd: join(run.app, "apps", "server"),
          stdio: ["ignore", log, log],
          windowsHide: true,
          env: {
            ...process.env,
            APP_LAUNCHER: "1",
            APP_INSTALL: "bundle",
            APP_INSTALL_DIR: install,
            // What Settings -> Start at login registers; same string as the installer's checkbox.
            APP_LAUNCH_CMD: `"${process.execPath}" "${fileURLToPath(import.meta.url)}"`,
          },
        });
        server.on("exit", (c) => done(c ?? 0));
      });
      closeSync(log);
      say(`exited with ${code}`);
      if (code !== RESTART) process.exit(code);
    }
  } catch (e) {
    say(e.stack);
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
