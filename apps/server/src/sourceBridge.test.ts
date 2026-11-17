// The hub's side of printers reached through a connector (ADR-0015, LAN reach): who may assign
// one, what a device may read and post. A real connector against this hub: apps/connector's
// sources.test.ts.

import {
  fixture,
  type MockState,
  mockAdapter,
  mockHostAdapter,
} from "@3d-maker-suite/adapter-mock";
import { spoolmanAdapter } from "@3d-maker-suite/adapter-spoolman";
import { BUILT_IN_ROLE_IDS, type PrinterSnapshot } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
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

/** A paired device (offline: no stream open), reaching printers and spool libraries unless told not to. */
async function pair(name: string, reach = true) {
  const userId = db.select().from(schema.users).all()[0]?.id;
  const { code } = (await send("POST", "/api/hub/pairing-codes", { userId })).json();
  const res = await app.inject({
    method: "POST",
    url: "/api/hub/pair",
    payload: { code, name, os: "win32", connectorVersion: "6.0.0" },
  });
  const paired = res.json() as { token: string; deviceId: string };
  if (reach)
    db.update(schema.devices)
      .set({ reachPrinters: true, reachSpoolLibraries: true })
      .where(eq(schema.devices.id, paired.deviceId))
      .run();
  return paired;
}

/**
 * A printer on the network, linked to a new printer at save (ADR-0015). Saving asks the printer
 * what it is: here, as these machines' connectors aren't connected; then it moves to `deviceId`.
 */
async function printer(deviceId?: string | null) {
  const made = await send("POST", "/api/integrations", {
    adapterId: "mock-host",
    config: { host: "printer.lan" },
    secrets: { token: "secret" },
    printer: "new",
  });
  return deviceId ? send("PATCH", `/api/integrations/${made.json().id}`, { deviceId }) : made;
}

describe("printers through a connector, on the hub", () => {
  it("a device reads only its own printers, keys included, and nobody else gets the keys", async () => {
    const a = await pair("A");
    const b = await pair("B");
    const made = await printer(a.deviceId);
    expect(made.statusCode).toBe(200);
    expect(made.json()).toMatchObject({ deviceId: a.deviceId, viaDeviceName: "A" });
    expect(JSON.stringify(made.json())).not.toContain("secret");
    const mine = await device(a.token, "GET", "/sources");
    expect(mine.json()).toEqual([
      {
        integrationId: made.json().id,
        adapterId: "mock-host",
        config: { host: "printer.lan" },
        secrets: { token: "secret" },
      },
    ]);
    expect((await device(b.token, "GET", "/sources")).json()).toEqual([]);
    // A session is no device.
    expect((await send("GET", "/api/hub/device/sources")).statusCode).toBe(403);
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
    expect((await device(a.token, "GET", "/sources")).json()).toEqual([
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
    expect((await device(a.token, "GET", "/sources")).json()).toEqual([]);
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
    expect((await device(b.token, "POST", "/sources/status", status)).statusCode).toBe(404);
    expect((await device(a.token, "POST", "/sources/status", status)).statusCode).toBe(204);
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
    const fromB = await device(b.token, "POST", "/sources/prints", { items: [item] });
    expect(fromB.json()).toEqual({ done: ["k1"] });
    expect(db.select().from(schema.prints).all()).toEqual([]);
    const invalid = { ...item, key: "k2", print: { nope: true } };
    expect((await device(a.token, "POST", "/sources/prints", { items: [invalid] })).json()).toEqual(
      { done: ["k2"] },
    );
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

  it("a machine whose switch is off can't be assigned a source of that kind: 409 device_not_reaching", async () => {
    const a = await pair("A", false);
    const id = (await printer()).json().id as string;
    const patch = await send("PATCH", `/api/integrations/${id}`, { deviceId: a.deviceId });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe("device_not_reaching");
    expect((await printer(a.deviceId)).json().error.code).toBe("device_not_reaching");
    // The other kind's switch doesn't open it.
    db.update(schema.devices)
      .set({ reachSpoolLibraries: true })
      .where(eq(schema.devices.id, a.deviceId))
      .run();
    expect((await printer(a.deviceId)).statusCode).toBe(409);
    const spools = await send("POST", "/api/integrations", {
      adapterId: "spoolman",
      config: { host: "192.168.1.60:7912" },
      deviceId: a.deviceId,
    });
    expect(spools.statusCode).toBe(201);
    db.update(schema.devices)
      .set({ reachPrinters: true })
      .where(eq(schema.devices.id, a.deviceId))
      .run();
    expect((await printer(a.deviceId)).statusCode).toBe(200);
  });

  it("turning a switch off pauses its sources, which keep the machine; the connector hears nothing of them", async () => {
    const a = await pair("A");
    const made = await printer(a.deviceId);
    const id = made.json().id as string;
    const spools = await send("POST", "/api/integrations", {
      adapterId: "spoolman",
      config: { host: "192.168.1.60:7912" },
      deviceId: a.deviceId,
    });
    const off = await send("PATCH", `/api/hub/devices/${a.deviceId}`, { reachPrinters: false });
    expect(off.statusCode).toBe(204);
    const row = (await send("GET", `/api/integrations/${id}`)).json();
    expect(row).toMatchObject({ enabled: false, deviceId: a.deviceId });
    // The spool library keeps going: its own switch is still on.
    expect((await send("GET", `/api/integrations/${spools.json().id}`)).json()).toMatchObject({
      enabled: true,
    });
    const sources = (await device(a.token, "GET", "/sources")).json() as { adapterId: string }[];
    expect(sources.map((s) => s.adapterId)).toEqual(["spoolman"]);
    // Back on: nothing starts by itself.
    await send("PATCH", `/api/hub/devices/${a.deviceId}`, { reachPrinters: true });
    expect((await send("GET", `/api/integrations/${id}`)).json()).toMatchObject({ enabled: false });
  });

  it("a source left on a machine with its switch off isn't relayed for", async () => {
    const a = await pair("A");
    const id = (await printer(a.deviceId)).json().id as string;
    // Off behind the API's back (not paused): the server still refuses the connector.
    db.update(schema.devices)
      .set({ reachPrinters: false })
      .where(eq(schema.devices.id, a.deviceId))
      .run();
    expect((await device(a.token, "GET", "/sources")).json()).toEqual([]);
    const res = await device(a.token, "POST", "/sources/prints", {
      items: [
        {
          key: "k1",
          integrationId: id,
          print: {
            externalId: "1",
            name: "x",
            status: "finished",
            startedAt: "2026-01-01T00:00:00Z",
            endedAt: "2026-01-01T01:00:00Z",
          },
        },
      ],
    });
    // Dropped as not this device's any more: nothing was recorded.
    expect(res.json()).toEqual({ done: ["k1"] });
    expect(db.select().from(schema.prints).all()).toEqual([]);
  });
});

// 6.0.0 Step 16: the add and edit forms test what they hold; nothing is saved.
describe("test before saving", () => {
  const tryOut = (body: object) => send("POST", "/api/integrations/test", body);
  const host = { adapterId: "mock-host", config: { host: "printer.lan" } };
  const count = () => db.select().from(schema.integrations).all().length;

  it("tests on this server: what it found, or the key it refused; nothing is saved", async () => {
    expect((await tryOut({ ...host, secrets: { token: "secret" } })).json()).toEqual({
      ok: true,
      printers: [
        {
          externalId: "mock-1",
          name: "Mock printer",
          brand: "Mock",
          model: "M1",
          serial: "MOCK0001",
        },
      ],
    });
    expect((await tryOut({ ...host, secrets: { token: "wrong" } })).json()).toEqual({
      ok: false,
      code: "auth_required",
    });
    const bad = await tryOut({ ...host, config: {}, secrets: { token: "secret" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_config");
    expect((await tryOut({ ...host, secrets: {} })).json().error.code).toBe("invalid_secrets");
    expect(count()).toBe(0);
  });

  it("an edit tests with the stored key where it is left empty, and never another adapter's", async () => {
    const id = (await printer()).json().id as string;
    expect((await tryOut({ ...host, secrets: {}, integrationId: id })).json()).toMatchObject({
      ok: true,
    });
    // A key typed in wins over the stored one.
    expect(
      (await tryOut({ ...host, secrets: { token: "wrong" }, integrationId: id })).json(),
    ).toEqual({ ok: false, code: "auth_required" });
    const other = await tryOut({ adapterId: "mock", secrets: {}, integrationId: id });
    expect(other.json().error.code).toBe("adapter_mismatch");
    // The stored key is never answered, and the row is as it was.
    const row = (await send("GET", `/api/integrations/${id}`)).json();
    expect(row).toMatchObject({ storedKeys: ["token"], config: { host: "printer.lan" } });
    expect(JSON.stringify(row)).not.toContain('"secret"');
  });

  it("through a machine: only one whose switch is on, and only an online one", async () => {
    const off = await pair("Off", false);
    const res = await tryOut({ ...host, secrets: { token: "secret" }, deviceId: off.deviceId });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("device_not_reaching");
    const on = await pair("On");
    // Paired, but its connector isn't connected.
    const away = await tryOut({ ...host, secrets: { token: "secret" }, deviceId: on.deviceId });
    expect(away.statusCode).toBe(409);
    expect(away.json().error.code).toBe("device_offline");
    expect(count()).toBe(0);
  });

  it("needs integrations.manage", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "editor@x.io", password: "password123" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/integrations/test",
      payload: { ...host, secrets: { token: "secret" } },
      headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] ?? "" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a machine learns the kinds of source its switches allow (X-Reach)", async () => {
    const a = await pair("A");
    const reach = async () => (await device(a.token, "GET", "/sources")).headers["x-reach"];
    expect(await reach()).toBe("printers,spool-libraries");
    await send("PATCH", `/api/hub/devices/${a.deviceId}`, { reachPrinters: false });
    expect(await reach()).toBe("spool-libraries");
    await send("PATCH", `/api/hub/devices/${a.deviceId}`, { reachSpoolLibraries: false });
    expect(await reach()).toBe("");
  });

  it("never logs the keys it tests with", async () => {
    const lines: string[] = [];
    const logged = await buildApp(
      openDb(":memory:"),
      { stream: { write: (l: string) => lines.push(l) } },
      "",
      { adapters: [mockHostAdapter({ ...fixture(), fail: "unreachable" })] },
    );
    const res = await logged.inject({
      method: "POST",
      url: "/api/integrations/test",
      payload: { ...host, secrets: { token: "t0p-s3cr3t" } },
    });
    expect(res.json()).toEqual({ ok: false, code: "unreachable" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("t0p-s3cr3t");
    await logged.close();
  });
});

describe("edit a source", () => {
  it("changes its host, key and machine at once; a key left out stays", async () => {
    const a = await pair("A");
    const id = (await printer()).json().id as string;
    const edit = await send("PATCH", `/api/integrations/${id}`, {
      config: { host: "printer2.lan" },
      secrets: { token: "new-key" },
      deviceId: a.deviceId,
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ config: { host: "printer2.lan" }, deviceId: a.deviceId });
    const sources = () => device(a.token, "GET", "/sources").then((r) => r.json());
    expect(await sources()).toMatchObject([
      { config: { host: "printer2.lan" }, secrets: { token: "new-key" } },
    ]);
    // The Edit page sends no key it left empty.
    await send("PATCH", `/api/integrations/${id}`, { config: { host: "printer3.lan" } });
    expect(await sources()).toMatchObject([
      { config: { host: "printer3.lan" }, secrets: { token: "new-key" } },
    ]);
  });
});
