// Starting headless (ADR-0024): options from flags and the environment, and pairing from them
// against a real hub (the server's buildApp on a free port).
import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_ROLE_IDS } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { VERSION } from "@3d-maker-suite/server/src/updates/updates.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testTimeout } from "../../../test-timeout.ts";
import { createLink, HubAddressError, PairError } from "./hub.ts";
import { followHubAtStart, openSpentCodes, pairAtStart, startOptions } from "./start.ts";
import { openStore } from "./state.ts";
import { tcpProxy } from "./testProxy.ts";

describe("startOptions", () => {
  it("reads the flags first, then the environment", () => {
    const env = {
      CONNECTOR_HUB_URL: "http://env:4300",
      CONNECTOR_PAIRING_CODE: "ENVC-ODE1",
      CONNECTOR_NAME: "From env",
    };
    expect(startOptions([], env).pair).toEqual({
      hubUrl: "http://env:4300",
      code: "ENVC-ODE1",
      name: "From env",
    });
    const flags = ["--hub-url", "http://flag:4300", "--pairing-code=FLAG-CODE", "--name", "NAS"];
    expect(startOptions(flags, env).pair).toEqual({
      hubUrl: "http://flag:4300",
      code: "FLAG-CODE",
      name: "NAS",
    });
    // The launcher's own flag and unknown ones pass through untouched.
    expect(startOptions(["--background", "--port", "4400"], {}).pair).toBeUndefined();
  });

  it("names the machine after its host by default, and pairs only with both a hub and a code", () => {
    expect(
      startOptions([], { CONNECTOR_HUB_URL: "http://h", CONNECTOR_PAIRING_CODE: "C" }).pair,
    ).toMatchObject({ name: hostname().slice(0, 100) });
    expect(startOptions([], { CONNECTOR_HUB_URL: "http://h" }).pair).toBeUndefined();
    // Alone it still moves a paired connector (6.3.0 Step 7b).
    expect(startOptions([], { CONNECTOR_HUB_URL: "http://h" }).hubUrl).toBe("http://h");
    expect(
      startOptions([], { CONNECTOR_PAIRING_CODE: "C", CONNECTOR_HUB_URL: " " }).pair,
    ).toBeUndefined();
  });

  it("tells the install kind: docker, headless, the installer, or none from source", () => {
    expect(startOptions([], { APP_INSTALL: "docker" })).toEqual({
      install: "docker",
      headless: true,
    });
    expect(startOptions(["--headless"], { APP_INSTALL: "bundle" })).toEqual({
      install: "headless",
      headless: true,
    });
    expect(startOptions([], { APP_INSTALL: "bundle", CONNECTOR_HEADLESS: "1" })).toMatchObject({
      install: "headless",
    });
    expect(startOptions([], { APP_INSTALL: "bundle", CONNECTOR_HEADLESS: "false" })).toEqual({
      install: "bundle",
      headless: false,
    });
    expect(startOptions([], {})).toEqual({ install: undefined, headless: false });
  });
});

describe("spent codes", () => {
  it("are kept across a restart, whatever the case or dash", () => {
    const dir = mkdtempSync(join(tmpdir(), "spent-"));
    try {
      openSpentCodes(dir).add("abcd-efgh");
      const again = openSpentCodes(dir);
      expect(again.has("ABCDEFGH")).toBe(true);
      expect(again.has("ABCD-EFGJ")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Generous: a full parallel run slows everything down.
const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000) => {
  for (
    const end =
      Date.now() + (process.env.TEST_TIMEOUT ? Number(process.env.TEST_TIMEOUT) || Infinity : ms);
    !(await ok());
    await new Promise((r) => setTimeout(r, 20))
  )
    if (Date.now() > end) throw new Error("timed out");
};

describe("pairing at start", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const f of cleanup.splice(0).reverse()) await f();
  });

  const hub = async () => {
    const db = openDb(":memory:");
    const dataDir = mkdtempSync(join(tmpdir(), "hub-data-"));
    const app = await buildApp(db, { stream: { write: () => true } }, dataDir);
    const passwordHash = await hashPassword("password123");
    const user = (role: "admin" | "viewer") =>
      db
        .insert(schema.users)
        .values({
          email: `${role}@x.io`,
          displayName: role,
          roleId: BUILT_IN_ROLE_IDS[role],
          passwordHash,
        })
        .returning()
        .get();
    const admin = user("admin");
    const viewer = user("viewer");
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: admin.email, password: "password123" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { cookie } });
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const code = async (kind: "desktop" | "headless" = "headless") =>
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id, kind })).json() as {
        id: string;
        code: string;
        expiresAt: string;
      };
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    cleanup.push(() => {
      app.server.closeAllConnections();
      return app.close().finally(() => rmSync(dataDir, { recursive: true, force: true }));
    });
    return { url, send, code, admin, viewer };
  };

  /** A connector started on `dir` (again = restarted), counting what it sends to `/pair`. */
  const start = (dir: string) => {
    const store = openStore(dir);
    const link = createLink({ store, version: VERSION, os: "TestOS arm64", install: "docker" });
    cleanup.push(() => link.close());
    const sent: string[] = [];
    const counted = {
      pair: (hubUrl: string, code: string, name: string) => {
        sent.push(code);
        return link.pair(hubUrl, code, name);
      },
    };
    const lines: string[] = [];
    const run = (hubUrl: string, code: string) =>
      pairAtStart({
        link: counted,
        store,
        given: { hubUrl, code, name: "NAS" },
        spent: openSpentCodes(dir),
        log: (l) => lines.push(l),
      });
    const follow = (hubUrl: string) =>
      followHubAtStart({ link, store, hubUrl, log: (l) => lines.push(l), retryMs: 1 });
    link.start();
    return { store, link, sent, lines, run, follow };
  };
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  it("pairs from its variables, shows online with its install kind, and a restart stays paired", async () => {
    const h = await hub();
    const dir = folder();
    const { code } = await h.code();
    const first = start(dir);
    await first.run(h.url, code);
    await until(() => first.link.state().status === "online");
    const [device] = (await h.send("GET", "/api/hub/devices")).json();
    expect(device).toMatchObject({
      name: "NAS",
      online: true,
      install: "docker",
      userName: "viewer",
    });
    first.link.close();

    // Restarted with the same variables: paired already, the code isn't sent.
    const again = start(dir);
    await again.run(h.url, code);
    expect(again.sent).toEqual([]);
    await until(() => again.link.state().status === "online");
    expect((await h.send("GET", "/api/hub/devices")).json()).toHaveLength(1);
  });

  it("stays up unpaired on a refused code, and never sends it again after a restart", async () => {
    const h = await hub();
    const dir = folder();
    const first = start(dir);
    await first.run(h.url, "WRON-GCDE");
    expect(first.sent).toEqual(["WRON-GCDE"]);
    expect(first.link.state().status).toBe("unpaired");
    expect(first.lines).toEqual([
      "pairing: the hub refused the code (wrong, used or expired); make a new one in Hub management and set it in CONNECTOR_PAIRING_CODE (or --pairing-code)",
    ]);
    first.link.close();

    const again = start(dir);
    await again.run(h.url, "wron-gcde");
    expect(again.sent).toEqual([]);
    expect(again.lines[0]).toMatch(/refused or used before and isn't sent again/);

    // A new code in the variable is tried at the next start.
    const { code } = await h.code();
    await again.run(h.url, code);
    expect(again.sent).toEqual([code]);
    await until(() => again.link.state().status === "online");
  });

  it("doesn't send its used code again once revoked", async () => {
    const h = await hub();
    const dir = folder();
    const { code } = await h.code();
    const first = start(dir);
    await first.run(h.url, code);
    await until(() => first.link.state().status === "online");
    const [device] = (await h.send("GET", "/api/hub/devices")).json();
    await h.send("DELETE", `/api/hub/devices/${device.id}`);
    await until(() => first.link.state().status === "revoked");
    first.link.close();

    const again = start(dir);
    await again.run(h.url, code);
    expect(again.sent).toEqual([]);
    expect(again.store.token()).toBeUndefined();
  });

  it("a 24-hour code still pairs after 10 minutes; a desktop one doesn't", async () => {
    const h = await hub();
    const headless = await h.code("headless");
    const desktop = await h.code("desktop");
    const lasts = (c: { expiresAt: string }) => Date.parse(c.expiresAt) - Date.now();
    expect(lasts(headless)).toBeGreaterThan(23.9 * 3_600_000);
    expect(lasts(desktop)).toBeLessThanOrEqual(10 * 60_000);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60_000 });
    cleanup.push(() => vi.useRealTimers());
    const late = start(folder());
    await late.run(h.url, desktop.code);
    expect(late.link.state().status).toBe("unpaired");
    const ok = start(folder());
    await ok.run(h.url, headless.code);
    await until(() => ok.link.state().status === "online");
  });

  it("refuses a withdrawn code, and lists only the unused ones", async () => {
    const h = await hub();
    const kept = await h.code();
    const withdrawn = await h.code();
    const listed = async () => (await h.send("GET", "/api/hub/pairing-codes")).json();
    expect(await listed()).toMatchObject([
      { id: withdrawn.id, userName: "viewer", kind: "headless" },
      { id: kept.id, userName: "viewer", kind: "headless" },
    ]);
    // The code itself, or its hash, never comes back.
    expect(JSON.stringify(await listed())).not.toContain(kept.code);
    expect((await h.send("DELETE", `/api/hub/pairing-codes/${withdrawn.id}`)).statusCode).toBe(204);
    expect((await h.send("DELETE", `/api/hub/pairing-codes/${withdrawn.id}`)).statusCode).toBe(404);

    const c = start(folder());
    await c.run(h.url, withdrawn.code);
    expect(c.link.state().status).toBe("unpaired");
    expect(c.lines[0]).toMatch(/refused the code/);
    await c.run(h.url, kept.code);
    await until(() => c.link.state().status === "online");
    expect(await listed()).toEqual([]);
  });

  it(
    "moves to a new CONNECTOR_HUB_URL at the next start, and an unchanged one does nothing",
    async () => {
      const h = await hub();
      const old = await tcpProxy(h.url);
      cleanup.push(() => old.close());
      const dir = folder();
      const { code } = await h.code();
      const first = start(dir);
      await first.run(old.url, code);
      await until(() => first.link.state().status === "online");
      expect(first.store.get().startedWith).toBe(old.url);
      first.link.close();
      await old.close(); // the hub moved

      // The compose file now has the new address; the code in it is spent and stays unsent.
      const moved = start(dir);
      await moved.follow(`${h.url}/`);
      await moved.run(h.url, code);
      expect(moved.sent).toEqual([]);
      await until(() => moved.link.state().status === "online");
      expect(moved.store.get()).toMatchObject({ hubUrl: h.url, startedWith: h.url });
      expect(moved.store.token()).toBeTruthy();
      const [device] = (await h.send("GET", "/api/hub/devices")).json();
      expect(device.hubUrl).toBe(h.url);
      moved.link.close();

      // Started again with the same address: nothing to do, even if the hub announced another since.
      moved.store.set({ hubUrl: "http://announced.example" });
      const again = start(dir);
      await again.follow(h.url);
      expect(again.lines).toEqual([]);
      expect(again.store.get().hubUrl).toBe("http://announced.example");
    },
    testTimeout(30_000),
  );

  it(
    "unpairs for a hub that doesn't know it, and pairs there with a new code",
    async () => {
      const h = await hub();
      const other = await hub();
      const dir = folder();
      const first = start(dir);
      await first.run(h.url, (await h.code()).code);
      await until(() => first.link.state().status === "online");
      first.link.close();

      const moved = start(dir);
      await moved.follow(other.url);
      expect(moved.lines.at(-1)).toMatch(/doesn't know this device; pair it again/);
      expect(moved.store.token()).toBeUndefined();
      expect(moved.store.get().hubUrl).toBe(other.url); // kept for the pair form
      await moved.run(other.url, (await other.code()).code);
      await until(() => moved.link.state().status === "online");
      expect(moved.store.get().startedWith).toBe(other.url);
    },
    testTimeout(30_000),
  );

  it("tries a new address again while it can't be reached, and records one already in use", async () => {
    const lines: string[] = [];
    const state = { hubUrl: "http://old:4300", startedWith: "http://old:4300" };
    const store = {
      token: () => "t",
      get: () => state,
      set: (patch: object) => Object.assign(state, patch),
    };
    let tries = 0;
    const link = {
      changeHub: async (url: string) => {
        if (++tries < 3) throw new HubAddressError("unreachable");
        state.hubUrl = url;
      },
      unpair: () => {},
    };
    await followHubAtStart({
      link,
      store,
      hubUrl: "http://new:4300",
      log: (l) => lines.push(l),
      retryMs: 1,
    });
    expect(tries).toBe(3);
    expect(state).toEqual({ hubUrl: "http://new:4300", startedWith: "http://new:4300" });
    expect(lines).toEqual([
      "hub address: started with http://new:4300, moving there from http://old:4300",
      "hub address: unreachable at http://new:4300, trying again in 0 s",
      "hub address: unreachable at http://new:4300, trying again in 0 s",
    ]);

    // Paired before 6.3.0 (none recorded): the address in use is only recorded.
    const before = { hubUrl: "http://nas:4300" } as Record<string, string>;
    await followHubAtStart({
      link,
      store: { token: () => "t", get: () => before, set: (p: object) => Object.assign(before, p) },
      hubUrl: "http://nas:4300/",
      log: (l) => lines.push(l),
    });
    expect(before).toEqual({ hubUrl: "http://nas:4300", startedWith: "http://nas:4300" });
    expect(tries).toBe(3);
  });

  it("tries an unreachable hub again, and stops for a bad address", async () => {
    const lines: string[] = [];
    const store = { token: () => undefined, set: () => {} };
    let tries = 0;
    const link = {
      pair: async () => {
        if (++tries < 3) throw new PairError("unreachable");
      },
    };
    const dir = folder();
    const given = { hubUrl: "http://later:4300", code: "LATE-CODE", name: "NAS" };
    await pairAtStart({
      link,
      store,
      given,
      spent: openSpentCodes(dir),
      log: (l) => lines.push(l),
      retryMs: 1,
    });
    expect(tries).toBe(3);
    expect(lines).toEqual([
      "pairing: unreachable at http://later:4300, trying again in 0 s",
      "pairing: unreachable at http://later:4300, trying again in 0 s",
    ]);
    // Paired with it: a revoke later doesn't send it again.
    expect(openSpentCodes(dir).has("LATE-CODE")).toBe(true);

    const bad = { pair: async () => Promise.reject(new PairError("badUrl")) };
    lines.length = 0;
    await pairAtStart({
      link: bad,
      store,
      given: { ...given, hubUrl: "nas:4300", code: "OTHE-RCDE" },
      spent: openSpentCodes(dir),
      log: (l) => lines.push(l),
    });
    expect(lines).toEqual(["pairing: nas:4300 is not an http:// or https:// address"]);
    expect(openSpentCodes(dir).has("OTHE-RCDE")).toBe(false);
  });
});
