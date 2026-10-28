// Pairs an installed connector with a running hub and checks the whole path (ADR-0014): pairing
// through the connector's status page, online in Hub management, a rename arriving over the event
// stream, and a revoke sending the connector back to its pair form. Node stdlib only.
// The hub needs no users yet (it creates the first admin, from this PC) or the admin below.
//   node scripts/pair-test.mjs [--hub http://127.0.0.1:4300] [--connector http://127.0.0.1:4301]
//     [--email admin@example.com] [--password pair-test-password]
import { request } from "node:http";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    hub: { type: "string", default: "http://127.0.0.1:4300" },
    connector: { type: "string", default: "http://127.0.0.1:4301" },
    email: { type: "string", default: "admin@example.com" },
    password: { type: "string", default: "pair-test-password" },
  },
});
const step = (s) => console.log(`- ${s}`);
const fail = (s) => {
  console.error(`FAILED: ${s}`);
  process.exit(1);
};
const until = async (what, ok, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500)))
    try {
      const v = await ok();
      if (v) return v;
    } catch {} // not up yet
  fail(`${what} (waited ${ms / 1000} s)`);
};

// The hub, as the admin.
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

// The status page through node:http: fetch can't send an Origin, and the page wants one on a POST.
const page = (method, path, form) =>
  new Promise((done, reject) => {
    const url = new URL(path, a.connector);
    const body = form && new URLSearchParams(form).toString();
    const req = request(
      url,
      {
        method,
        headers: {
          origin: url.origin,
          ...(body && { "content-type": "application/x-www-form-urlencoded" }),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => done({ status: res.statusCode, text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });

const health = await until(`hub at ${a.hub}`, async () => (await hub("GET", "/api/health")).json);
step(`hub ${health.version} at ${a.hub}`);
const setup = await hub("POST", "/api/auth/setup", {
  email: a.email,
  displayName: "Pair test",
  password: a.password,
});
if (setup.status !== 201) {
  const login = await hub("POST", "/api/auth/login", { email: a.email, password: a.password });
  if (login.status !== 200) fail(`no first admin made, and logging in as ${a.email} failed`);
}
const me = (await hub("GET", "/api/auth/me")).json.user;
step(`signed in as ${me.email} (${me.role})`);
if ((await hub("PATCH", "/api/preferences", { hubEnabled: true })).status !== 200)
  fail("could not turn the hub on");
const { code } = (await hub("POST", "/api/hub/pairing-codes", { userId: me.id })).json;
step(`hub on, pairing code ${code}`);

const connector = await until(`connector at ${a.connector}`, async () =>
  JSON.parse((await page("GET", "/api/health")).text),
);
step(`connector ${connector.version} at ${a.connector}`);
const paired = await page("POST", "/pair", { hub: a.hub, code, name: "Pair test" });
if (paired.status !== 303) fail(`pairing answered ${paired.status}`);

const device = await until("the device online in Hub management", async () =>
  (await hub("GET", "/api/hub/devices")).json.find((d) => d.online),
);
step(`online: ${device.name}, ${device.os}, connector ${device.connectorVersion}`);
if (device.connectorVersion !== connector.version)
  fail(`the hub lists ${device.connectorVersion}, the connector says ${connector.version}`);

await hub("PATCH", `/api/hub/devices/${device.id}`, { name: "Renamed by the hub" });
await until("the rename on the status page", async () =>
  (await page("GET", "/")).text.includes("Renamed by the hub"),
);
step("rename arrived over the event stream");

await hub("DELETE", `/api/hub/devices/${device.id}`);
await until("the pair form after the revoke", async () =>
  (await page("GET", "/")).text.includes("removed from the hub"),
);
step("revoked: the connector shows the pair form again");
console.log("Pairing works.");
