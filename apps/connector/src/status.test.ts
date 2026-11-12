import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createLink, type Link, PairError } from "./hub.ts";
import { openStore } from "./state.ts";
import { allowed, createStatusPage, t } from "./status.ts";

let dir: string;
let close: () => void;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "status-"));
});
afterEach(() => {
  close?.();
  rmSync(dir, { recursive: true, force: true });
});

/** The page on a free port; `call` sends any Host/Origin (fetch won't set Host). */
const serve = async (fake: Partial<Link> = {}) => {
  const store = openStore(dir);
  const link = { ...createLink({ store, version: "1.0.0", os: "x" }), ...fake };
  const opened: string[] = [];
  const exits: number[] = [];
  const updater = { state: () => ({ failed: undefined, hubOlder: false, error: undefined }) };
  const syncDir = join(dir, "sync");
  const page = createStatusPage({
    link,
    store,
    updater,
    version: "1.0.0",
    syncDir,
    open: (d) => opened.push(d),
    exit: (c) => exits.push(c),
  });
  await new Promise<void>((r) => page.listen(0, "127.0.0.1", r));
  const { port } = page.address() as AddressInfo;
  close = () => page.close();
  const call = (method: string, path: string, headers: Record<string, string> = {}, body = "") =>
    new Promise<{
      status: number;
      body: string;
      location?: string;
      headers: import("node:http").IncomingHttpHeaders;
    }>((done, fail) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: { host: `127.0.0.1:${port}`, ...headers },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            done({
              status: res.statusCode ?? 0,
              body: text,
              location: res.headers.location,
              headers: res.headers,
            }),
          );
        },
      );
      req.on("error", fail);
      req.end(body);
    });
  return { port, call, opened, exits, syncDir, store, origin: () => `http://127.0.0.1:${port}` };
};

it("only answers its own host, and POSTs only from its own page", () => {
  const h = { host: "127.0.0.1:4301" };
  expect(allowed("GET", h, 4301)).toBe(true);
  expect(allowed("GET", { host: "localhost:4301" }, 4301)).toBe(true);
  expect(allowed("GET", { host: "evil.example:4301" }, 4301)).toBe(false);
  expect(allowed("POST", h, 4301)).toBe(false);
  expect(allowed("POST", { ...h, origin: "https://evil.example" }, 4301)).toBe(false);
  expect(allowed("POST", { ...h, origin: "http://127.0.0.1:4301" }, 4301)).toBe(true);
});

it("answers health, shows the pair form, and refuses a cross-site pair", async () => {
  const s = await serve();
  const health = await s.call("GET", "/api/health");
  expect(JSON.parse(health.body)).toEqual({ status: "ok", version: "1.0.0" });
  expect((await s.call("GET", "/", { host: "attacker.example" })).status).toBe(403);

  const home = await s.call("GET", "/");
  expect(home.body).toContain(t("connector:pair.title"));
  expect(home.body).not.toContain('http-equiv="refresh"');

  const form = "hub=http%3A%2F%2F127.0.0.1%3A1&code=AAAA-AAAA&name=WS";
  const type = { "content-type": "application/x-www-form-urlencoded" };
  expect(
    (await s.call("POST", "/pair", { ...type, origin: "https://evil.example" }, form)).status,
  ).toBe(403);
  // From the page: the hub isn't there, so the form comes back with the error and the typed values.
  const bad = await s.call("POST", "/pair", { ...type, origin: s.origin() }, form);
  expect(bad.status).toBe(400);
  expect(bad.body).toContain(t("connector:pair.errors.unreachable"));
  expect(bad.body).toContain('value="WS"');
});

it("shows the hub user it acts as, and none when the hub names none", async () => {
  const online = { state: () => ({ status: "online" as const, error: undefined }) };
  const named = await serve({ ...online, userName: () => "<Zoë>" });
  const { body } = await named.call("GET", "/local");
  const row = `<dt>${t("connector:status.user")}</dt>`;
  expect(body).toContain(`${row}<dd>&#60;Zoë&#62;<br><a href="/user">`);
  close();

  const none = await serve({ ...online, userName: () => undefined });
  const empty = (await none.call("GET", "/local")).body;
  expect(empty).not.toContain(row);
  expect(empty).not.toContain('href="/user"');
});

it("changes the user only with a code, only from its own page, after confirming", async () => {
  const changes: [string, string][] = [];
  const s = await serve({
    checkUser: async (code) => {
      if (code !== 'AB"CD') throw new PairError("invalidCode");
      return { userName: "<Ben>", currentUserName: "Ana", projects: 12 };
    },
    changeUser: async (code, projects) => {
      changes.push([code, projects]);
      return { userName: "<Ben>", moved: 12 };
    },
  });
  // Unpaired: nothing to change.
  expect((await s.call("GET", "/user")).location).toBe("/local");
  s.store.set({ hubUrl: "http://hub.example", deviceId: "d", token: "t" });

  const form = await s.call("GET", "/user");
  expect(form.body).toContain(t("connector:user.stayHint"));
  expect(form.body).not.toContain('http-equiv="refresh"'); // would wipe the code being typed

  const type = { "content-type": "application/x-www-form-urlencoded" };
  const post = (path: string, body: string, origin = s.origin()) =>
    s.call("POST", path, { ...type, origin }, body);
  const stay = "code=AB%22CD&projects=stay";
  expect((await post("/user", stay, "https://evil.example")).status).toBe(403);
  expect((await post("/user/confirm", stay, "https://evil.example")).status).toBe(403);

  const confirm = await post("/user", stay);
  expect(confirm.body).toContain(t("connector:user.confirmTitle", { name: "<Ben>" }));
  expect(confirm.body).toContain(t("connector:user.from", { from: "Ana", to: "<Ben>" }));
  expect(confirm.body).toContain(t("connector:user.willStay", { count: 12 }));
  expect(confirm.body).toContain('name="code" value="AB&#34;CD"');
  expect(confirm.body).toContain('name="projects" value="stay"');
  expect(changes).toEqual([]); // nothing yet

  const done = await post("/user/confirm", stay);
  expect(done.status).toBe(200);
  expect(done.body).toContain(t("connector:user.done", { name: "<Ben>" }));
  expect(changes).toEqual([['AB"CD', "stay"]]);

  // Anything but "stay" moves, the default the form shows.
  expect((await post("/user", "code=AB%22CD&projects=x")).body).toContain(
    t("connector:user.willMove", { count: 12, name: "<Ben>" }),
  );

  // A wrong code comes back to the form, with the choice kept.
  const wrong = await post("/user", "code=NOPE&projects=stay");
  expect(wrong.status).toBe(400);
  expect(wrong.body).toContain(t("connector:user.errors.invalidCode"));
  expect(wrong.body).toContain('value="stay" aria-describedby="stay-hint" checked');
});

it.each([
  ["unreachable", "connector:user.errors.unreachable"],
  ["tooManyAttempts", "connector:user.errors.tooManyAttempts"],
  ["hubOff", "connector:user.errors.hubOff"],
] as const)("says so when the hub answers a user change with %s", async (code, key) => {
  const s = await serve({
    changeUser: async () => {
      throw new PairError(code);
    },
  });
  s.store.set({ hubUrl: "http://hub.example", deviceId: "d", token: "t" });
  const res = await s.call(
    "POST",
    "/user/confirm",
    { "content-type": "application/x-www-form-urlencoded", origin: s.origin() },
    "code=ABCD",
  );
  expect(res.status).toBe(400);
  expect(res.body).toContain(t(key));
});

it("tells only its hub's page which device it is", async () => {
  const s = await serve();
  const hub = "http://hub.example:3000";
  expect((await s.call("GET", "/api/whoami", { origin: hub })).status).toBe(404); // not paired
  s.store.set({ hubUrl: `${hub}/`, deviceId: "dev-1", token: "t" });

  const mine = await s.call("GET", "/api/whoami", { origin: hub });
  expect(JSON.parse(mine.body)).toEqual({ id: "dev-1" });
  expect(mine.headers["access-control-allow-origin"]).toBe(hub);
  // Another origin gets the answer too, but no CORS header: its browser can't read it.
  const other = await s.call("GET", "/api/whoami", { origin: "https://evil.example" });
  expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  // The Host check still holds (DNS rebinding), for the preflight too.
  expect((await s.call("GET", "/api/whoami", { host: "evil.example:4301" })).status).toBe(403);
  expect(
    (await s.call("OPTIONS", "/api/whoami", { host: "evil.example:4301", origin: hub })).status,
  ).toBe(403);
  const pre = await s.call("OPTIONS", "/api/whoami", {
    origin: hub,
    "access-control-request-private-network": "true",
  });
  expect(pre.status).toBe(204);
  expect(pre.headers["access-control-allow-private-network"]).toBe("true");
  // Still no other route for another origin's preflight.
  expect((await s.call("OPTIONS", "/pair", { origin: hub })).status).toBe(403);
});

it("opens the machine's page on the hub when paired and online, else the local page", async () => {
  let status: ReturnType<Link["state"]>["status"] = "online";
  const s = await serve({ state: () => ({ status, error: undefined }) });
  s.store.set({ hubUrl: "https://hub.example/maker", deviceId: "dev 1", token: "t" });
  expect(await s.call("GET", "/")).toMatchObject({
    status: 303,
    location: "https://hub.example/maker/hub/devices/dev%201",
  });
  const local = (await s.call("GET", "/local")).body;
  expect(local).toContain(
    `<a href="https://hub.example/maker/hub/devices/dev%201">${t("connector:status.openHub")}</a>`,
  );
  expect(local).toContain('content="5; url=/local"');
  expect(local).not.toContain('action="/sync/mode"');
  expect(local).not.toContain('action="/slicer"');
  // Settings are on the hub now.
  const form = { "content-type": "application/x-www-form-urlencoded", origin: s.origin() };
  expect((await s.call("POST", "/sync/mode", form, "mode=all")).status).toBe(404);
  expect((await s.call("POST", "/slicer", form, "slicer=")).status).toBe(404);

  for (const down of ["offline", "hubOff"] as const) {
    status = down;
    expect(await s.call("GET", "/")).toMatchObject({ status: 303, location: "/local" });
  }
  status = "offline";
  const off = (await s.call("GET", "/local")).body;
  expect(off).not.toContain(t("connector:status.openHub"));
  expect(off).toContain(t("connector:status.hubUnreachable", { hub: "hub.example" }));
  // A stream still connecting gets a moment, then the hub.
  status = "connecting";
  setTimeout(() => {
    status = "online";
  }, 200);
  expect((await s.call("GET", "/")).location).toBe("https://hub.example/maker/hub/devices/dev%201");
});

it("creates and opens the sync folder", async () => {
  const s = await serve();
  const res = await s.call("POST", "/open-folder", { origin: s.origin() });
  expect(res).toMatchObject({ status: 303, location: "/local" });
  expect(s.opened).toEqual([s.syncDir]);
});

it("restarts, and stops only once confirmed and only from its own page", async () => {
  const s = await serve();
  expect((await s.call("POST", "/restart", { origin: "https://evil.example" })).status).toBe(403);
  const restart = await s.call("POST", "/restart", { origin: s.origin() });
  expect(restart.body).toContain(t("connector:restarting"));
  expect(restart.body).toContain('content="5; url=/local"');

  const ask = await s.call("GET", "/stop");
  expect(ask.body).toContain(t("connector:stop.body"));
  expect(s.exits).toEqual([75]);
  const stop = await s.call("POST", "/stop", { origin: s.origin() });
  expect(stop.body).toContain(t("connector:stopped"));
  expect(s.exits).toEqual([75, 0]);
});

it("offers restart and stop on the pair screen, and unpairs only once confirmed", async () => {
  const s = await serve();
  const pair = await s.call("GET", "/");
  expect(pair.body).toContain('action="/restart"');
  expect(pair.body).toContain('action="/stop"');
  expect(pair.body).not.toContain('action="/unpair"');

  s.store.set({ hubUrl: "https://hub.example", deviceId: "d1", deviceName: "Desk", token: "tok" });
  expect((await s.call("POST", "/unpair", { origin: "https://evil.example" })).status).toBe(403);
  expect(s.store.token()).toBe("tok");
  expect((await s.call("GET", "/unpair")).body).toContain(t("connector:unpair.body"));
  expect(s.store.token()).toBe("tok");
  expect(await s.call("POST", "/unpair", { origin: s.origin() })).toMatchObject({ status: 303 });
  expect(s.store.token()).toBeUndefined();
  expect(s.store.get()).toEqual({ hubUrl: "https://hub.example", deviceName: "Desk" });
});

it("shares folders on a page of its own, only from its own page", async () => {
  const s = await serve();
  const page = await s.call("GET", "/folders");
  expect(page.body).toContain(t("connector:folders.intro"));
  expect(page.body).not.toContain('http-equiv="refresh"');

  const type = { "content-type": "application/x-www-form-urlencoded" };
  const form = (k: string, v: string) => new URLSearchParams({ [k]: v }).toString();
  const add = (path: string, origin = s.origin()) =>
    s.call("POST", "/folders/add", { ...type, origin }, form("path", path));
  // Not seeded yet: the hub's roots come first.
  expect((await add(dir)).body).toContain(t("connector:folders.errors.waiting"));
  s.store.set({ folders: [] });
  expect((await add(dir, "https://evil.example")).status).toBe(403);
  expect(await add(dir)).toMatchObject({ status: 303, location: "/folders" });
  expect(s.store.get().folders).toEqual([realpathSync(dir)]);
  const bad = await add("relative/path");
  expect(bad.status).toBe(400);
  expect(bad.body).toContain(t("connector:folders.errors.notAbsolute"));
  expect(bad.body).toContain('value="relative/path"');
  // No roots list from the hub yet: removing waits for it.
  const remove = await s.call(
    "POST",
    "/folders/remove",
    { ...type, origin: s.origin() },
    form("folder", realpathSync(dir)),
  );
  expect(remove.body).toContain(t("connector:folders.errors.waiting"));
});

it("escapes what it fills in", () => {
  expect(t("connector:status.lastError", { error: "<b>&" })).toBe("Last error: &#60;b&#62;&#38;");
});
