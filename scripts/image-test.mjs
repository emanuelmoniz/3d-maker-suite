// The container images' checks that need the app's API (ADR-0024). The workflow .github/workflows/images.yml
// starts the images with docker and calls these, on x64 and on ARM64. Node stdlib only.
// The hub is the app image, started with host networking, so this machine's loopback reaches it and it needs
// no users yet (this makes the first admin) or the admin below.
//   node scripts/image-test.mjs code   [--hub http://127.0.0.1:4310]
//     prints a 24-hour pairing code for a connector with no screen
//   node scripts/image-test.mjs online [--hub ...] [--name ci-docker] [--id <device id>]
//     the connector is online in Hub management as a Docker install; with --id, the same device and the only
//     one (a restart and a new container on the same volume keep the pairing). Prints the device's id.
//   node scripts/image-test.mjs owner  [--hub ...] --root /projects/files
//     the app makes a project folder in that root and uploads a file into it; prints their relative paths
//   node scripts/image-test.mjs slicer [--hub ...] --arch arm64|x64
//     a slicer can't be installed on this server on Linux ARM: it says so (supported: false, no releases, the
//     install refused), and elsewhere it says it can
// Also --email, --password.
import { parseArgs } from "node:util";

const {
  positionals: [command],
  values: a,
} = parseArgs({
  allowPositionals: true,
  options: {
    hub: { type: "string", default: "http://127.0.0.1:4310" },
    name: { type: "string", default: "ci-docker" },
    id: { type: "string" },
    root: { type: "string" },
    arch: { type: "string" },
    email: { type: "string", default: "admin@example.com" },
    password: { type: "string", default: "image-test-password" },
  },
});
const step = (s) => console.error(`- ${s}`);
const fail = (s) => {
  console.error(`FAILED: ${s}`);
  process.exit(1);
};
const until = async (what, ok, ms = 90_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500)))
    try {
      const v = await ok();
      if (v) return v;
    } catch {} // not up yet
  fail(`${what} (waited ${ms / 1000} s)`);
};

let cookie = "";
const hub = async (method, path, body, raw) => {
  const res = await fetch(`${a.hub}${path}`, {
    method,
    headers: {
      cookie,
      ...(raw
        ? { "content-type": "application/octet-stream" }
        : body && { "content-type": "application/json" }),
    },
    body: raw ?? (body && JSON.stringify(body)),
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
    displayName: "Image test",
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

if (command === "code") {
  const me = await signIn();
  const made = await hub("POST", "/api/hub/pairing-codes", { userId: me.id, kind: "headless" });
  if (made.status !== 201) fail(`the hub answered ${made.status} for a pairing code`);
  console.log(made.json.code);
} else if (command === "online") {
  await signIn();
  const device = await until(`${a.name} online in Hub management`, async () => {
    const found = (await hub("GET", "/api/hub/devices")).json.find((d) => d.name === a.name);
    return found?.online && found;
  });
  if (device.install !== "docker") fail(`the hub lists its install as ${device.install}`);
  if (a.id) {
    if (device.id !== a.id) fail(`a new device ${device.id}, not ${a.id}`);
    const all = (await hub("GET", "/api/hub/devices")).json;
    if (all.length !== 1) fail(`${all.length} devices listed, expected one`);
  }
  step(`online: ${device.name}, ${device.os}, connector ${device.connectorVersion}, docker`);
  console.log(device.id);
} else if (command === "owner") {
  if (!a.root) fail("--root is needed");
  await signIn();
  const root = await hub("POST", "/api/roots", { path: a.root });
  if (root.status !== 201) fail(`adding the root ${a.root} answered ${root.status}`);
  const made = await hub("POST", "/api/projects", {
    name: "Owner test",
    createFolder: true,
    rootId: root.json.id,
  });
  if (made.status !== 201) fail(`making the project answered ${made.status}`);
  const project = (await hub("GET", `/api/projects/${made.json.id}`)).json;
  const up = await hub(
    "PUT",
    `/api/projects/${made.json.id}/files/content?path=hello.txt`,
    undefined,
    "hello",
  );
  if (up.status !== 201) fail(`the upload answered ${up.status}`);
  console.log(JSON.stringify({ folder: project.folder, file: `${project.folder}/hello.txt` }));
} else if (command === "slicer") {
  if (!a.arch) fail("--arch is needed");
  await signIn();
  const adapters = (await hub("GET", "/api/integrations/adapters")).json;
  const server = adapters.filter((x) => x.kind === "server" && x.managed);
  if (!server.length) fail("no managed slicer adapter listed");
  const arm = a.arch === "arm64";
  for (const adapter of server) {
    if (adapter.managed.supported !== !arm)
      fail(`${adapter.id}: supported is ${adapter.managed.supported} on ${a.arch}`);
  }
  if (arm) {
    const made = await hub("POST", "/api/integrations", { adapterId: server[0].id });
    if (made.status !== 201) fail(`adding ${server[0].id} answered ${made.status}`);
    const base = `/api/integrations/${made.json.id}/slicer`;
    const releases = await hub("GET", `${base}/releases`);
    if (releases.status !== 200 || releases.json.length) fail("releases were listed on ARM");
    const install = await hub("POST", `${base}/install`, { tag: "v1.0.0" });
    if (install.status !== 409 || install.json?.error?.code !== "slicing_unsupported")
      fail(`the install answered ${install.status} ${JSON.stringify(install.json)}`);
    step(`${server[0].id}: refused on ${a.arch} (slicing_unsupported)`);
  } else step(`slicers can be installed on ${a.arch}`);
  console.log("ok");
} else {
  console.error("usage: image-test.mjs code | online | owner --root DIR | slicer --arch ARCH");
  process.exit(2);
}
