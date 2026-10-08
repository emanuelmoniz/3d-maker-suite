import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import type { FilamentLibrary } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { sum } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { setRemaining } from "./lib/spools.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
});

const send = (method: "POST" | "PATCH", url: string, payload: Record<string, unknown>) =>
  app.inject({ method, url, payload });

const profile = async () =>
  (
    await send("POST", "/api/filament/profiles", {
      brand: "Prusament",
      material: "PLA",
      name: "Galaxy",
      densityGcm3: 1.24,
    })
  ).json();

describe("filament", () => {
  it("many spools per profile; archived profiles take no new spools", async () => {
    const p = await profile();
    expect(p).toMatchObject({ diameterMm: 1.75, archivedAt: null });
    for (const initialGrams of [1000, 750])
      expect(
        (await send("POST", "/api/filament/spools", { profileId: p.id, initialGrams })).statusCode,
      ).toBe(201);
    const list = (await app.inject(`/api/filament/spools?profileId=${p.id}`)).json();
    expect(list.total).toBe(2);

    await send("PATCH", `/api/filament/profiles/${p.id}`, { archived: true });
    const res = await send("POST", "/api/filament/spools", { profileId: p.id, initialGrams: 1000 });
    expect(res.statusCode).toBe(400);
  });

  it("every remaining-weight change is a ledger entry that sums to the weight", async () => {
    const p = await profile();
    const spool = (
      await send("POST", "/api/filament/spools", {
        profileId: p.id,
        initialGrams: 1000,
        remainingGrams: 900,
      })
    ).json();
    const adjust = (kind: string, remainingGrams: number, note?: string) =>
      send("POST", `/api/filament/spools/${spool.id}/adjust`, { kind, remainingGrams, note });

    expect((await adjust("manual", 850, "weighed")).json().remainingGrams).toBe(850);
    await adjust("correction", 860);
    await adjust("manual", 860); // unchanged: no entry
    // Print entries come from prints (Step 9), not from the public endpoint.
    expect((await adjust("print", 800)).statusCode).toBe(400);
    setRemaining(db, spool.id, "print", 820, "benchy");

    const history = (await app.inject(`/api/filament/spools/${spool.id}/history`)).json();
    expect(
      history.map((e: { kind: string; deltaGrams: number }) => [e.kind, e.deltaGrams]),
    ).toEqual([
      ["print", -40],
      ["correction", 10],
      ["manual", -50],
      ["manual", 900],
    ]);
    const total = db
      .select({ n: sum(schema.spoolWeightEntries.deltaGrams) })
      .from(schema.spoolWeightEntries)
      .get();
    expect(Number(total?.n)).toBe(820);
    expect((await app.inject(`/api/filament/spools/${spool.id}`)).json().remainingGrams).toBe(820);

    // remaining weight is not patchable
    expect(
      (await send("PATCH", `/api/filament/spools/${spool.id}`, { remainingGrams: 1 })).statusCode,
    ).toBe(400);
  });
});

describe("filament library", () => {
  const preset = (n: string, extra = {}) => ({
    presetId: `user/${n}`,
    scope: "user" as const,
    brand: "Acme",
    material: "PLA",
    name: n,
    diameterMm: 1.75,
    densityGcm3: 1.24,
    pricePerKg: 2000,
    nozzleTempC: 220,
    bedTempC: 55,
    ...extra,
  });
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: ReturnType<typeof openDb>;
  let mock: MockState;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "lib-"));
    mock = fixture();
    db = openDb(":memory:");
    const library: FilamentLibrary = {
      id: "fake",
      defaultDirs: () => [join(dir, "missing")],
      read: async (_d, { includeSystem }) => [
        preset("A"),
        preset("B"),
        ...(includeSystem ? [preset("S", { scope: "system" })] : []),
      ],
    };
    app = await buildApp(db, false, "", {
      filamentLibraries: [library],
      adapters: [mockAdapter(mock)],
    });
  });

  const preview = async (q = "") =>
    app.inject({ method: "GET", url: `/api/filament/library/fake/preview${q}` });
  const setDir = (p: string) =>
    app.inject({
      method: "PATCH",
      url: "/api/preferences",
      payload: { libraryPaths: { fake: p } },
    });
  const names = (r: { json(): unknown }) =>
    (r.json() as { items: { name: string; status: string }[] }).items.map(
      (i) => `${i.name}:${i.status}`,
    );

  it("404s until a config folder exists, then honours the override", async () => {
    expect((await preview()).statusCode).toBe(404);
    expect((await preview()).json().error.code).toBe("library_not_found");
    await setDir(dir);
    const res = await preview();
    expect(res.json().dir).toBe(dir);
    expect(names(res)).toEqual(["A:new", "B:new"]);
    expect(names(await preview("?includeSystem=true"))).toContain("S:new");
  });

  it("imports only the picked presets, once, and links them to the source", async () => {
    await setDir(dir);
    const imp = (ids: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/filament/library/fake/import",
        payload: { presetIds: ids },
      });
    expect((await imp(["user/A"])).json()).toEqual({ created: 1 });
    expect((await imp(["user/A"])).json()).toEqual({ created: 0 });
    expect(db.select().from(schema.filamentProfiles).get()?.sourcePreset).toBe("fake:user/A");
    expect(names(await preview())).toEqual(["A:imported", "B:new"]);

    // Same filament made by hand counts as a duplicate and is not created again.
    await app.inject({
      method: "POST",
      url: "/api/filament/profiles",
      payload: { brand: "Acme", material: "PLA", name: "B", densityGcm3: 1.2 },
    });
    expect(names(await preview())).toEqual(["A:imported", "B:duplicate"]);
    expect((await imp(["user/B"])).json()).toEqual({ created: 0 });
  });

  it("imports spools from the integration's inventory onto the profile you pick", async () => {
    const preview = async () =>
      (await app.inject("/api/filament/inventory"))
        .json()
        .items.map(
          (i: { spoolId: string; imported: boolean; profileId: string | null }) =>
            `${i.spoolId}:${i.imported}:${i.profileId}`,
        );
    const imp = (spools: { spoolId: string; profileId: string }[]) =>
      app.inject({ method: "POST", url: "/api/filament/inventory/import", payload: { spools } });
    // No integration keeps spools yet.
    expect((await app.inject("/api/filament/inventory")).json().error.code).toBe("no_spool_source");

    mock.spools = [
      ["1", "#ff0000", "A"],
      ["2", "#00ff00", "Matte"],
    ].map(([spoolId = "", colorHex = "", name = ""]) => ({
      spoolId,
      profile: { brand: "Acme", material: "PLA", name },
      colorHex,
      initialGrams: 1000,
      remainingGrams: 250,
      emptyWeightGrams: null,
      status: "in_use" as const,
    }));
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "mock", name: "Mock", secrets: { token: "t" } },
    });
    // No profile named like the spools yet: nothing suggested.
    expect(await preview()).toEqual(["mock:1:false:null", "mock:2:false:null"]);

    // Suggested on brand, material and name (not colour), or a preset-style name ending in it.
    const add = async (name: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/api/filament/profiles",
          payload: { brand: "Acme", material: "PLA", name, densityGcm3: 1.2 },
        })
      ).json().id as string;
    const profileId = await add("A");
    const matte = await add("Acme Matte");
    expect(await preview()).toEqual([`mock:1:false:${profileId}`, `mock:2:false:${matte}`]);

    const both = ["mock:1", "mock:2"].map((spoolId) => ({ spoolId, profileId }));
    expect((await imp(both)).json()).toEqual({ created: 2 });
    expect((await imp(both)).json()).toEqual({ created: 0 });
    expect(await preview()).toEqual([`mock:1:true:${profileId}`, `mock:2:true:${matte}`]);

    const rows = db.select().from(schema.spools).all();
    expect(rows.map((r) => [r.sourceSpool, r.colorHex, r.remainingGrams, r.status])).toEqual([
      ["mock:1", "#ff0000", 250, "in_use"],
      ["mock:2", "#00ff00", 250, "in_use"],
    ]);
    expect(db.select().from(schema.spoolWeightEntries).all()).toHaveLength(2);

    // Vendor errors come back with their code.
    mock.fail = "auth_expired";
    const res = await app.inject("/api/filament/inventory");
    expect([res.statusCode, res.json().error.code]).toEqual([502, "auth_expired"]);
    mock.fail = undefined;

    // Archived profiles take no spools.
    await app.inject({
      method: "PATCH",
      url: `/api/filament/profiles/${profileId}`,
      payload: { archived: true },
    });
    db.delete(schema.spoolWeightEntries).run();
    db.delete(schema.spools).run();
    expect((await imp(both)).statusCode).toBe(400);
  });
});
