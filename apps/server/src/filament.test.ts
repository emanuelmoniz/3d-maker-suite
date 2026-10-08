import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      name: "Galaxy Black",
      colorHex: "#1a1a1a",
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
    colorHex: "#112233",
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

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "lib-"));
    db = openDb(":memory:");
    const library: FilamentLibrary = {
      id: "fake",
      defaultDirs: () => [join(dir, "missing")],
      read: async (_d, { includeSystem }) => [
        preset("A"),
        preset("B"),
        ...(includeSystem ? [preset("S", { scope: "system" })] : []),
      ],
      readSpools: async () =>
        ["1", "2"].map((spoolId) => {
          const { presetId: _p, scope: _s, ...profile } = preset("A");
          return {
            spoolId,
            profile,
            initialGrams: 1000,
            remainingGrams: 250,
            emptyWeightGrams: null,
            status: "in_use" as const,
          };
        }),
    };
    app = await buildApp(db, false, "", { filamentLibraries: [library] });
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
      payload: { brand: "Acme", material: "PLA", name: "B", colorHex: "#112233", densityGcm3: 1.2 },
    });
    expect(names(await preview())).toEqual(["A:imported", "B:duplicate"]);
    expect((await imp(["user/B"])).json()).toEqual({ created: 0 });
  });

  it("imports spools once, onto a matching or new profile, with an opening ledger entry", async () => {
    await setDir(dir);
    const spools = async () =>
      (await app.inject("/api/filament/library/fake/spools"))
        .json()
        .items.map((i: { spoolId: string; imported: boolean }) => `${i.spoolId}:${i.imported}`);
    const imp = (ids: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/filament/library/fake/spools/import",
        payload: { spoolIds: ids },
      });
    expect(await spools()).toEqual(["1:false", "2:false"]);
    expect((await imp(["1", "2"])).json()).toEqual({ created: 2 });
    expect((await imp(["1", "2"])).json()).toEqual({ created: 0 });
    expect(await spools()).toEqual(["1:true", "2:true"]);

    // Both spools share the one profile created for them.
    expect(db.select().from(schema.filamentProfiles).all()).toHaveLength(1);
    const rows = db.select().from(schema.spools).all();
    expect(rows.map((r) => [r.sourceSpool, r.remainingGrams, r.status])).toEqual([
      ["fake:1", 250, "in_use"],
      ["fake:2", 250, "in_use"],
    ]);
    expect(db.select().from(schema.spoolWeightEntries).all()).toHaveLength(2);
  });
});
