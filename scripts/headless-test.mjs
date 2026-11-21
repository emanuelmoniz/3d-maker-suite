// Checks a headless connector (ADR-0024) against a running hub: it paired from what its start was
// given, comes back after a crash, stays down for a stop it was asked for, and follows the hub to a
// newer version. Linux: `install.sh --headless`, a systemd user service (Plan 6.3.0 Step 3). Windows:
// the installer's `/HEADLESS`, a scheduled task (Step 3b), where a killed launcher stays down until
// the task is run again (the task can't restart it). Node stdlib only.
// The hub needs no users yet (this makes the first admin) or the admin below. Steps, in order:
//   node scripts/headless-test.mjs code   [--hub http://127.0.0.1:4310]
//     prints a 24-hour pairing code for a headless connector
//   node scripts/headless-test.mjs check  [--hub ...] [--name ci-headless]
//     it is online as a headless connector; its program killed, it comes back as the same device; its
//     launcher killed, systemd brings it back (Windows: it stays down, then the task starts it); Stop
//     connector and the service's or task's own stop keep it down; it starts again
//   node scripts/headless-test.mjs update --version 6.2.100 [--hub ...] [--name ...]
//     it is on that version (the hub's), online, still the same device
// Also --connector http://127.0.0.1:4301, --service 3d-maker-suite-connector (Windows: the task,
// "3D Maker Suite Connector"), --email, --password.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const {
  positionals: [command],
  values: a,
} = parseArgs({
  allowPositionals: true,
  options: {
    hub: { type: "string", default: "http://127.0.0.1:4310" },
    connector: { type: "string", default: "http://127.0.0.1:4301" },
    name: { type: "string", default: "ci-headless" },
    service: { type: "string" },
    version: { type: "string" },
    email: { type: "string", default: "admin@example.com" },
    password: { type: "string", default: "pair-test-password" },
  },
});
const windows = process.platform === "win32";
a.service ??= windows ? "3D Maker Suite Connector" : "3d-maker-suite-connector";
const install = windows
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Programs", a.service)
  : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), a.service, "install");
const step = (s) => console.error(`- ${s}`);
const fail = (s) => {
  console.error(`FAILED: ${s}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, ok, ms = 60_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500))
    try {
      const v = await ok();
      if (v) return v;
    } catch {} // not up yet
  fail(`${what} (waited ${ms / 1000} s)`);
};

let cookie = "";
const hub = async (method, path, body) => {
  const res = await fetch(`${a.hub}${path}`, {
    method,
    headers: { cookie, ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
const signIn = async () => {
  await until(`hub at ${a.hub}`, async () => (await hub("GET", "/api/health")).json);
  const setup = await hub("POST", "/api/auth/setup", {
    email: a.email,
    displayName: "Headless test",
    password: a.password,
  });
  if (setup.status !== 201) {
    const login = await hub("POST", "/api/auth/login", { email: a.email, password: a.password });
    if (login.status !== 200) fail(`no first admin made, and logging in as ${a.email} failed`);
  }
  if ((await hub("PATCH", "/api/preferences", { hubEnabled: true })).status !== 200)
    fail("could not turn the hub on");
  return (await hub("GET", "/api/auth/me")).json.user;
};
const devices = async () => (await hub("GET", "/api/hub/devices")).json;
const mine = async () => (await devices()).find((d) => d.name === a.name);

const connectorUp = async () => {
  try {
    return (await fetch(`${a.connector}/api/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};
const connectorDown = async (what, ms = 20_000) =>
  until(what, async () => !(await connectorUp()), ms);
const connectorUpAgain = async (what, ms = 60_000) => until(what, connectorUp, ms);
const sh = (cmd, ...args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const ps = (command) => sh("powershell.exe", "-NoProfile", "-Command", command);
const quotePs = (s) => `'${s.replaceAll("'", "''")}'`;
/** Kills the program (`src/main.ts`) or the launcher (`launcher.mjs`) with SIGKILL or Stop-Process -Force. */
const kill = (what) => {
  try {
    if (windows) {
      const n = ps(
        `$p = @(Get-CimInstance Win32_Process -Filter "Name='nodew.exe'" | Where-Object { $_.ExecutablePath -like ${quotePs(`${install}\\*`)} -and $_.CommandLine -like ${quotePs(`*${what}*`)} }); $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; $p.Count`,
      );
      if (n === "0") throw new Error("none");
    } else
      sh(
        "pkill",
        "-9",
        "-f",
        what === "src/main.ts" ? `^${install}/node/bin/node src/main.ts` : `${install}/${what}`,
      );
  } catch {
    fail(`nothing to kill matching ${what}`);
  }
};
/** systemd's state, or the task's (Running, Ready). */
const active = () => {
  try {
    return windows
      ? ps(`(Get-ScheduledTask -TaskPath '\\' -TaskName ${quotePs(a.service)}).State`)
      : sh("systemctl", "--user", "is-active", a.service);
  } catch (e) {
    return String(e.stdout ?? "").trim() || "failed";
  }
};
const running = () => (windows ? active() === "Running" : active() === "active");
/** The service's or the task's own start, stop and restart. */
const supervisor = (verb) => {
  if (!windows) return sh("systemctl", "--user", verb, a.service);
  const task = `-TaskPath '\\' -TaskName ${quotePs(a.service)}`;
  if (verb !== "start") ps(`Stop-ScheduledTask ${task}`);
  if (verb !== "stop") ps(`Start-ScheduledTask ${task}`);
};
const supervisorName = windows ? "the task" : "systemctl --user";
/** The page's Stop connector, as its form does: a POST from its own origin. */
const stopFromPage = async () => {
  const res = await fetch(`${a.connector}/stop`, {
    method: "POST",
    headers: { origin: new URL(a.connector).origin },
  });
  if (!res.ok) fail(`Stop connector answered ${res.status}`);
};

if (command === "code") {
  const me = await signIn();
  const made = await hub("POST", "/api/hub/pairing-codes", { userId: me.id, kind: "headless" });
  if (made.status !== 201) fail(`the hub answered ${made.status} for a pairing code`);
  console.log(made.json.code);
} else if (command === "check") {
  await signIn();
  const first = await until(`${a.name} online in Hub management`, async () => {
    const d = await mine();
    return d?.online && d;
  });
  if (first.install !== "headless") fail(`the hub lists its install as ${first.install}`);
  step(`online: ${first.name}, ${first.os}, connector ${first.connectorVersion}, ${first.install}`);
  const same = async (what) => {
    const d = await until(what, async () => {
      const found = await mine();
      return found?.online && found;
    });
    if (d.id !== first.id) fail(`${what}: a new device ${d.id}, not ${first.id}`);
    if ((await devices()).length !== 1) fail(`${what}: more than one device listed`);
  };
  // A crash: the program killed (the headless launcher starts it again), and the launcher itself.
  kill("src/main.ts");
  await connectorDown("the connector to go down after its program was killed");
  await connectorUpAgain("the connector back after its program was killed");
  await same("online again after its program was killed");
  step("program killed: back, same device");
  kill("launcher.mjs");
  await connectorDown("the connector to go down after its launcher was killed");
  if (windows) {
    // The task's restart on failure doesn't react to an exit code (Step 3b's spike): it stays down.
    await sleep(15_000);
    if (await connectorUp()) fail("something started it again after its launcher was killed");
    if (running()) fail("the task still runs after its launcher was killed");
    supervisor("start");
  }
  await connectorUpAgain("the connector back after its launcher was killed");
  await same("online again after its launcher was killed");
  step(
    windows
      ? "launcher killed: down until the task runs again"
      : "launcher killed: back, same device",
  );

  // Stops that were asked for stay stopped.
  await stopFromPage();
  await connectorDown("the connector to stop on Stop connector");
  await sleep(15_000);
  if (await connectorUp()) fail(`${supervisorName} started it again after Stop connector`);
  if (running()) fail(`${supervisorName} still lists it as running after a clean stop`);
  step("Stop connector: stays stopped");
  supervisor("restart");
  await connectorUpAgain(`the connector after a restart of ${supervisorName}`);
  supervisor("stop");
  await connectorDown(`the connector to stop when ${supervisorName} stops`);
  await sleep(10_000);
  if (await connectorUp()) fail(`it came back after ${supervisorName} stopped`);
  step(`${supervisorName} stop: stays stopped`);
  supervisor("start");
  await connectorUpAgain(`the connector after ${supervisorName} started`);
  await same(`online after ${supervisorName} started`);
  console.log("Headless install works.");
} else if (command === "update") {
  if (!a.version) fail("--version is needed");
  await signIn();
  const device = await until(`${a.name} listed`, mine);
  const on = await until(
    `the connector on ${a.version}`,
    async () => {
      const res = await fetch(`${a.connector}/api/health`, { signal: AbortSignal.timeout(1500) });
      const h = await res.json();
      return h.version === a.version && h;
    },
    180_000,
  );
  const now = await until(`${a.name} online on ${a.version} in Hub management`, async () => {
    const d = await mine();
    return d?.online && d.connectorVersion === a.version && d;
  });
  if (now.id !== device.id) fail("the update made a new device");
  step(`connector ${on.version}, online, outdated: ${now.outdated}, same device`);
  console.log("The connector followed the hub.");
} else {
  console.error("usage: headless-test.mjs code | check | update --version X");
  process.exit(2);
}
