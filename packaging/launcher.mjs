// The installed app's launcher (ADR-0011): if the app already answers, just opens the browser;
// otherwise runs the newest version in versions/ (on macOS also the one inside the .app),
// recreating its links first, logs to <install dir>/logs/server.log, opens the browser on a loader
// page (loader.html) that goes to the app once it answers (not with --background, Start at login)
// and starts it again when it exits with RESTART. After an update or rollback
// (.update/pending.json) the new version gets TRIAL_MS to answer, or the launcher goes back.
// Node stdlib only. It ships with the installer and doesn't change with updates, so keep it small.
// node launcher.mjs [--background] [server args, e.g. --port 4400]
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Exit code the server uses to ask for a restart (RESTART in scripts/update.mjs). */
const RESTART = 75;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
/** A runnable folder in versions/: not one being unpacked or hidden by a rollback ("alpha.2.old" is valid semver). */
const finished = (name) => VERSION.test(name) && !/\.(partial|old)$/.test(name);
/** How long a freshly updated or rolled back version has to answer /api/health. */
const TRIAL_MS = 60_000;
/** Version folders kept after a good update: the running one and the one to roll back to. */
const KEEP = 2;

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
        .filter(finished)
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

/** True once `url` is healthy, false after `ms` without. */
export async function waitHealthy(url, ms) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await healthy(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * The server's hand-over (.update/pending.json), or null. A rollback hides the running version
 * (`<v>.old`), so the one it goes back to is the newest. Safe to repeat after a crash.
 */
export function beginPending(install) {
  let p;
  try {
    p = JSON.parse(readFileSync(join(install, ".update", "pending.json"), "utf8"));
  } catch {
    return null;
  }
  const running = join(install, "versions", p.fromVersion);
  if (p.action === "rollback" && existsSync(running)) renameSync(running, `${running}.old`);
  return p;
}

/**
 * Ends a pending update or rollback. ok: drops the undo and leftovers, keeps the KEEP newest
 * versions. Not ok: removes or unhides folders so the version that ran before is the newest again,
 * and stages the undo, which that version restores before its database opens.
 * Then result.json for the server, and pending.json goes.
 */
export function settle(install, p, ok) {
  const versions = join(install, "versions");
  const rm = (f) => f && rmSync(f, { recursive: true, force: true });
  if (ok) {
    rm(p.undo);
    const names = readdirSync(versions);
    for (const n of names.filter((n) => !finished(n))) rm(join(versions, n)); // .old, .partial
    for (const n of names
      .filter(finished)
      .sort((a, b) => compareVersions(b, a))
      .slice(KEEP))
      rm(join(versions, n));
  } else {
    const running = join(versions, p.fromVersion);
    if (p.action === "update") rm(join(versions, p.toVersion));
    else if (existsSync(`${running}.old`)) renameSync(`${running}.old`, running);
    rm(p.restoreDir);
    if (p.undo && existsSync(p.undo)) renameSync(p.undo, p.restoreDir);
  }
  // Written whole, then renamed: the server may read it at any moment.
  const dir = join(install, ".update");
  const result = { ...p, ok, ...(!ok && { failedStep: "start" }) };
  writeFileSync(join(dir, "result.json.tmp"), JSON.stringify(result, null, 2));
  renameSync(join(dir, "result.json.tmp"), join(dir, "result.json"));
  rmSync(join(dir, "pending.json"), { force: true });
}

export function openBrowser(url) {
  const [cmd, ...args] =
    process.platform === "win32"
      ? ["rundll32", "url.dll,FileProtocolHandler", url]
      : [process.platform === "darwin" ? "open" : "xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true })
    .on("error", () => {})
    .unref();
}

/** Start at login passes it: start the server without opening the browser. */
export const BACKGROUND = "--background";

/** Splits the launcher's own flag from the args it passes on to the server. */
export function launchArgs(argv) {
  return { background: argv.includes(BACKGROUND), args: argv.filter((a) => a !== BACKGROUND) };
}

/** Writes `template` to `out` with the app's URL filled in; returns `out`. */
export function writeLoader(template, out, url) {
  const html = readFileSync(template, "utf8");
  writeFileSync(
    out,
    html.replace(/const APP_URL = ".*?";/, `const APP_URL = ${JSON.stringify(url)};`),
  );
  return out;
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
  const { background, args } = launchArgs(process.argv.slice(2));
  // Single instance: a second double-click only opens the browser.
  const dir = dataDir();
  const url = serverUrl(dir, process.env, args);
  if (await healthy(url)) return background || openBrowser(url);

  mkdirSync(join(install, "logs"), { recursive: true });
  // Appended (rotated like server.log) so the first start after an install isn't overwritten by the next.
  rotate(join(install, "logs", "launcher.log"));
  const launcherLog = openSync(join(install, "logs", "launcher.log"), "a");
  const say = (s) => writeSync(launcherLog, `${new Date().toISOString()} ${s}\n`);
  // No terminal (nodew.exe, .app, .desktop): the server's output goes here, next to launcher.log.
  // ponytail: rotated each time the launcher starts the server; a log that outgrows the limit
  // within one run is cut at the next restart.
  const serverLog = join(install, "logs", "server.log");

  // Started by the user: the browser opens at once on the loader, which goes to the app once it
  // answers (restarts are handled by Settings). Start at login (--background) opens nothing.
  let loader = false;
  if (!background)
    try {
      openBrowser(writeLoader(join(here, "loader.html"), join(install, "starting.html"), url));
      loader = true;
    } catch (e) {
      say(`no loader page: ${e.message}`);
    }
  waitHealthy(url, 60_000).then((ok) => {
    say(ok ? `healthy at ${url}` : `no answer from ${url} within 60 s`);
    if (ok && !background && !loader) openBrowser(url);
  });

  // Ctrl+C (when started from a terminal) reaches the server too; wait for it to exit.
  process.on("SIGINT", () => {});
  let server;
  process.on("SIGTERM", () => server?.kill("SIGTERM"));
  try {
    for (;;) {
      const pending = beginPending(install);
      const run = newest(install, shipped || undefined);
      if (!run) throw new Error(`No version in ${join(install, "versions")}`);
      if (pending && run.version !== pending.toVersion) {
        say(`${pending.action} to ${pending.toVersion}: found ${run.version} instead, going back`);
        settle(install, pending, false);
        continue;
      }
      relink(run.app);
      say(`linked ${run.version}`);
      say(`starting ${run.version}`);
      rotate(serverLog);
      const log = openSync(serverLog, "a");
      const exited = new Promise((done) => {
        server = spawn(process.execPath, ["src/main.ts", ...args], {
          cwd: join(run.app, "apps", "server"),
          stdio: ["ignore", log, log],
          windowsHide: true,
          env: {
            ...process.env,
            APP_LAUNCHER: "1",
            APP_INSTALL: "bundle",
            APP_INSTALL_DIR: install,
            ...(shipped && { APP_SHIPPED_VERSION: shipped.version }),
            // What Settings -> Start at login registers; same string as the installer's checkbox.
            APP_LAUNCH_CMD: `"${process.execPath}" "${fileURLToPath(import.meta.url)}" ${BACKGROUND}`,
          },
        });
        server.on("exit", (c) => done(c ?? 0));
      });
      if (pending) {
        // The port may have changed since the launcher started: read it again.
        const ok = await Promise.race([
          exited.then(() => false),
          waitHealthy(serverUrl(dataDir()), TRIAL_MS),
        ]);
        if (!ok) {
          server.kill();
          await exited;
        }
        settle(install, pending, ok);
        say(`${pending.action} to ${pending.toVersion} ${ok ? "ok" : "failed, going back"}`);
        if (!ok) {
          closeSync(log);
          continue;
        }
      }
      const code = await exited;
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
