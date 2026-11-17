// The source bridge (ADR-0015, LAN reach): a real connector link against a real hub (the server's
// buildApp on a port), with the mock printer as a printer on the network that only the connector
// reads, and the fake Spoolman as a spool library only the connector reaches (Step 14b).

import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixture,
  type MockState,
  mockAdapter,
  mockHostAdapter,
} from "@3d-maker-suite/adapter-mock";
import { spoolmanAdapter } from "@3d-maker-suite/adapter-spoolman";
import { type FakeSpoolman, fakeSpoolman } from "@3d-maker-suite/adapter-spoolman/src/fake.ts";
import { BUILT_IN_ROLE_IDS, hubEventSchema, type PrinterSnapshot } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { buildApp } from "@3d-maker-suite/server/src/app.ts";
import { hashPassword } from "@3d-maker-suite/server/src/lib/password.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      adapters: [mockHostAdapter(state), mockAdapter(state), spoolmanAdapter()],
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
    /** The paired machines reach printers and spool libraries (ADR-0014, Step 15's switches). */
    const reach = () =>
      db.update(schema.devices).set({ reachPrinters: true, reachSpoolLibraries: true }).run();
    return {
      app,
      db,
      url,
      port: Number(new URL(url).port),
      send,
      code,
      close,
      prints,
      alerts,
      reach,
    };
  };

  const folder = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    cleanup.unshift(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  const connector = (state: MockState, dir: string, sources = true) => {
    const store = openStore(dir);
    const link = createLink({
      store,
      version: "6.0.0-test",
      os: "TestOS x64",
      ...(sources && {
        sources: {
          dataDir: dir,
          adapters: [mockHostAdapter(state), spoolmanAdapter()],
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
    h.reach();
    await until(() => c.link.state().status === "online");
    const deviceId = c.store.get().deviceId ?? "";
    const created = await h.send("POST", "/api/integrations", {
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token: SECRET },
      deviceId,
      printer: "new",
    });
    expect(created.statusCode).toBe(201);
    const integrationId = created.json().id as string;
    expect(created.json()).toMatchObject({ deviceId, viaDeviceName: "WS-1" });
    // The hub has no way to the printer: the connector asks it what it is, and it is made at save.
    expect(h.db.select().from(schema.printers).all()).toMatchObject([
      { name: "Mock printer", serial: "MOCK0001", integrationId, externalId: "mock-1" },
    ]);
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
    expect(c.link.sources?.held()).toBe(0);
  });

  it("loads the spool the printer reads in a slot, through the connector (Step 19b)", async () => {
    const state: MockState = { ...fixture(), status: [{ ...snap("idle"), physicalSlots: true }] };
    const { h } = await setup(state);
    const material = (await h.send("POST", "/api/filament-materials", { name: "PLA" })).json() as {
      id: string;
    };
    const spool = (
      await h.send("POST", "/api/filament/spools", {
        materialId: material.id,
        colorHex: "#ff8800",
        initialGrams: 1000,
      })
    ).json() as { id: string };
    const loaded = () =>
      h.db
        .select()
        .from(schema.spools)
        .all()
        .find((s) => s.id === spool.id);
    await until(() => loaded()?.loadedBy === "printer");
    expect(loaded()).toMatchObject({ loadedSlot: 0, loadedBy: "printer" });
    // The tray emptied: the printer's spool leaves it.
    state.status = [{ ...snap("idle"), slots: [], physicalSlots: true }];
    await until(() => loaded()?.loadedPrinterId === null);
  });

  it("keeps a print that ends while the hub is down and records it when the hub is back", async () => {
    const state: MockState = { ...fixture(), status: [snap("idle")] };
    const { h, c, hubDir, devDir } = await setup(state);
    state.status = [snap("printing")];
    await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "printing");
    await h.close();
    state.status = [snap("finished", 100)];
    await until(() => c.link.sources?.held() === 1);
    // On disk, without the printer's key in it.
    const file = readFileSync(join(devDir, "sources.json"), "utf8");
    expect(file).toContain("job-x");
    expect(file).not.toContain(SECRET);
    expect(file).not.toContain("printer.lan");
    const back = await hub(state, hubDir, h.port);
    await until(() => back.prints().length === 1 && c.link.sources?.held() === 0, 60_000);
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
    await until(() => again.link.sources?.watching() === 1);
    state.status = [snap("cancelled", 40)];
    await until(() => again.link.sources?.held() === 1);
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
    h.reach();
    await until(() => c.link.state().status === "online");
    c.link.close();
    await until(async () => (await h.send("GET", "/api/hub/devices")).json()[0]?.online === false);
    // Assigned while the machine is away: nothing is read, nothing fails. Saving asks the
    // printer what it is, so it is set up where the hub reaches it, then moved.
    const created = await h.send("POST", "/api/integrations", {
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token: SECRET },
      printer: "new",
    });
    expect(created.statusCode).toBe(201);
    const moved = await h.send("PATCH", `/api/integrations/${created.json().id}`, {
      deviceId: c.store.get().deviceId,
    });
    expect(moved.statusCode).toBe(200);
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
    await until(() => c.link.sources?.watching() === 1);
    const moved = await h.send("PATCH", `/api/integrations/${integrationId}`, { deviceId: null });
    expect(moved.json()).toMatchObject({ deviceId: null, viaDeviceName: null });
    h.app.printerStatus.refresh();
    await until(() => c.link.sources?.watching() === 0);
    expect(readFileSync(join(devDir, "sources.json"), "utf8")).not.toContain(SECRET);
    c.link.unpair();
    expect(() => readFileSync(join(devDir, "sources.json"))).toThrow();
  });

  it("refuses a printer for a connector that can't run it", async () => {
    const state: MockState = { ...fixture() };
    const h = await hub(state, folder("hub-"));
    const c = connector(state, folder("connector-"), false);
    await c.link.pair(h.url, await h.code(), "WS-old");
    h.reach();
    await until(() => c.link.state().status === "online");
    const res = await h.send("POST", "/api/integrations", {
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token: SECRET },
      deviceId: c.store.get().deviceId,
      printer: "new",
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

  // 6.0.0 Step 16: the add form tests a printer on another network through a machine before saving.
  describe("test before saving, through a machine", () => {
    /** A paired, online connector whose Reach printers is on (through the API: it is told). */
    const machine = async (state: MockState) => {
      const h = await hub(state, folder("hub-"));
      const c = connector(state, folder("connector-"));
      await c.link.pair(h.url, await h.code(), "WS-1");
      await until(() => c.link.state().status === "online");
      const deviceId = c.store.get().deviceId ?? "";
      const on = await h.send("PATCH", `/api/hub/devices/${deviceId}`, { reachPrinters: true });
      expect(on.statusCode).toBe(204);
      return { h, c, deviceId };
    };
    const body = (deviceId: string, token = SECRET) => ({
      adapterId: "mock-host",
      config: { host: "printer.lan" },
      secrets: { token },
      deviceId,
    });
    /** Asks the connector itself, past the hub's own check. */
    const ask = async (c: ReturnType<typeof connector>, adapterId = "mock-host") => {
      let answer: unknown;
      await c.link.sources?.test(
        {
          type: "sources.test",
          requestId: randomUUID(),
          adapterId,
          config: { host: "printer.lan" },
          secrets: { token: SECRET },
        },
        async (b) => {
          answer = b;
        },
      );
      return answer as { ok: boolean; code?: string };
    };

    it("finds the printer, or says the key is wrong, and saves nothing", async () => {
      const state: MockState = { ...fixture() };
      const { h, deviceId } = await machine(state);
      const ok = await h.send("POST", "/api/integrations/test", body(deviceId));
      expect(ok.json()).toEqual({
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
      const wrong = await h.send("POST", "/api/integrations/test", body(deviceId, "wrong"));
      expect(wrong.json()).toEqual({ ok: false, code: "auth_required" });
      expect(h.db.select().from(schema.integrations).all()).toEqual([]);
    });

    it("the connector refuses a test its switch is off for, whatever the hub asks", async () => {
      const state: MockState = { ...fixture() };
      const { h, c, deviceId } = await machine(state);
      await until(async () => (await ask(c)).ok);
      // An adapter it doesn't run is no test either.
      expect(await ask(c, "mock")).toEqual({ ok: false, code: "ENOTSUP" });
      await h.send("PATCH", `/api/hub/devices/${deviceId}`, { reachPrinters: false });
      // The hub refuses first; the connector, told of the switch, refuses too.
      const res = await h.send("POST", "/api/integrations/test", body(deviceId));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("device_not_reaching");
      await until(async () => (await ask(c)).code === "EACCES");
    });

    it("an edit's new key reaches the connector, and its test uses the stored one", async () => {
      const state: MockState = { ...fixture(), status: [snap("idle")] };
      const { h, c, deviceId, integrationId } = await setup(state);
      await until(() => c.link.sources?.watching() === 1);
      const stored = { ...body(deviceId, ""), secrets: {}, integrationId };
      expect((await h.send("POST", "/api/integrations/test", stored)).json()).toMatchObject({
        ok: true,
      });
      const edit = await h.send("PATCH", `/api/integrations/${integrationId}`, {
        config: { host: "printer2.lan" },
        secrets: { token: "wrong" },
      });
      expect(edit.statusCode).toBe(200);
      expect((await h.send("POST", "/api/integrations/test", stored)).json()).toEqual({
        ok: false,
        code: "auth_required",
      });
      // The source it watches restarts with the new key.
      h.app.printerStatus.refresh();
      await until(
        async () =>
          (await h.send("POST", `/api/integrations/${integrationId}/test`)).json().code ===
          "auth_required",
      );
    });
  });

  describe("Spoolman through a connector", () => {
    let spoolman: FakeSpoolman;
    beforeEach(() => {
      spoolman = fakeSpoolman();
      // Spoolman answers at its address only; the hub and the connector talk as they always do.
      const real = globalThis.fetch;
      vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.startsWith(spoolman.origin) ? spoolman.handle(url, init) : real(input, init);
      });
    });
    afterEach(() => vi.unstubAllGlobals());

    const usedIn = (id: number) => spoolman.spools.find((s) => s.id === id)?.used_weight;
    const patches = () => spoolman.writes().filter((w) => w.method === "PATCH");
    type Hub = Awaited<ReturnType<typeof hub>>;
    const pending = async (h: Hub, id: string) =>
      (await h.send("GET", `/api/integrations/${id}`))
        .json()
        .policies.find((p: { type: string }) => p.type === "spoolUsage")?.pending;
    const offline = (h: Hub) =>
      until(async () => (await h.send("GET", "/api/hub/devices")).json()[0]?.online === false);

    /** A paired connector, and a Spoolman with one spool reached through it and imported. */
    const setup = async (state: MockState) => {
      const h = await hub(state, folder("hub-"));
      const devDir = folder("connector-");
      const c = connector(state, devDir);
      await c.link.pair(h.url, await h.code(), "WS-1");
      h.reach();
      await until(() => c.link.state().status === "online");
      const deviceId = c.store.get().deviceId ?? "";
      const vendor = spoolman.addSpool({ vendor: "Bambu Lab", colorHex: "ff8800", used: 100 });
      const created = await h.send("POST", "/api/integrations", {
        adapterId: "spoolman",
        config: { host: "spoolman.local:7912" },
        deviceId,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      const synced = await h.send("POST", `/api/integrations/${id}/sync`, { type: "spools" });
      expect(synced.json()).toMatchObject({ created: 1 });
      const mine = h.db.select().from(schema.spools).get()?.id;
      return { h, c, devDir, deviceId, id, vendor, mine };
    };

    /** The hub's own printer (the mock account), which the hub reads itself. */
    const hubPrinter = async (h: Hub) => {
      const made = await h.send("POST", "/api/integrations", {
        adapterId: "mock",
        secrets: { token: "t" },
      });
      await h.send("POST", `/api/integrations/${made.json().id}/sync`, { type: "printers" });
      h.app.printerStatus.refresh();
    };
    const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 10, 0, s)).toISOString();
    /** One job on the hub's own printer, from printing to finished: the hub records it. */
    const hubPrint = async (h: Hub, state: MockState, job: string, grams: number, start = 0) => {
      for (const [s, st] of [
        [start, "printing"],
        [start + 30, "finished"],
        [start + 40, "idle"],
      ] as const) {
        const slot = { slot: 0, material: "PLA", colorHex: "#ff8800", gramsUsed: grams };
        state.status = [
          {
            printerExternalId: "mock-1",
            at: at(s),
            state: st,
            ...(st !== "idle" && {
              job: { id: job, file: "benchy.gcode", progress: st === "finished" ? 100 : 50 },
            }),
            slots: [{ ...slot, active: st === "printing" }],
          },
        ];
        await h.app.printerStatus.pollAll();
      }
    };

    it("imports the spools of a Spoolman only the connector reaches", async () => {
      const { h, c, id, mine } = await setup({ ...fixture() });
      expect(mine).toBeDefined();
      expect(h.db.select().from(schema.spools).get()).toMatchObject({ remainingGrams: 900 });
      // Read only: nothing was written there.
      expect(spoolman.writes()).toEqual([]);
      // The hub has no way of its own: with the machine away, the import can't run.
      c.link.close();
      await offline(h);
      const away = await h.send("POST", `/api/integrations/${id}/sync`, { type: "spools" });
      expect(away.json()).toMatchObject({ errorCode: "unreachable" });
    });

    it("writes each print's usage back once, also when an answer was lost", async () => {
      const state: MockState = { ...fixture(), prints: [], status: [] };
      const { h, id, vendor } = await setup(state);
      await hubPrinter(h);
      await hubPrint(h, state, "j1", 12.5);
      expect(h.db.select().from(schema.prints).all()).toHaveLength(1);
      await h.app.spoolPush.run();
      expect(usedIn(vendor.id)).toBe(112.5);
      await h.app.spoolPush.run();
      await h.app.spoolPush.run();
      expect(patches()).toHaveLength(1);
      // Spoolman took the next one, and its answer never came back.
      await hubPrint(h, state, "j2", 10, 100);
      spoolman.state.loseAnswers = 1;
      await h.app.spoolPush.run();
      expect(usedIn(vendor.id)).toBe(122.5);
      expect(await pending(h, id)).toBe(1);
      await h.app.spoolPush.run();
      expect(usedIn(vendor.id)).toBe(122.5);
      expect(patches()).toHaveLength(2);
      expect(await pending(h, id)).toBe(0);
    });

    it("keeps what a print took while the machine is offline, and writes it once it's back", async () => {
      const state: MockState = { ...fixture(), prints: [], status: [] };
      const { h, c, devDir, id, vendor } = await setup(state);
      await hubPrinter(h);
      c.link.close();
      await offline(h);
      await hubPrint(h, state, "j1", 10);
      await h.app.spoolPush.run();
      expect(await pending(h, id)).toBe(1);
      expect(patches()).toEqual([]);
      const again = connector(state, devDir);
      again.link.start();
      await until(() => again.link.state().status === "online");
      await h.app.spoolPush.run();
      expect(usedIn(vendor.id)).toBe(110);
      await h.app.spoolPush.run();
      expect(patches()).toHaveLength(1);
      expect(await pending(h, id)).toBe(0);
    });

    it("a printer through the same machine that reports to Spoolman isn't written twice", async () => {
      const state: MockState = { ...fixture(), status: [snap("idle")] };
      const { h, c, deviceId, vendor, mine } = await setup(state);
      const printer = await h.send("POST", "/api/integrations", {
        adapterId: "mock-host",
        config: { host: "printer.lan" },
        secrets: { token: SECRET },
        deviceId,
        printer: "new",
      });
      expect(printer.statusCode).toBe(201);
      h.app.printerStatus.refresh();
      await until(() => c.link.sources?.watching() === 2);
      const reported = (st: PrinterSnapshot["state"], progress = 50): PrinterSnapshot => ({
        ...snap(st, progress),
        slots: [
          {
            slot: 0,
            material: "PLA",
            colorHex: "#ff8800",
            active: st === "printing",
            gramsUsed: 8,
            spoolId: `spoolman:${vendor.id}`,
            chargedAtSource: true,
          },
        ],
      });
      state.status = [reported("printing")];
      await until(() => h.app.printerStatus.all()[0]?.snapshot.state === "printing");
      state.status = [reported("finished", 100)];
      await until(() => h.prints().length === 1);
      expect(h.db.select().from(schema.printFilamentUsages).get()).toMatchObject({
        spoolId: mine,
        chargedAtSource: true,
      });
      await h.app.spoolPush.run();
      expect(patches()).toEqual([]);
      expect(usedIn(vendor.id)).toBe(100);
    });

    it("the connector writes only usage and new spools, and only to its spool library", async () => {
      const state: MockState = { ...fixture(), status: [snap("idle")] };
      const { h, c, deviceId, id, vendor } = await setup(state);
      const printer = await h.send("POST", "/api/integrations", {
        adapterId: "mock-host",
        config: { host: "printer.lan" },
        secrets: { token: SECRET },
        deviceId,
        printer: "new",
      });
      const write = (integrationId: string, w: object) =>
        new Promise((done) =>
          c.link.sources?.write(
            { type: "spools.write", requestId: randomUUID(), integrationId, write: w as never },
            async (body) => done(body),
          ),
        );
      const usage = (key: string, grams: number) => ({
        op: "usage",
        spoolId: String(vendor.id),
        key,
        grams,
        sent: 0,
      });
      const key = `${randomUUID()}:0`;
      expect(await write(printer.json().id, usage(key, 5))).toEqual({ ok: false, code: "ENOTSUP" });
      expect(await write(randomUUID(), usage(key, 5))).toEqual({ ok: false, code: "ENOENT" });
      expect(patches()).toEqual([]);
      // Anything but the two writes isn't an event it takes (it answers ENOTSUP).
      const other = { type: "spools.write", requestId: randomUUID(), integrationId: id };
      expect(
        hubEventSchema.safeParse({ ...other, write: { op: "delete", spoolId: "1" } }).success,
      ).toBe(false);
      expect(hubEventSchema.safeParse({ ...other, write: usage("../spool", 5) }).success).toBe(
        false,
      );
      // A late write and the next one at once: one after the other, so neither is lost.
      const both = await Promise.all([
        write(id, usage(key, 5)),
        write(id, usage(`${randomUUID()}:1`, 7)),
      ]);
      expect(both).toEqual([
        { ok: true, result: {} },
        { ok: true, result: {} },
      ]);
      expect(usedIn(vendor.id)).toBe(112);
      // The same again: already there.
      expect(await write(id, usage(key, 5))).toEqual({ ok: true, result: {} });
      expect(usedIn(vendor.id)).toBe(112);
      expect(patches()).toHaveLength(2);
      expect(h.app.printerStatus.all()).toHaveLength(0);
    });
  });
});
