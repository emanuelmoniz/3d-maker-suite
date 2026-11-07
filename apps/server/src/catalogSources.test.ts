import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  BUILT_IN_ROLE_IDS,
  type FilamentLibrary,
  type IntegrationAdapter,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { loadKey } from "@3d-maker-suite/host";
import { beforeEach, describe, expect, it } from "vitest";
import { librarySources, pickCatalogSource } from "./integrations/catalogSource.ts";
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
    capabilities: ["brands", "printerModels", "machineProfiles", "printProfiles"],
    library,
  } as IntegrationAdapter;
  // The same slicer as a connector finds it on a workstation.
  const desk = { ...slicer, id: "slicer-desk", desktop: {} } as IntegrationAdapter;
  adapters = [slicer, desk];
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

describe("catalog source (ADR-0020)", () => {
  it("defaults to the oldest row with a readable folder; a pick wins and is the only one read", async () => {
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
        cardsOf: first,
      },
    ]);
    await check().checkCatalogs();
    expect(fingerprints()).toEqual({ [first]: "Acme=1", [second]: null });

    pickCatalogSource(db, adapters, "fake", { integrationId: second });
    expect(sources()[0]?.source).toEqual({ integrationId: second, picked: true });
    db.update(integrations).set({ catalogFingerprint: null }).run();
    await check().checkCatalogs();
    expect(fingerprints()).toEqual({ [first]: null, [second]: "Acme=1" });

    // A removed pick falls back to the default.
    db.delete(integrations).run();
    expect(sources()).toEqual([]);
  });

  it("switches between two devices; a device source reads no folder", async () => {
    const [ws1, ws2] = twoDevices();
    expect(sources()[0]?.options.slice(2)).toEqual([
      { deviceId: ws1, name: "WS-1" },
      { deviceId: ws2, name: "WS-2" },
    ]);
    pickCatalogSource(db, adapters, "fake", { deviceId: ws1 });
    expect(sources()[0]).toMatchObject({ source: { deviceId: ws1, picked: true }, cardsOf: first });
    pickCatalogSource(db, adapters, "fake", { deviceId: ws2 });
    expect(sources()[0]?.source).toEqual({ deviceId: ws2, picked: true });
    await check().checkCatalogs();
    expect(fingerprints()).toEqual({ [first]: null, [second]: null });

    // It stops reporting the slicer: the default again.
    db.update(devices).set({ slicers: [] }).run();
    expect(sources()[0]?.source).toEqual({ integrationId: first, picked: false });
  });

  it("with no install row able to, the first device that reports it", () => {
    const [ws1] = twoDevices();
    db.update(integrations)
      .set({ slicerConfigDir: join(dataDir, "gone") })
      .run();
    expect(sources()[0]?.source).toEqual({ deviceId: ws1, picked: false });
  });

  it("picking turns the Catalog and System presets cards on, and refuses what can't be one", () => {
    for (const type of ["brands", "machineProfiles"] as const)
      db.insert(syncPolicies)
        .values({ integrationId: second, type, mode: "off", frequency: "1d" })
        .run();
    pickCatalogSource(db, adapters, "fake", { integrationId: second });
    expect(
      db
        .select({ type: syncPolicies.type, mode: syncPolicies.mode })
        .from(syncPolicies)
        .all()
        .filter((p) => ["brands", "machineProfiles"].includes(p.type)),
    ).toEqual([
      { type: "brands", mode: "manual" },
      { type: "machineProfiles", mode: "manual" },
    ]);
    expect(() =>
      pickCatalogSource(db, adapters, "fake", { deviceId: crypto.randomUUID() }),
    ).toThrow(expect.objectContaining({ code: "not_a_source" }));
    expect(() => pickCatalogSource(db, adapters, "other", { integrationId: first })).toThrow();
  });
});
