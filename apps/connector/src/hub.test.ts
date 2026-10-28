// A real connector link against a real hub (the server's buildApp on a free port).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLink, type Link, PairError, sseParser } from "./hub.ts";
import { openStore } from "./state.ts";

describe("sseParser", () => {
  it("splits events across chunks, joins data lines and skips comments", () => {
    const got: unknown[] = [];
    const feed = sseParser((e) => got.push(e));
    feed(": open\n\nid: 1\nevent: a\nda");
    feed('ta: {"x":1}\n\n: hb\n\nid: 2\ndata: one\ndata: two\n\n');
    expect(got).toEqual([
      { id: "1", event: "a", data: '{"x":1}' },
      { id: "2", data: "one\ntwo" },
    ]);
  });
});

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 20)))
    if (Date.now() > end) throw new Error("timed out");
};

describe("connector and hub", () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    // Last in, first out: links stop before their hub closes.
    for (const f of cleanup.splice(0).reverse()) await f();
  });

  const hub = async () => {
    const db = openDb(":memory:");
    const app = await buildApp(db, { stream: { write: () => true } }, "", {});
    const passwordHash = await hashPassword("password123");
    const user = (role: "admin" | "viewer") =>
      db
        .insert(schema.users)
        .values({ email: `${role}@x.io`, displayName: role, role, passwordHash })
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
    const code = async () =>
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code as string;
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    cleanup.push(() => {
      // A request aborted while connecting (the link restarts) can leave undici a connected socket
      // that never sends a request; server.close() would wait for it until the headers timeout.
      app.server.closeAllConnections();
      return app.close();
    });
    return { url, send, code };
  };

  const connector = (dir = mkdtempSync(join(tmpdir(), "connector-"))) => {
    const store = openStore(dir);
    const link = createLink({ store, version: "5.0.0-test", os: "TestOS x64" });
    cleanup.push(() => link.close());
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    return { dir, store, link };
  };
  const status = (link: Link) => link.state().status;

  it("pairs, shows online, gets renamed live and after a reconnect, and stops when revoked", async () => {
    const h = await hub();
    const c = connector();
    expect(status(c.link)).toBe("unpaired");

    await expect(c.link.pair(h.url, "AAAA-AAAA", "WS-1")).rejects.toThrow(PairError);
    await c.link.pair(`${h.url}/`, await h.code(), "WS-1");
    await until(() => status(c.link) === "online");
    expect(c.store.token()).toBeTruthy();

    const [device] = (await h.send("GET", "/api/hub/devices")).json();
    expect(device).toMatchObject({
      name: "WS-1",
      online: true,
      connectorVersion: "5.0.0-test",
      os: "TestOS x64",
    });

    await h.send("PATCH", `/api/hub/devices/${device.id}`, { name: "Laptop" });
    await until(() => c.store.get().deviceName === "Laptop");

    // Offline while renamed: the next start replays it from the cursor.
    c.link.close();
    await h.send("PATCH", `/api/hub/devices/${device.id}`, { name: "Desk" });
    const again = connector(c.dir);
    again.link.start();
    await until(() => again.store.get().deviceName === "Desk");

    await h.send("DELETE", `/api/hub/devices/${device.id}`);
    await until(() => status(again.link) === "revoked");
    expect(again.store.token()).toBeUndefined();
    expect(again.store.get().hubUrl).toBe(h.url); // kept for the pair form
  });

  it("tells the hub being off apart from a revoke", async () => {
    const h = await hub();
    const c = connector();
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => status(c.link) === "online");
    await h.send("PATCH", "/api/preferences", { hubEnabled: false });
    // The heartbeat ends the stream within 15 s; restarting the link reconnects at once.
    c.link.start();
    await until(() => status(c.link) === "hubOff");
    expect(c.store.token()).toBeTruthy();
  });
});
