import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  defaultPolicy,
  type FilamentLibrary,
  type IntegrationAdapter,
  type ProfileSettings,
  USER_PRESET_TYPES,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { savePreset } from "./integrations/presetLibrary.ts";
import { insertProfile } from "./testSeed.ts";

// Plan 5.4.0 Step 16: a profile's file, every setting with its parents filled in. The reader itself
// is tested in packages/slicer-presets; this is which source the server reads and what it says.

const { syncPolicies } = schema;
type Ref = { scope: "system" | "user"; name: string };

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;
let id: string;
/** What the fake slicer was asked: the folder, kind, preset and the hub's own copy. */
let asked: { dir: string; kind: string; ref: Ref; own?: Record<string, unknown> }[];

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "profile-settings-"));
  asked = [];
  const library: FilamentLibrary = {
    id: "fake",
    defaultDirs: () => [dataDir],
    read: async () => [],
    settings: async (dir, kind, ref, own) => {
      asked.push({ dir, kind, ref, own });
      if (own)
        return {
          parents: ["Base"],
          missing: null,
          settings: [{ key: "name", value: String(own.name), from: null }],
        };
      return ref.name === "A"
        ? {
            parents: ["Base", "Root"],
            missing: null,
            settings: [
              { key: "filament_type", value: "PLA", from: "Root" },
              { key: "nozzle_temperature", value: "220", from: null },
            ],
          }
        : undefined;
    },
  };
  const slicer = {
    ...mockAdapter(fixture()),
    id: "slicer",
    kind: "local",
    capabilities: ["filamentProfiles", ...USER_PRESET_TYPES],
    library,
  } as IntegrationAdapter;
  db = openDb(":memory:");
  app = await buildApp(db, false, dataDir, { adapters: [slicer] });
  id = (
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "slicer", secrets: { token: "t" } },
    })
  ).json().id;
});

const settings = async (url: string) => {
  const res = await app.inject(url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ProfileSettings;
};
const filament = (sourcePreset: string | null) =>
  insertProfile(db, "filamentProfiles", { name: "A", sourcePreset }).id;

describe("a profile's settings", () => {
  it("lists a system profile's values with their parents, from the slicer's folder", async () => {
    mkdirSync(join(dataDir, "system"));
    const got = await settings(`/api/filament/profiles/${filament("fake:system/A")}/settings`);
    expect(got).toMatchObject({
      status: "ok",
      parents: ["Base", "Root"],
      settings: [
        { key: "filament_type", from: "Root" },
        { key: "nozzle_temperature", from: null },
      ],
    });
    expect(asked[0]).toMatchObject({ dir: dataDir, kind: "filament", ref: { scope: "system" } });
  });

  it("reads machine and print profiles under their own prefix", async () => {
    mkdirSync(join(dataDir, "system"));
    const brand = (
      await app.inject({ method: "POST", url: "/api/brands", payload: { name: "Acme" } })
    ).json();
    const model = (
      await app.inject({
        method: "POST",
        url: "/api/printer-models",
        payload: { brandId: brand.id, model: "X1" },
      })
    ).json();
    const machine = insertProfile(db, "machineProfiles", {
      name: "A",
      sourcePreset: "fake:system/A",
      printerModelId: model.id,
    });
    const print = insertProfile(db, "printProfiles", { name: "A", sourcePreset: "fake:system/A" });
    await settings(`/api/machine-profiles/${machine.id}/settings`);
    await settings(`/api/print-profiles/${print.id}/settings`);
    expect(asked.map((a) => a.kind)).toEqual(["machine", "process"]);
  });

  it("says why it can't be read", async () => {
    const hand = await settings(`/api/filament/profiles/${filament(null)}/settings`);
    expect(hand).toMatchObject({ status: "unreadable", reason: "hand_made", settings: [] });
    // No system folder here: nothing to read it from.
    const none = await settings(`/api/filament/profiles/${filament("fake:system/A")}/settings`);
    expect(none).toMatchObject({ status: "unreadable", reason: "no_source" });
    // A folder that no longer has the preset.
    mkdirSync(join(dataDir, "system"));
    const gone = await settings(`/api/filament/profiles/${filament("fake:system/Gone")}/settings`);
    expect(gone).toMatchObject({ status: "unreadable", reason: "not_found" });
    // A slicer this server doesn't have.
    const other = await settings(
      `/api/filament/profiles/${filament("orca-slicer:system/A")}/settings`,
    );
    expect(other).toMatchObject({ status: "unreadable", reason: "no_source" });
  });

  it("gives a hub's user preset as the library holds it, parents from the system folder", async () => {
    db.insert(schema.settings).values({ key: "hubEnabled", value: true }).run();
    mkdirSync(join(dataDir, "system"));
    savePreset(db, dataDir, {
      library: "fake",
      kind: "filament",
      name: "Mine",
      json: JSON.stringify({ name: "Mine", inherits: "Base" }),
    });
    const got = await settings(`/api/filament/profiles/${filament("fake:user/Mine")}/settings`);
    expect(got.settings).toEqual([{ key: "name", value: "Mine", from: null }]);
    expect(asked[0]).toMatchObject({ dir: dataDir, own: { name: "Mine" } });
  });

  it("points to the review while the type waits for one", async () => {
    mkdirSync(join(dataDir, "system"));
    const row = filament("fake:system/A");
    expect((await settings(`/api/filament/profiles/${row}/settings`)).waiting).toBeNull();
    db.insert(syncPolicies)
      .values({
        integrationId: id,
        type: "filamentProfiles",
        ...defaultPolicy("filamentProfiles"),
        pending: 2,
      })
      .run();
    expect((await settings(`/api/filament/profiles/${row}/settings`)).waiting).toEqual({
      integrationId: id,
      type: "filamentProfiles",
      count: 2,
    });
  });

  it("404s an unknown profile, and lists no use for a free one", async () => {
    const res = await app.inject(`/api/filament/profiles/${crypto.randomUUID()}/settings`);
    expect(res.statusCode).toBe(404);
    const use = await app.inject(`/api/filament/profiles/${filament("fake:system/A")}/use`);
    expect(use.json()).toEqual({ dependents: [] });
  });
});
