import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  BUILT_IN_ROLE_IDS,
  emptyPresetLibrary,
  type FilamentLibrary,
  type IntegrationAdapter,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { loadKey } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { librarySources, pickHubSlicer } from "./integrations/catalogSource.ts";
import { createSyncer } from "./integrations/sync.ts";

const { devices, integrations, settings, syncPolicies, users } = schema;

let db: ReturnType<typeof openDb>;
let dataDir: string;
let adapters: IntegrationAdapter[];
let first: string;
let second: string;

const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString();

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sources-"));
  const library: FilamentLibrary = {
    id: "fake",
    defaultDirs: () => [dataDir],
    read: async () => [],
    readCatalog: async () => ({ models: [], machines: [], processes: [] }),
    catalogFingerprint: async () => "Acme=1",
  };
  const slicer = {
    ...mockAdapter(fixture()),
    id: "slicer",
    kind: "local",
    capabilities: ["brands", "printerModels", "machinePresets", "processPresets"],
    library,
  } as IntegrationAdapter;
  // The same slicer as a connector finds it on a workstation.
  const desk = { ...slicer, id: "slicer-desk", desktop: {} } as IntegrationAdapter;
  // On a slice worker: no folder on the hub.
  const worker = {
    ...slicer,
    id: "slicer-worker",
    kind: "worker",
    library: { ...library, defaultDirs: () => [] },
  } as IntegrationAdapter;
  adapters = [slicer, desk, worker];
  db = openDb(":memory:");
  const row = (min: number) =>
    db
      .insert(integrations)
      .values({ adapterId: "slicer", createdAt: at(min) })
      .returning()
      .get().id;
  first = row(0);
  second = row(1);
});

const sources = () => librarySources(db, adapters);
const fingerprints = () =>
  Object.fromEntries(
    db
      .select()
      .from(integrations)
      .all()
      .map((r) => [r.id, r.catalogFingerprint]),
  );
const quiet = { warn: () => {}, info: () => {}, error: () => {}, child: () => quiet } as never;
const check = () => createSyncer(db, adapters, loadKey(dataDir), quiet, dataDir);

/** The hub on, and two devices of one user that report the slicer. */
function twoDevices() {
  db.insert(settings).values({ key: "hubEnabled", value: true }).run();
  const userId = db
    .insert(users)
    .values({
      email: "a@x.io",
      displayName: "A",
      roleId: BUILT_IN_ROLE_IDS.admin,
      passwordHash: "x",
    })
    .returning()
    .get().id;
  const device = (name: string, min: number) =>
    db
      .insert(devices)
      .values({
        name,
        userId,
        tokenHash: name,
        slicers: [{ id: "slicer-desk", version: null, path: "x" }],
        createdAt: at(min),
      })
      .returning()
      .get().id;
  return [device("WS-1", 2), device("WS-2", 3)] as const;
}

/** A worker install of the slicer on `deviceId`: an option for the hub's slicer (ADR-0022). */
function worker(deviceId: string, min: number) {
  return db
    .insert(integrations)
    .values({
      adapterId: "slicer-worker",
      config: { deviceId, source: "installed" },
      createdAt: at(min),
    })
    .returning()
    .get().id;
}
const receiveOn = (deviceId: string) =>
  db
    .update(devices)
    .set({
      presetLibraries: {
        fake: { ...emptyPresetLibrary(), system: { receive: true } },
      },
    })
    .where(eq(devices.id, deviceId))
    .run();

describe("the hub's slicer is the catalog source (ADR-0022)", () => {
  it("defaults to the oldest install; a pick wins and is the only one read", async () => {
    expect(sources()).toEqual([
      {
        library: "fake",
        routes: [
          { integrationId: first, presets: 0 },
          { integrationId: second, presets: 0 },
        ],
        source: { integrationId: first, picked: false },
        options: [
          { integrationId: first, readable: true },
          { integrationId: second, readable: true },
        ],
        machines: [],
        cardsOf: first,
      },
    ]);
    await check().checkCatalogs();
    expect(fingerprints()).toEqual({ [first]: "Acme=1", [second]: null });

    await pickHubSlicer(db, adapters, "fake", second);
    expect(sources()[0]?.source).toEqual({ integrationId: second, picked: true });
    db.update(integrations).set({ catalogFingerprint: null }).run();
    await check().checkCatalogs();
    expect(fingerprints()).toEqual({ [first]: null, [second]: "Acme=1" });

    // A removed pick falls back to the default.
    db.delete(integrations).where(eq(integrations.id, second)).run();
    expect(sources()[0]?.source).toEqual({ integrationId: first, picked: false });
  });

  it("a switched-off install stays on Sources, but can't be the hub's slicer", () => {
    db.update(integrations).set({ enabled: false }).where(eq(integrations.id, second)).run();
    const lib = sources()[0];
    expect(lib?.routes.map((r) => r.integrationId)).toContain(second);
    expect(lib?.options).toEqual([{ integrationId: first, readable: true }]);
  });

  it("offers every enabled machine install, beside the server's", async () => {
    const [ws1, ws2] = twoDevices();
    const w1 = worker(ws1, 4);
    const w2 = worker(ws2, 5);
    db.update(integrations).set({ enabled: false }).where(eq(integrations.id, w2)).run();
    // The server's own installs don't keep machines out any more.
    expect(sources()[0]).toMatchObject({
      source: { integrationId: first, picked: false },
      options: [
        { integrationId: first },
        { integrationId: second },
        { deviceId: ws1, name: "WS-1" },
      ],
    });
    await expect(pickHubSlicer(db, adapters, "fake", w2)).rejects.toMatchObject({
      code: "not_an_option",
    });

    // The machine is asked first: its refusal keeps the old pick.
    const asked: string[] = [];
    await expect(
      pickHubSlicer(db, adapters, "fake", w1, async (d) => {
        asked.push(d);
        throw Object.assign(new Error("old"), { code: "device_outdated" });
      }),
    ).rejects.toMatchObject({ code: "device_outdated" });
    expect(asked).toEqual([ws1]);
    expect(sources()[0]?.source).toEqual({ integrationId: first, picked: false });

    await pickHubSlicer(db, adapters, "fake", w1);
    expect(sources()[0]).toMatchObject({ source: { deviceId: ws1, picked: true }, cardsOf: w1 });
    // A machine's copy isn't on the hub until it sends it: the server's folders aren't read.
    await check().checkCatalogs();
    expect(fingerprints()).toEqual({ [first]: null, [second]: null, [w1]: null, [w2]: null });

    // Switched off: no longer an option, the default takes over.
    db.update(integrations).set({ enabled: false }).where(eq(integrations.id, w1)).run();
    expect(sources()[0]?.source).toEqual({ integrationId: first, picked: false });
  });

  it("Receive catalog: never on the hub's slicer, and only for its major.minor (ADR-0021)", async () => {
    const [ws1, ws2] = twoDevices();
    db.delete(integrations).run();
    const w1 = worker(ws1, 4);
    receiveOn(ws1);
    receiveOn(ws2);
    const machine = (id: string) => sources()[0]?.machines.find((m) => m.deviceId === id);
    // WS-1 is the default hub's slicer: it shows as not receiving.
    expect(sources()[0]?.source).toEqual({ deviceId: ws1, picked: false });
    expect(machine(ws1)).toMatchObject({ slicer: true, receive: false });
    expect(machine(ws2)).toMatchObject({ slicer: true, receive: true, install: null });

    const version = (id: string, v: string | null) =>
      db
        .update(devices)
        .set({ slicers: [{ id: "slicer-desk", version: v, path: "x" }] })
        .where(eq(devices.id, id))
        .run();
    version(ws1, "02.04.00.70");
    version(ws2, "2.4.1");
    expect(machine(ws2)?.mismatch).toBeNull();
    version(ws2, "02.03.01.00");
    expect(machine(ws2)?.mismatch).toEqual({ here: "2.3", source: "2.4" });
    // A machine with the slicer and no switches is still listed: it can receive.
    db.update(devices).set({ presetLibraries: {} }).where(eq(devices.id, ws2)).run();
    expect(machine(ws2)).toMatchObject({ slicer: true, receive: false, mismatch: null });
    version(ws2, null);
    expect(machine(ws2)?.mismatch).toBeNull();

    // Picked as the hub's slicer, a machine's Receive goes off.
    await pickHubSlicer(db, adapters, "fake", w1);
    const row = db.select().from(devices).where(eq(devices.id, ws1)).get();
    expect(row?.presetLibraries.fake).toMatchObject({ system: { receive: false } });
  });

  it("picking turns slicing and the Catalog and System presets cards on, and refuses the rest", async () => {
    for (const type of ["brands", "machinePresets"] as const)
      db.insert(syncPolicies)
        .values({ integrationId: second, type, mode: "off", frequency: "1d" })
        .run();
    await pickHubSlicer(db, adapters, "fake", second);
    expect(
      db
        .select({ type: syncPolicies.type, mode: syncPolicies.mode })
        .from(syncPolicies)
        .all()
        .filter((p) => ["brands", "machinePresets"].includes(p.type)),
    ).toEqual([
      { type: "brands", mode: "auto" },
      { type: "machinePresets", mode: "auto" },
    ]);
    await expect(pickHubSlicer(db, adapters, "fake", crypto.randomUUID())).rejects.toMatchObject({
      code: "not_an_option",
    });
    await expect(pickHubSlicer(db, adapters, "other", first)).rejects.toMatchObject({
      code: "not_an_option",
    });
  });
});
