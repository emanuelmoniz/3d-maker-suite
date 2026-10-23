// The installed app's launcher (ADR-0011): runs the newest version in versions/ (on macOS also the
// one inside the .app), recreating its links first, and starts it again when it exits with RESTART.
// Node stdlib only. It ships with the installer and doesn't change with updates, so keep it small.
// node launcher.mjs [server args, e.g. --port 4400]
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  mkdirSync(join(install, "logs"), { recursive: true });
  // No terminal (nodew.exe, .app, .desktop): the server's output goes here.
  const log = openSync(join(install, "logs", "launcher.log"), "w");
  const say = (s) => writeSync(log, `${new Date().toISOString()} ${s}\n`);

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
          },
        });
        server.on("exit", (c) => done(c ?? 0));
      });
      say(`exited with ${code}`);
      if (code !== RESTART) process.exit(code);
    }
  } catch (e) {
    say(e.stack);
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
