// The printer bridge (ADR-0015, LAN reach): a real connector link against a real hub (the server's
// buildApp on a port), with the mock printer as a printer on the network that only the connector
// reads.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixture,
  type MockState,
  mockAdapter,
  mockHostAdapter,
} from "@3d-maker-suite/adapter-mock";
import { BUILT_IN_ROLE_IDS, type PrinterSnapshot } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLink } from "./hub.ts";
import { openStore } from "./state.ts";

const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000) => {
  // On battery (`pnpm test:battery`) the vitest timeout is 240s; wait as long.
  for (
    const end = Date.now() + (process.env.TEST_BATTERY ? 240_000 : ms);
    !(await ok());
    await new Promise((r) => setTimeout(r, 20))
  )
    if (Date.now() > end) throw new Error("timed out");
};

const SECRET = "secret-token-1234";
const snap = (state: PrinterSnapshot["state"], progress = 50): PrinterSnapshot => ({
  printerExternalId: "mock-1",
  at: new Date().toISOString(),
  state,
  ...(state !== "idle" && {
    job: { id: "job-x", file: "cube.gcode", title: "Cube", progress, elapsedSec: 600 },
  }),
  slots: [{ slot: 0, material: "PLA", colorHex: "#ff8800", active: state === "printing" }],
});

// Pairing, a sync through the connector and a hub restart take a few seconds each.
describe("printers through a connector", {
  timeout: process.env.TEST_BATTERY ? 240_000 : 60_000,
}, () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const f of cleanup.splice(0).reverse()) await f();
  });

  /** A hub on `dir`'s database; again on the same folder and port, it is the same hub restarted. */
  const hub = async (state: MockState, dir: string, port = 0) => {
    const db = openDb(join(dir, "app.sqlite"));
    const app = await buildApp(db, { stream: { write: () => true } }, dir, {
      adapters: [mockHostAdapter(state), mockAdapter(state)],
    });
    const passwordHash = await hashPassword("password123");
    const user = (role: "admin" | "viewer") =>
      db
        .select()
        .from(schema.users)
        .all()
        .find((u) => u.email === `${role}@x.io`) ??
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
    const send = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { cookie } });
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const url = await app.listen({ port, host: "127.0.0.1" });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      app.server.closeAllConnections();
      await app.close();
      db.$client.close();
    };
    cleanup.push(close);
    const code = async () =>
      (await send("POST", "/api/hub/pairing-codes", { userId: viewer.id })).json().code as string;
    const prints = () =>
      db
        .select()
        .from(schema.prints)
        .all()
        .filter((p) => p.externalId === "job-x");
    const alerts = (kind: string) =>
      db
        .select()
        .from(schema.alerts)
        .all()
        .filter((a) => a.kind === kind);
    return { app, db, url, port: Number(new URL(url).port), send, code, close, prints, alerts };
  };

  const folder = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    cleanup.unshift(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  const connector = (state: MockState, dir: string, printers = true) => {
    const store = openStore(dir);
    const link = createLink({
      store,
      version: "6.0.0-test",
      os: "TestOS x64",
      ...(printers && {
        printers: {
          dataDir: dir,
          adapters: [mockHostAdapter(state)],
          pollMs: { busy: 30, idle: 30 },
        },
      }),
    });
    cleanup.push(() => link.close());
    return { store, link };
  };

  /** A paired, online connector and the mock printer assigned to it and imported on the hub. */
  const setup = async (state: MockState) => {
    const hubDir = folder("hub-");
    const devDir = folder("connector-");
    const h = await hub(state, hubDir);
    const c = connector(state, devDir);
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => c.link.state().status === "online");
    const deviceId = c.store.get().deviceId ?? "";
    const created = await h.send("POST", "/api/integrations", {
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token: SECRET },
      deviceId,
    });
    expect(created.statusCode).toBe(201);
    const integrationId = created.json().id as string;
    expect(created.json()).toMatchObject({ deviceId, viaDeviceName: "WS-1" });
    // The hub has no way to the printer: the connector reads it for the import.
    const synced = await h.send("POST", `/api/integrations/${integrationId}/sync`, {
      type: "printers",
    });
    expect(synced.statusCode).toBe(200);
    expect(h.db.select().from(schema.printers).all()).toHaveLength(1);
    h.app.printerStatus.refresh();
    return { h, c, hubDir, devDir, deviceId, integrationId };
  };

  it("shows the live status through the connector and records a finished print once", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const { h, c } = await setup(state);
    state.status = [snap("printing")];
    await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "printing");
    expect(h.app.printerStatus.all()[0]?.via).toMatchObject({ deviceName: "WS-1", online: true });
    state.status = [snap("finished", 100)];
    await until(() => h.prints().length === 1);
    state.status = [snap("idle")];
    await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "idle");
    expect(h.prints()).toHaveLength(1);
    expect(h.prints()[0]).toMatchObject({ outcome: "success", title: "Cube" });
    expect(h.alerts("print_finished")).toHaveLength(1);
    expect(c.link.printers?.held()).toBe(0);
  });

  it("keeps a print that ends while the hub is down and records it when the hub is back", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const { h, c, hubDir, devDir } = await setup(state);
    state.status = [snap("printing")];
    await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "printing");
    await h.close();
    state.status = [snap("finished", 100)];
    await until(() => c.link.printers?.held() === 1);
    // On disk, without the printer's key in it.
    const file = readFileSync(join(devDir, "printers.json"), "utf8");
    expect(file).toContain("job-x");
    expect(file).not.toContain(SECRET);
    expect(file).not.toContain("printer.lan");
    const back = await hub(state, hubDir, h.port);
    await until(() => back.prints().length === 1 && c.link.printers?.held() === 0, 60_000);
    expect(back.alerts("print_finished")).toHaveLength(1);
  });

  it("a connector restarted while the hub is down keeps watching from what it saved", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const { h, c, hubDir, devDir } = await setup(state);
    state.status = [snap("printing")];
    await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "printing");
    await h.close();
    c.link.close();
    const again = connector(state, devDir);
    await until(() => again.link.printers?.watching() === 1);
    state.status = [snap("cancelled", 40)];
    await until(() => again.link.printers?.held() === 1);
    const back = await hub(state, hubDir, h.port);
    again.link.start();
    await until(() => back.prints().length === 1, 60_000);
    expect(back.prints()[0]?.outcome).toBe("cancelled");
  });

  it("tells a printer that stopped answering from a connector that went away", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const { h, c } = await setup(state);
    state.status = [snap("printing")];
    await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "printing");
    const later = () => h.app.printerStatus.offline(Date.now() + 3 * 60_000);
    state.status = [];
    await until(() => later()[0]?.reason === "printer");
    c.link.close();
    await until(() => later()[0]?.reason === "connector");
    expect(later()[0]).toMatchObject({ device: "WS-1" });
    expect(h.app.printerStatus.all()[0]).toMatchObject({
      snapshot: { state: "offline" },
      via: { online: false },
    });
  });

  it("backfills the history when the connector comes back", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const hubDir = folder("hub-");
    const devDir = folder("connector-");
    const h = await hub(state, hubDir);
    const c = connector(state, devDir);
    await c.link.pair(h.url, await h.code(), "WS-1");
    await until(() => c.link.state().status === "online");
    c.link.close();
    await until(async () => (await h.send("GET", "/api/hub/devices")).json()[0]?.online === false);
    // Assigned while the machine is away: nothing is read, nothing fails.
    const created = await h.send("POST", "/api/integrations", {
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token: SECRET },
      deviceId: c.store.get().deviceId,
    });
    expect(created.statusCode).toBe(201);
    const runs = () => h.db.select().from(schema.syncRuns).all();
    expect(runs()).toEqual([]);
    const again = connector(state, devDir);
    again.link.start();
    await until(() => h.db.select().from(schema.prints).all().length === 3, 60_000);
    expect(runs().every((r) => r.status === "ok")).toBe(true);
  });

  it("stops reading a printer moved back to the server, and keeps no key for it", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const { h, c, devDir, integrationId } = await setup(state);
    await until(() => c.link.printers?.watching() === 1);
    const moved = await h.send("PATCH", `/api/integrations/${integrationId}`, { deviceId: null });
    expect(moved.json()).toMatchObject({ deviceId: null, viaDeviceName: null });
    h.app.printerStatus.refresh();
    await until(() => c.link.printers?.watching() === 0);
    expect(readFileSync(join(devDir, "printers.json"), "utf8")).not.toContain(SECRET);
    c.link.unpair();
    expect(() => readFileSync(join(devDir, "printers.json"))).toThrow();
  });

  it("refuses a printer for a connector that can't run it", async () => {
    const state: MockState = { ...fixture() };
    const h = await hub(state, folder("hub-"));
    const c = connector(state, folder("connector-"), false);
    await c.link.pair(h.url, await h.code(), "WS-old");
    await until(() => c.link.state().status === "online");
    const res = await h.send("POST", "/api/integrations", {
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token: SECRET },
      deviceId: c.store.get().deviceId,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("device_outdated");
    // Not a printer on the network: never through a machine.
    const cloud = await h.send("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: SECRET },
      deviceId: c.store.get().deviceId,
    });
    expect(cloud.json().error.code).toBe("not_printer_host");
  });
});
