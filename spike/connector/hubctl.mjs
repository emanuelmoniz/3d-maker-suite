// 6.3.0 Step 1 spike: the hub as its admin, for the spike scripts. Node stdlib only.
//   node hubctl.mjs <hub> setup | code | devices | revoke <id> | login | health
// The session cookie is kept in $HUBCTL_COOKIE (default ./hubctl.cookie).
import { readFileSync, writeFileSync } from "node:fs";

const [hubUrl, cmd, arg] = process.argv.slice(2);
const jar = process.env.HUBCTL_COOKIE ?? "hubctl.cookie";
const email = "admin@example.com";
const password = "pair-test-password";
let cookie = "";
try {
  cookie = readFileSync(jar, "utf8");
} catch {}

const hub = async (method, path, body) => {
  const res = await fetch(`${hubUrl}${path}`, {
    method,
    headers: { cookie, ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) writeFileSync(jar, (cookie = set.split(";")[0]));
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json };
};
const out = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v));

switch (cmd) {
  case "health":
    out((await hub("GET", "/api/health")).json);
    break;
  case "setup": {
    const s = await hub("POST", "/api/auth/setup", { email, displayName: "Spike", password });
    if (s.status !== 201) await hub("POST", "/api/auth/login", { email, password });
    const p = await hub("PATCH", "/api/preferences", { hubEnabled: true });
    out(`setup ${s.status}, hub on ${p.status}`);
    break;
  }
  case "code": {
    const me = (await hub("GET", "/api/auth/me")).json.user;
    out((await hub("POST", "/api/hub/pairing-codes", { userId: me.id })).json.code);
    break;
  }
  case "devices":
    out(
      (await hub("GET", "/api/hub/devices")).json.map((d) => ({
        id: d.id,
        name: d.name,
        online: d.online,
        os: d.os,
        connectorVersion: d.connectorVersion,
        outdated: d.outdated,
        updateFailed: d.updateFailed,
      })),
    );
    break;
  case "revoke":
    out((await hub("DELETE", `/api/hub/devices/${arg}`)).status);
    break;
  case "login": {
    // A fresh sign-in from this address, without the jar: is it locked out?
    const res = await fetch(`${hubUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    out(res.status);
    break;
  }
  default:
    console.error("usage: hubctl.mjs <hub> setup|code|devices|revoke <id>|login|health");
    process.exit(2);
}
