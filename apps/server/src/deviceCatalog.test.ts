import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioAdapter, bambuStudioWorkerAdapter } from "@3d-maker-suite/adapter-bambu";
import { BUILT_IN_ROLE_IDS, emptyPresetLibrary } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { extract, zipFolder } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { createDeviceCatalog } from "./integrations/deviceCatalog.ts";
import { hashPassword } from "./lib/password.ts";

const PW = "password123";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PW);
});
let close: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/**
 * A worker-only hub: two paired devices that report Bambu Studio, the first one a worker that
 * offers it (Use as slicer), so the hub's slicer by default (ADR-0022).
 */
async function hub() {
  const db = openDb(":memory:");
  const dataDir = mkdtempSync(join(tmpdir(), "device-catalog-"));
  const app = await buildApp(db, { stream: { write: () => true } }, dataDir, {
    adapters: [bambuStudioAdapter(), bambuStudioWorkerAdapter()],
  });
  close = async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  const admin = db
    .insert(schema.users)
    .values({
      email: "a@x.io",
      displayName: "admin",
      roleId: BUILT_IN_ROLE_IDS.admin,
      passwordHash: hash,
    })
    .returning()
    .get();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: admin.email, password: PW },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const send = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  await send("PATCH", "/api/preferences", { hubEnabled: true });
  const base = await app.listen({ port: 0, host: "127.0.0.1" });

  const pair = async (name: string) => {
    const { code } = (await send("POST", "/api/hub/pairing-codes", { userId: admin.id })).json();
    const { token, deviceId } = (
      await app.inject({ method: "POST", url: "/api/hub/pair", payload: { code, name } })
    ).json() as { token: string; deviceId: string };
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({
      method: "PUT",
      url: "/api/hub/device/slicers",
      payload: [{ id: "bambu-studio", version: null, path: "x" }],
      headers,
    });
    /** Its `system/` with one vendor at `version`, zipped as the connector sends it. */
    const upload = async (version: string) => {
      const dir = mkdtempSync(join(dataDir, "upload-"));
      writeFileSync(join(dir, "BBL.json"), JSON.stringify({ name: "Bambu Lab", version }));
      mkdirSync(join(dir, "BBL"));
      await zipFolder(dir, join(dir, "..", `${name}.zip`), "system/");
      return app.inject({
        method: "PUT",
        url: "/api/hub/device/catalog/bambu-studio",
        payload: readFileSync(join(dir, "..", `${name}.zip`)),
        headers: { ...headers, "content-type": "application/octet-stream" },
      });
    };
    /** Opens its event stream: the connect's headers, and the next request of a type. */
    const connect = async () => {
      const res = await fetch(`${base}/api/hub/events`, { headers });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let text = "";
      const next = async (type: string) => {
        for (;;) {
          const at = text.indexOf(`event: ${type}\n`);
          if (at >= 0) {
            const line = text.slice(at).split("\n")[1] ?? "";
            text = text.slice(at + type.length + 8);
            return JSON.parse(line.replace(/^data: /, ""));
          }
          const { done, value } = await reader.read();
          if (done) throw new Error("stream ended");
          text += dec.decode(value, { stream: true });
        }
      };
      const answer = (requestId: string, body: object) =>
        app.inject({
          method: "POST",
          url: `/api/hub/device/replies/${requestId}`,
          payload: body,
          headers,
        });
      return {
        sources: JSON.parse(res.headers.get("x-catalog-sources") ?? "null"),
        installs: JSON.parse(res.headers.get("x-catalog-install") ?? "null"),
        next,
        answer,
        close: () => reader.cancel(),
      };
    };
    /** A device route, as its connector calls it. */
    const call = (method: "GET" | "PUT", url: string, payload?: object) =>
      app.inject({ method, url: `/api/hub/device${url}`, payload, headers });
    return { deviceId, upload, connect, call };
  };

  const ws1 = await pair("WS-1");
  const ws2 = await pair("WS-2");
  const addWorker = async (deviceId: string) =>
    (
      await send("POST", "/api/integrations", {
        adapterId: "bambu-studio-worker",
        config: { deviceId, source: "installed" },
      })
    ).json() as { id: string };
  const offer = (deviceId: string) =>
    send("PATCH", `/api/hub/devices/${deviceId}/slicers/bambu-studio`, { slicer: true });
  const worker = await addWorker(ws1.deviceId);
  await offer(ws1.deviceId);
  const fingerprint = () =>
    db.select().from(schema.integrations).where(eq(schema.integrations.id, worker.id)).get()
      ?.catalogFingerprint;
  /** Until the catalog check after an upload has run. */
  const checked = async (want: string) => {
    for (let i = 0; i < 100 && fingerprint() !== want; i++)
      await new Promise((r) => setTimeout(r, 20));
    return fingerprint();
  };
  return { db, dataDir, send, ws1, ws2, worker, checked, addWorker, offer };
}

it("a worker-only hub gets its catalog from the hub's slicer's machine; another sends nothing", async () => {
  const { db, dataDir, send, ws1, ws2, worker, checked, addWorker, offer } = await hub();
  // No row on the server: the machine that offers it is the hub's slicer, so the source.
  const one = await ws1.connect();
  expect(one.sources).toEqual({ "bambu-studio": null });
  const two = await ws2.connect();
  expect(two.sources).toEqual({});

  expect((await ws2.upload("01.00")).json()).toMatchObject({ error: { code: "not_source" } });
  expect((await ws1.upload("01.00")).statusCode).toBe(204);
  const copy = join(dataDir, "slicers", worker.id, "config", "system", "BBL.json");
  expect(JSON.parse(readFileSync(copy, "utf8")).version).toBe("01.00");
  // The copy is the worker's presets to slice with, as a zip's would be: it isn't unavailable.
  const row = (await send("GET", `/api/integrations/${worker.id}`)).json();
  expect(row.slicerConfigDir).toBe(join(dataDir, "slicers", worker.id, "config"));
  // A first sight is only recorded (ADR-0019); a slicer update is a change for the check.
  expect(await checked("BBL=01.00")).toBe("BBL=01.00");
  expect((await ws1.upload("01.01")).statusCode).toBe(204);
  expect(await checked("BBL=01.01")).toBe("BBL=01.01");

  // Reconnected, it knows the hub has that one: nothing to send.
  await one.close();
  const again = await ws1.connect();
  expect(again.sources).toEqual({ "bambu-studio": "BBL=01.01" });

  // A connector too old for it refuses the pick, which stays as it was.
  const pick = (integrationId: string) =>
    send("PUT", "/api/integrations/slicers/bambu-studio", { integrationId });
  // Only a machine that offers the slicer (Use as slicer) can be picked (ADR-0022).
  const options = async () =>
    (await send("GET", "/api/catalog/sources")).json()[0].options.map((o: object) => o);
  expect(await options()).toEqual([{ deviceId: ws1.deviceId, name: "WS-1" }]);
  const other = await addWorker(ws2.deviceId);
  expect((await pick(other.id)).json()).toMatchObject({ error: { code: "not_an_option" } });
  expect((await offer(ws2.deviceId)).statusCode).toBe(204);
  expect((await send("GET", "/api/catalog/sources")).json()[0].machines).toEqual([
    {
      deviceId: ws1.deviceId,
      name: "WS-1",
      userId: expect.any(String),
      online: true,
      outdated: false,
      slicer: true,
      receive: false,
      install: null,
      mismatch: null,
    },
    {
      deviceId: ws2.deviceId,
      name: "WS-2",
      userId: expect.any(String),
      online: true,
      outdated: false,
      slicer: true,
      receive: false,
      install: null,
      mismatch: null,
    },
  ]);
  const refused = pick(other.id);
  const probe = await two.next("catalog.sources");
  await two.answer(probe.requestId, { ok: false, code: "ENOTSUP" });
  expect((await refused).json()).toMatchObject({ error: { code: "device_outdated" } });
  expect((await send("GET", "/api/catalog/sources")).json()[0].source).toMatchObject({
    deviceId: ws1.deviceId,
    picked: false,
  });

  // Picked: the old source is told to stop, the new one to send.
  const picked = pick(other.id);
  const ok = await two.next("catalog.sources");
  await two.answer(ok.requestId, { ok: true, result: null });
  const told = async (device: typeof two) => {
    const e = await device.next("catalog.sources");
    await device.answer(e.requestId, { ok: true, result: null });
    return e.libraries;
  };
  // Its copy goes in its own install's folder: the hub has none of it yet, so it sends.
  expect(await Promise.all([told(again), told(two)])).toEqual([{}, { "bambu-studio": null }]);
  expect((await picked).statusCode).toBe(204);
  expect((await ws1.upload("01.02")).json()).toMatchObject({ error: { code: "not_source" } });
  await again.close();
  await two.close();

  // The old hub's slicer's copy goes, or parents and All settings would still read it. A zip's copy
  // (no mark) stays.
  const tell = () =>
    createDeviceCatalog(
      db,
      [bambuStudioAdapter(), bambuStudioWorkerAdapter()],
      { online: () => false } as never,
      dataDir,
    ).tell();
  await tell();
  expect(existsSync(copy)).toBe(false);
  mkdirSync(join(copy, ".."), { recursive: true });
  writeFileSync(copy, "{}");
  await tell();
  expect(existsSync(copy)).toBe(true);
  // A hub with two paired devices takes a few seconds to build.
}, 20_000);

it("a machine with Receive catalog gets the hub's copy; the source can't receive", async () => {
  const { db, dataDir, send, ws1, ws2 } = await hub();
  const one = await ws1.connect();
  expect(one.installs).toEqual({});
  expect((await ws1.upload("01.00")).statusCode).toBe(204);
  const receive = (deviceId: string, on: boolean) =>
    send("PATCH", `/api/hub/devices/${deviceId}/slicers/bambu-studio`, {
      system: { receive: on },
    });
  // The hub's slicer reads its own folder: it receives none.
  expect((await receive(ws1.deviceId, true)).json()).toMatchObject({
    error: { code: "hub_slicer" },
  });
  // Offline, the switch is saved; the connect says what to receive.
  expect((await receive(ws2.deviceId, true)).statusCode).toBe(204);
  const two = await ws2.connect();
  expect(two.installs).toEqual({ "bambu-studio": "BBL=01.00" });

  // The hub's copy, zipped, for a receiver only.
  const zip = await ws2.call("GET", "/catalog/bambu-studio/system");
  expect(zip.statusCode).toBe(200);
  const out = mkdtempSync(join(dataDir, "received-"));
  writeFileSync(join(out, "system.zip"), zip.rawPayload);
  await extract(join(out, "system.zip"), out);
  expect(JSON.parse(readFileSync(join(out, "system", "BBL.json"), "utf8")).version).toBe("01.00");
  expect((await ws1.call("GET", "/catalog/bambu-studio/system")).json()).toMatchObject({
    error: { code: "not_receiving" },
  });

  // What it reports shows on its line.
  const report = {
    library: "bambu-studio",
    hub: "BBL=01.00",
    fingerprint: "BBL=01.00",
    waiting: false,
    backup: null,
    error: null,
  };
  expect((await ws2.call("PUT", "/catalog-install", [report])).statusCode).toBe(204);
  const machine = async () =>
    (await send("GET", "/api/catalog/sources"))
      .json()[0]
      .machines.find((m: { deviceId: string }) => m.deviceId === ws2.deviceId);
  expect(await machine()).toMatchObject({ receive: true, install: report, mismatch: null });

  // A new copy from the source: the receiver hears of it at once.
  expect((await ws1.upload("01.01")).statusCode).toBe(204);
  const told = await two.next("catalog.install");
  expect(told.libraries).toEqual({ "bambu-studio": "BBL=01.01" });
  await two.answer(told.requestId, { ok: true, result: null });

  // Off: told, and its report goes.
  expect((await receive(ws2.deviceId, false)).statusCode).toBe(204);
  const off = await two.next("catalog.install");
  expect(off.libraries).toEqual({});
  await two.answer(off.requestId, { ok: true, result: null });
  // Still listed: a machine with the slicer can receive (Receive from the hub lists it).
  expect(await machine()).toMatchObject({ receive: false, install: null });

  // A connector too old for it refuses, and the switch stays off.
  const refused = receive(ws2.deviceId, true);
  const probe = await two.next("catalog.install");
  await two.answer(probe.requestId, { ok: false, code: "ENOTSUP" });
  expect((await refused).json()).toMatchObject({ error: { code: "device_outdated" } });
  const row = db.select().from(schema.devices).where(eq(schema.devices.id, ws2.deviceId)).get();
  expect(row?.presetLibraries["bambu-studio"]?.system.receive).toBe(false);
  expect(row?.catalogInstall).toEqual([]);

  // Another major.minor than the source's: nothing is sent.
  const slicer = (version: string) => [{ id: "bambu-studio", version, path: "x" }];
  db.update(schema.devices)
    .set({ slicers: slicer("02.04.00.70") })
    .where(eq(schema.devices.id, ws1.deviceId))
    .run();
  db.update(schema.devices)
    .set({
      slicers: slicer("02.03.01.00"),
      presetLibraries: {
        "bambu-studio": { ...emptyPresetLibrary(), system: { receive: true } },
      },
    })
    .where(eq(schema.devices.id, ws2.deviceId))
    .run();
  expect((await machine())?.mismatch).toEqual({ here: "2.3", source: "2.4" });
  expect((await ws2.call("GET", "/catalog/bambu-studio/system")).statusCode).toBe(403);
  await one.close();
  await two.close();
}, 20_000);

it("the server's own install receives the hub's copy: closed only, a backup first, same major.minor", async () => {
  const { db, dataDir, send, ws1, worker } = await hub();
  expect((await ws1.upload("01.00")).statusCode).toBe(204);
  // A Bambu Studio folder on this computer, older than the hub's copy, with a file of its own.
  const cfg = mkdtempSync(join(dataDir, "local-"));
  mkdirSync(join(cfg, "system", "BBL"), { recursive: true });
  writeFileSync(join(cfg, "system", "BBL.json"), JSON.stringify({ version: "00.09" }));
  writeFileSync(join(cfg, "system", "BBL", "bed.stl"), "mine");
  const local = (await send("POST", "/api/integrations", { adapterId: "bambu-studio" })).json() as {
    id: string;
  };
  expect(
    (await send("PATCH", `/api/integrations/${local.id}`, { slicerConfigDir: cfg })).statusCode,
  ).toBe(200);
  const rowOf = (id: string) =>
    db.select().from(schema.integrations).where(eq(schema.integrations.id, id)).get();
  db.update(schema.integrations)
    .set({ catalogReceive: true })
    .where(eq(schema.integrations.id, local.id))
    .run();
  db.update(schema.integrations)
    .set({ slicerVersion: "02.04.00.10" })
    .where(eq(schema.integrations.id, worker.id))
    .run();

  let running = true;
  let version = "02.04.01.00";
  const catalog = createDeviceCatalog(
    db,
    [bambuStudioAdapter(), bambuStudioWorkerAdapter()],
    { online: () => false } as never,
    dataDir,
    () => {},
    {
      processes: async () => (running ? '"bambu-studio.exe","1"\n' : '"x.exe","2"\n'),
      find: async () => [{ version } as never],
    },
  );
  const bbl = () => JSON.parse(readFileSync(join(cfg, "system", "BBL.json"), "utf8")).version;

  // Open: it waits, nothing is written.
  await catalog.receiveHere();
  expect(rowOf(local.id)?.catalogInstall).toMatchObject({
    library: "bambu-studio",
    hub: "BBL=01.00",
    fingerprint: "BBL=00.09",
    waiting: true,
    backup: null,
  });
  expect(bbl()).toBe("00.09");

  // Closed: a backup, then the copy laid over; its own file stays.
  running = false;
  await catalog.receiveHere();
  expect(bbl()).toBe("01.00");
  expect(readFileSync(join(cfg, "system", "BBL", "bed.stl"), "utf8")).toBe("mine");
  expect(existsSync(join(dataDir, "catalog-backups", `${local.id}.zip`))).toBe(true);
  expect(rowOf(local.id)?.catalogInstall).toMatchObject({
    hub: "BBL=01.00",
    fingerprint: "BBL=01.00",
    waiting: false,
    error: null,
  });

  // Another major.minor than the hub's slicer's: nothing. (No upload here: it would start the
  // app's own look, with this computer's real processes.)
  writeFileSync(join(cfg, "system", "BBL.json"), JSON.stringify({ version: "00.09" }));
  version = "02.05.00.00";
  await catalog.receiveHere();
  expect(bbl()).toBe("00.09");
  expect(rowOf(local.id)?.catalogInstall?.hub).toBeNull();

  // Only a slicer on this computer has the switch, never the hub's slicer; picking it turns it off.
  expect(
    (await send("PATCH", `/api/integrations/${worker.id}`, { catalogReceive: true })).json(),
  ).toMatchObject({ error: { code: "not_local" } });
  expect(
    (await send("PUT", "/api/integrations/slicers/bambu-studio", { integrationId: local.id }))
      .statusCode,
  ).toBe(204);
  expect(rowOf(local.id)).toMatchObject({ catalogReceive: false, catalogInstall: null });
  expect(
    (await send("PATCH", `/api/integrations/${local.id}`, { catalogReceive: true })).json(),
  ).toMatchObject({ error: { code: "hub_slicer" } });
}, 20_000);

it("a machine's managed install is the source: sent from its install folder", async () => {
  const { db, dataDir, ws1, worker } = await hub();
  // Found by no one: the machine reports no desktop slicer.
  db.update(schema.devices)
    .set({ slicers: [], system: { platform: "win32", arch: "x64" } })
    .where(eq(schema.devices.id, ws1.deviceId))
    .run();
  db.update(schema.integrations)
    .set({
      config: { deviceId: ws1.deviceId, source: "managed" },
      slicerPath: String.raw`C:\cs\slicers\w\2.4.0\bambu-studio.exe`,
    })
    .where(eq(schema.integrations.id, worker.id))
    .run();
  const catalog = createDeviceCatalog(
    db,
    [bambuStudioAdapter(), bambuStudioWorkerAdapter()],
    { online: () => false } as never,
    dataDir,
  );
  expect(await catalog.sourcesOf(ws1.deviceId)).toEqual({ "bambu-studio": null });
  expect(catalog.dirsOf(ws1.deviceId)).toEqual({
    "bambu-studio": String.raw`C:\cs\slicers\w\2.4.0\resources\profiles`,
  });
  // Linux: the AppImage's profiles beside its AppRun.
  db.update(schema.devices)
    .set({ system: { platform: "linux", arch: "x64", glibc: "2.39" } })
    .where(eq(schema.devices.id, ws1.deviceId))
    .run();
  db.update(schema.integrations)
    .set({ slicerPath: "/home/u/cs/slicers/w/2.4.0/squashfs-root/AppRun" })
    .where(eq(schema.integrations.id, worker.id))
    .run();
  expect(catalog.dirsOf(ws1.deviceId)).toEqual({
    "bambu-studio": "/home/u/cs/slicers/w/2.4.0/squashfs-root/resources/profiles",
  });
}, 20_000);
