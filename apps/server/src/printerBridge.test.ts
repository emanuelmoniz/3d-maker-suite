// The hub's side of printers reached through a connector (ADR-0015, LAN reach): who may assign
// one, what a device may read and post. A real connector against this hub: apps/connector's
// printers.test.ts.
import {
  fixture,
  type MockState,
  mockAdapter,
  mockHostAdapter,
} from "@3d-maker-suite/adapter-mock";
import { spoolmanAdapter } from "@3d-maker-suite/adapter-spoolman";
import { BUILT_IN_ROLE_IDS, type PrinterSnapshot } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { hashPassword } from "./lib/password.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;
let cookie: string;

const send = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } });
const device = (token: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/hub/device${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
  });

beforeEach(async () => {
  db = openDb(":memory:");
  state = { ...fixture(), status: [] };
  app = await buildApp(db, false, "", {
    adapters: [mockHostAdapter(state), mockAdapter(state), spoolmanAdapter()],
  });
  const passwordHash = await hashPassword("password123");
  for (const role of ["admin", "editor"] as const)
    db.insert(schema.users)
      .values({
        email: `${role}@x.io`,
        displayName: role,
        roleId: BUILT_IN_ROLE_IDS[role],
        passwordHash,
      })
      .run();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@x.io", password: "password123" },
  });
  cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  await send("PATCH", "/api/preferences", { hubEnabled: true });
});
afterEach(() => app.close());

/** A paired device (offline: no stream open). */
async function pair(name: string) {
  const userId = db.select().from(schema.users).all()[0]?.id;
  const { code } = (await send("POST", "/api/hub/pairing-codes", { userId })).json();
  const res = await app.inject({
    method: "POST",
    url: "/api/hub/pair",
    payload: { code, name, os: "win32", connectorVersion: "6.0.0" },
  });
  return res.json() as { token: string; deviceId: string };
}

const printer = (deviceId?: string | null) =>
  send("POST", "/api/integrations", {
    adapterId: "mock-host",
    config: { host: "printer.lan" },
    secrets: { token: "secret" },
    ...(deviceId !== undefined && { deviceId }),
  });

describe("printers through a connector, on the hub", () => {
  it("a device reads only its own printers, keys included, and nobody else gets the keys", async () => {
    const a = await pair("A");
    const b = await pair("B");
    const made = await printer(a.deviceId);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ deviceId: a.deviceId, viaDeviceName: "A" });
    expect(JSON.stringify(made.json())).not.toContain("secret");
    const mine = await device(a.token, "GET", "/printers");
    expect(mine.json()).toEqual([
      {
        integrationId: made.json().id,
        adapterId: "mock-host",
        config: { host: "printer.lan" },
        secrets: { token: "secret" },
      },
    ]);
    expect((await device(b.token, "GET", "/printers")).json()).toEqual([]);
    // A session is no device.
    expect((await send("GET", "/api/hub/device/printers")).statusCode).toBe(403);
  });

  it("a spool library on the network is assigned as a printer is, and nothing else of its", async () => {
    const a = await pair("A");
    const made = await send("POST", "/api/integrations", {
      adapterId: "spoolman",
      config: { host: "192.168.1.60:7912" },
      deviceId: a.deviceId,
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ deviceId: a.deviceId, viaDeviceName: "A" });
    expect((await device(a.token, "GET", "/printers")).json()).toEqual([
      {
        integrationId: made.json().id,
        adapterId: "spoolman",
        config: { host: "192.168.1.60:7912" },
        secrets: {},
      },
    ]);
    // Both its lines off: the machine has nothing to reach for it, nor its address.
    const id = made.json().id as string;
    const off = await send("PATCH", `/api/integrations/${id}`, {
      policies: [
        { type: "spools", mode: "off" },
        { type: "spoolUsage", mode: "off" },
      ],
    });
    expect(off.statusCode).toBe(200);
    expect((await device(a.token, "GET", "/printers")).json()).toEqual([]);
  });

  it("takes status and prints only from the device the printer is assigned to", async () => {
    const a = await pair("A");
    const b = await pair("B");
    const id = (await printer(a.deviceId)).json().id as string;
    app.printerStatus.refresh();
    const snap: PrinterSnapshot = {
      printerExternalId: "mock-1",
      at: new Date().toISOString(),
      state: "idle",
      slots: [],
    };
    const status = { integrationId: id, snapshots: [snap], active: [], failing: false };
    expect((await device(b.token, "POST", "/printers/status", status)).statusCode).toBe(404);
    expect((await device(a.token, "POST", "/printers/status", status)).statusCode).toBe(204);
    const item = {
      key: "k1",
      integrationId: id,
      print: {
        print: {
          externalId: "j1",
          printerExternalId: "mock-1",
          title: "Cube",
          startedAt: new Date().toISOString(),
          outcome: "success",
          filaments: [],
        },
        partial: false,
        endSeen: true,
        job: {},
      },
    };
    // Not B's: done (so it doesn't wait for good), and nothing written.
    const fromB = await device(b.token, "POST", "/printers/prints", { items: [item] });
    expect(fromB.json()).toEqual({ done: ["k1"] });
    expect(db.select().from(schema.prints).all()).toEqual([]);
    const invalid = { ...item, key: "k2", print: { nope: true } };
    expect(
      (await device(a.token, "POST", "/printers/prints", { items: [invalid] })).json(),
    ).toEqual({ done: ["k2"] });
  });

  it("assigns only a printer on the network, with the hub on; a revoked machine gives it back", async () => {
    const a = await pair("A");
    const cloud = await send("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: "t" },
      deviceId: a.deviceId,
    });
    expect(cloud.json().error.code).toBe("not_printer_host");
    const id = (await printer()).json().id as string;
    await send("PATCH", "/api/preferences", { hubEnabled: false });
    const off = await send("PATCH", `/api/integrations/${id}`, { deviceId: a.deviceId });
    expect(off.json().error.code).toBe("hub_off");
    await send("PATCH", "/api/preferences", { hubEnabled: true });
    const on = await send("PATCH", `/api/integrations/${id}`, { deviceId: a.deviceId });
    expect(on.json()).toMatchObject({ deviceId: a.deviceId });
    // A revoked machine leaves it to this server.
    await app.inject({
      method: "DELETE",
      url: `/api/hub/devices/${a.deviceId}`,
      headers: { cookie },
    });
    expect((await send("GET", `/api/integrations/${id}`)).json()).toMatchObject({ deviceId: null });
  });
});
