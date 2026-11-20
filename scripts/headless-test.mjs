// Checks a connector installed with `install.sh --headless` (ADR-0024, Plan 6.3.0 Step 3) against a
// running hub: it paired from the service's Environment=, comes back after a crash, stays down for
// a stop it was asked for, and follows the hub to a newer version. Linux with systemd; Node stdlib only.
// The hub needs no users yet (this makes the first admin) or the admin below. Steps, in order:
//   node scripts/headless-test.mjs code   [--hub http://127.0.0.1:4310]
//     prints a 24-hour pairing code for a headless connector, for `install.sh --headless --pairing-code`
//   node scripts/headless-test.mjs check  [--hub ...] [--name ci-headless]
//     it is online as a headless connector; killed (the program, then the launcher) it comes back as
//     the same device; Stop connector and `systemctl --user stop` keep it down; it starts again
//   node scripts/headless-test.mjs update --version 6.2.100 [--hub ...] [--name ...]
//     it is on that version (the hub's), online, still the same device
// Also --connector http://127.0.0.1:4301, --service 3d-maker-suite-connector, --email, --password.
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
    service: { type: "string", default: "3d-maker-suite-connector" },
    version: { type: "string" },
    email: { type: "string", default: "admin@example.com" },
    password: { type: "string", default: "pair-test-password" },
  },
});
const install = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  a.service,
  "install",
);
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
const kill = (pattern) => {
  try {
    sh("pkill", "-9", "-f", pattern);
  } catch {
    fail(`nothing to kill matching ${pattern}`);
  }
};
const active = () => {
  try {
    return sh("systemctl", "--user", "is-active", a.service);
  } catch (e) {
    return String(e.stdout ?? "").trim() || "failed";
  }
};
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
  const program = `^${install}/node/bin/node src/main.ts`;

  // A crash: the program killed by a signal (the launcher then exits non-zero), and the launcher itself.
  kill(program);
  await connectorDown("the connector to go down after its program was killed");
  await connectorUpAgain("the connector back after its program was killed");
  await same("online again after its program was killed");
  step("killed with SIGKILL: back, same device");
  kill(`${install}/launcher.mjs`);
  await connectorDown("the connector to go down after its launcher was killed");
  await connectorUpAgain("the connector back after its launcher was killed");
  await same("online again after its launcher was killed");
  step("launcher killed with SIGKILL: back, same device");

  // Stops that were asked for stay stopped.
  await stopFromPage();
  await connectorDown("the connector to stop on Stop connector");
  await sleep(15_000);
  if (await connectorUp()) fail("the service started it again after Stop connector");
  if (active() === "active") fail("systemd still lists the service as active after a clean stop");
  step("Stop connector: stays stopped");
  sh("systemctl", "--user", "restart", a.service);
  await connectorUpAgain("the connector after systemctl restart");
  sh("systemctl", "--user", "stop", a.service);
  await connectorDown("the connector to stop on systemctl stop");
  await sleep(10_000);
  if (await connectorUp()) fail("it came back after systemctl --user stop");
  step("systemctl --user stop: stays stopped");
  sh("systemctl", "--user", "start", a.service);
  await connectorUpAgain("the connector after systemctl start");
  await same("online after systemctl start");
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
