import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import type {
  FilamentLibrary,
  ImportPreview,
  IntegrationAdapter,
  LibraryPreset,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { sum } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { filamentBrandIdFor, filamentMaterialIdFor } from "./lib/catalog.ts";
import { setRemaining } from "./lib/spools.ts";
import { reviewer } from "./testReview.ts";

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
      brandId: filamentBrandIdFor(db, "Prusament"),
      materialId: filamentMaterialIdFor(db, "PLA"),
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

describe("filament brands and materials", () => {
  it("are unique by name, case-insensitive, and can't be deleted while a profile uses them", async () => {
    const p = await profile();
    expect(p).toMatchObject({ brand: "Prusament", material: "PLA" });
    expect((await send("POST", "/api/filament-brands", { name: "prusament" })).statusCode).toBe(
      409,
    );
    expect((await send("POST", "/api/filament-materials", { name: "pla" })).statusCode).toBe(409);
    for (const [kind, id] of [
      ["brands", p.brandId],
      ["materials", p.materialId],
    ])
      expect(
        (await app.inject({ method: "DELETE", url: `/api/filament-${kind}/${id}` })).statusCode,
      ).toBe(409);
    expect((await app.inject(`/api/filament/profiles?brandId=${p.brandId}`)).json().total).toBe(1);
  });
});

describe("filament library", () => {
  const preset = (n: string, extra = {}): LibraryPreset => ({
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
  let slicerId: string;
  let presets: LibraryPreset[];
  const review = reviewer(() => app);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "lib-"));
    mock = fixture();
    db = openDb(":memory:");
    presets = [preset("A"), preset("B")];
    const library: FilamentLibrary = {
      id: "fake",
      defaultDirs: () => [join(dir, "missing")],
      read: async (_d, { includeSystem }) => [
        ...presets,
        ...(includeSystem ? [preset("S", { scope: "system" })] : []),
      ],
    };
    // A slicer-only vendor: presets from a local folder, no account.
    const slicer = {
      ...mockAdapter(mock),
      id: "slicer",
      kind: "local",
      capabilities: ["filamentProfiles"],
      library,
    };
    app = await buildApp(db, false, dir, {
      adapters: [mockAdapter(mock), slicer as IntegrationAdapter],
    });
    slicerId = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "slicer", secrets: { token: "t" } },
      })
    ).json().id;
  });

  const profilesUrl = (q = "") => `/api/import/integration/${slicerId}/filamentProfiles${q}`;
  const open = async (url: string) => (await review.open(url)).json() as ImportPreview;
  const patchSlicer = (payload: object) =>
    app.inject({ method: "PATCH", url: `/api/integrations/${slicerId}`, payload });
  const setDir = (p: string) => patchSlicer({ slicerConfigDir: p });
  const addMock = async () =>
    (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "mock", secrets: { token: "t" } },
      })
    ).json().id as string;
  const addProfile = (name: string) =>
    db
      .insert(schema.filamentProfiles)
      .values({
        brandId: filamentBrandIdFor(db, "Acme"),
        materialId: filamentMaterialIdFor(db, "PLA"),
        name,
        densityGcm3: 1.2,
      })
      .returning()
      .get().id;
  const vendorSpool = (spoolId: string, name: string, colorHex = "#ff0000") => ({
    spoolId,
    profile: { brand: "Acme", material: "PLA", name },
    colorHex,
    initialGrams: 1000,
    remainingGrams: 250,
    emptyWeightGrams: null,
    status: "in_use" as const,
  });

  it("404s until a config folder exists, then honours the override", async () => {
    const closed = await review.open(profilesUrl());
    expect([closed.statusCode, closed.json().error.code]).toEqual([404, "capability_unavailable"]);
    await setDir(dir);
    expect((await open(profilesUrl())).dir).toBe(dir);
    expect(await review.rows(profilesUrl())).toEqual(["A:new", "B:new"]);
    expect(await review.rows(profilesUrl("?includeSystem=true"))).toContain("S:new");
    // Switched off = gone.
    await patchSlicer({ policies: [{ type: "filamentProfiles", mode: "off" }] });
    expect((await review.open(profilesUrl())).statusCode).toBe(404);
  });

  const run = (id: string, type: string) =>
    app.inject({ method: "POST", url: `/api/integrations/${id}/sync`, payload: { type } });
  const policy = async (id: string, type: string) =>
    (await app.inject(`/api/integrations/${id}`))
      .json()
      .policies.find((p: { type: string }) => p.type === type);

  it("a profiles run imports only user presets whose brand and material are in the catalog", async () => {
    // No folder yet: refused, and not logged as a failed run.
    expect((await run(slicerId, "filamentProfiles")).statusCode).toBe(404);
    expect(db.select().from(schema.syncRuns).all()).toEqual([]);
    await setDir(dir);

    // "Acme" would be a new brand: that is the user's call, in the review.
    filamentMaterialIdFor(db, "PLA");
    expect((await run(slicerId, "filamentProfiles")).json()).toMatchObject({
      type: "filamentProfiles",
      status: "ok",
      created: 0,
    });
    expect(await policy(slicerId, "filamentProfiles")).toMatchObject({ pending: 2 });
    // A run that wrote nothing leaves the import history alone.
    expect(db.select().from(schema.importRuns).all()).toEqual([]);

    filamentBrandIdFor(db, "acme");
    expect((await run(slicerId, "filamentProfiles")).json()).toMatchObject({ created: 2 });
    expect(db.select().from(schema.importRuns).all()).toMatchObject([
      { source: "integration", type: "filamentProfiles", created: 2, backup: null },
    ]);
    expect((await run(slicerId, "filamentProfiles")).json()).toMatchObject({
      created: 0,
      skipped: 2,
    });
    expect(await review.rows(profilesUrl("?includeSystem=true"))).toEqual([
      "A:identical",
      "B:identical",
      "S:new",
    ]);
    const after = await policy(slicerId, "filamentProfiles");
    expect(after).toMatchObject({ mode: "manual", pending: 0 });
    expect(after.lastRunAt).toBeTruthy();
  });

  it("a run updates a changed preset it imported; a twin made by hand waits for review", async () => {
    await setDir(dir);
    filamentBrandIdFor(db, "Acme");
    filamentMaterialIdFor(db, "PLA");
    await run(slicerId, "filamentProfiles");

    const twin = addProfile("C");
    presets = [preset("A", { nozzleTempC: 235 }), preset("B"), preset("C")];
    await run(slicerId, "filamentProfiles");
    const rows = db.select().from(schema.filamentProfiles).all();
    expect(rows.find((r) => r.sourcePreset === "fake:user/A")?.nozzleTempC).toBe(235);
    expect(rows.find((r) => r.id === twin)).toMatchObject({ densityGcm3: 1.2, sourcePreset: null });
    expect(await policy(slicerId, "filamentProfiles")).toMatchObject({ pending: 1 });

    // In the review the twin is a matched row: updating it links it to the preset.
    const p = await open(profilesUrl());
    const row = p.rows.filter((r) => r.values.name === "C");
    expect(row).toMatchObject([{ status: "changed", targetId: twin, auto: "wait" }]);
    expect((await review.confirm(p, row)).json()).toMatchObject({ created: 0, updated: 1 });
    expect(
      db
        .select()
        .from(schema.filamentProfiles)
        .all()
        .find((r) => r.id === twin),
    ).toMatchObject({ densityGcm3: 1.24, sourcePreset: "fake:user/C" });
    expect(await policy(slicerId, "filamentProfiles")).toMatchObject({ pending: 0 });
  });

  it("a spools run imports only spools with exactly one matching profile; the rest waits", async () => {
    mock.spools = [vendorSpool("1", "A"), vendorSpool("2", "Matte"), vendorSpool("3", "Silk")];
    const mockId = await addMock();
    const spoolsUrl = `/api/import/integration/${mockId}/spools`;
    const [one, matte] = ["A", "Acme Matte", "Other Matte"].map(addProfile);

    // "A" has its profile; "Matte" fits two and "Silk" none.
    expect((await run(mockId, "spools")).json()).toMatchObject({
      type: "spools",
      trigger: "manual",
      created: 1,
      skipped: 0,
    });
    expect(db.select().from(schema.spools).all()).toMatchObject([
      { sourceSpool: "mock:1", profileId: one },
    ]);
    expect(await policy(mockId, "spools")).toMatchObject({ pending: 2 });

    // The review suggests the first fit and takes the user's pick; it is logged like any run.
    const p = await open(spoolsUrl);
    expect(p.rows.map((r) => [r.status, r.action, r.refs?.profile ?? null, r.auto])).toEqual([
      ["identical", "skip", null, undefined],
      ["new", "create", matte, "wait"],
      ["new", "skip", null, "wait"],
    ]);
    expect(p.refOptions?.profile).toHaveLength(3);
    const confirmed = await review.confirm(p, [p.rows[1] as never]);
    expect(confirmed.json()).toMatchObject({ created: 1, updated: 0 });
    expect(await policy(mockId, "spools")).toMatchObject({ pending: 1 });
    expect((await run(mockId, "spools")).json()).toMatchObject({ created: 0, skipped: 2 });
    expect((await app.inject(`/api/integrations/${mockId}/runs?type=spools`)).json().total).toBe(3);
    const logged = db.select().from(schema.importRuns).all();
    expect(logged).toMatchObject([
      { source: "integration", type: "spools", created: 1, backup: null },
      { source: "integration", type: "spools", created: 1 },
    ]);
    expect(logged[1]?.backup).toBeTruthy();

    // A second roll of a filament you already imported is a new spool, not a match.
    mock.spools.push(vendorSpool("4", "A"));
    expect((await open(spoolsUrl)).rows[3]).toMatchObject({ status: "new", targetId: null });

    // A vendor failure while opening the review comes back with its code.
    mock.fail = "auth_expired";
    const failed = await review.open(spoolsUrl);
    expect([failed.statusCode, failed.json().error.code]).toEqual([502, "auth_expired"]);
  });

  it("offers an imported spool's new vendor weight, and only writes it on request", async () => {
    mock.spools = [vendorSpool("1", "A")];
    const mockId = await addMock();
    addProfile("A");
    await run(mockId, "spools");

    mock.spools = [{ ...vendorSpool("1", "A"), remainingGrams: 100 }];
    expect((await run(mockId, "spools")).json()).toMatchObject({ created: 0 });
    expect(db.select().from(schema.spools).get()?.remainingGrams).toBe(250);
    expect(await policy(mockId, "spools")).toMatchObject({ pending: 0 });

    const p = await open(`/api/import/integration/${mockId}/spools`);
    expect(p.rows).toMatchObject([{ status: "changed", action: "skip" }]);
    expect(p.rows[0]?.auto).toBeUndefined();
    expect((await review.confirm(p, p.rows, { action: "update" })).json()).toMatchObject({
      updated: 1,
    });
    expect(db.select().from(schema.spools).get()?.remainingGrams).toBe(100);
    expect(
      db
        .select()
        .from(schema.spoolWeightEntries)
        .all()
        .map((e) => [e.kind, e.deltaGrams]),
    ).toEqual([
      ["manual", 250],
      ["correction", -150],
    ]);
  });

  it("imports only the picked presets, once, and links them to the source", async () => {
    await setDir(dir);
    const only = async (name: string) => {
      const p = await open(profilesUrl());
      return review.confirm(
        p,
        p.rows.filter((r) => r.values.name === name),
        { action: "create" },
      );
    };
    expect((await only("A")).json()).toMatchObject({ created: 1, updated: 0 });
    expect((await only("A")).json()).toMatchObject({ created: 0 });
    expect(db.select().from(schema.filamentProfiles).get()?.sourcePreset).toBe("fake:user/A");
    // Import found-or-created the brand and material once, by name.
    expect(
      db
        .select()
        .from(schema.filamentBrands)
        .all()
        .map((b) => b.name),
    ).toEqual(["Acme"]);
    expect(
      db
        .select()
        .from(schema.filamentMaterials)
        .all()
        .map((m) => m.name),
    ).toEqual(["PLA"]);
    expect(await review.rows(profilesUrl())).toEqual(["A:identical", "B:new"]);

    // Same filament made by hand is its twin: matched, and never created again.
    addProfile("B");
    expect(await review.rows(profilesUrl())).toEqual(["A:identical", "B:changed"]);
    expect((await only("B")).json()).toMatchObject({ created: 0 });
    expect(db.select().from(schema.filamentProfiles).all()).toHaveLength(2);
  });

  it("imports spools from the integration's inventory onto the profile you pick", async () => {
    // The slicer integration keeps no spools.
    expect(
      (await review.open(`/api/import/integration/${slicerId}/spools`)).json().error.code,
    ).toBe("capability_unavailable");

    mock.spools = [vendorSpool("1", "A"), vendorSpool("2", "Matte", "#00ff00")];
    const mockId = await addMock();
    const spoolsUrl = `/api/import/integration/${mockId}/spools`;
    const suggested = async () =>
      (await open(spoolsUrl)).rows.map((r) => `${r.status}:${r.action}:${r.refs?.profile ?? null}`);
    // No profile named like the spools yet: nothing suggested, nothing to create.
    expect(await suggested()).toEqual(["new:skip:null", "new:skip:null"]);

    // Suggested on brand, material and name (not colour), or a preset-style name ending in it.
    const profileId = addProfile("A");
    const matte = addProfile("Acme Matte");
    expect(await suggested()).toEqual([`new:create:${profileId}`, `new:create:${matte}`]);

    const p = await open(spoolsUrl);
    const both = () =>
      review.confirm(p, p.rows, { action: "create", refs: { profile: profileId } });
    expect((await both()).json()).toMatchObject({ created: 2 });
    // The review was used up.
    expect((await both()).statusCode).toBe(404);
    expect(await suggested()).toEqual(["identical:skip:null", "identical:skip:null"]);

    const rows = db.select().from(schema.spools).all();
    expect(
      rows.map((r) => [r.sourceSpool, r.profileId, r.colorHex, r.remainingGrams, r.status]),
    ).toEqual([
      ["mock:1", profileId, "#ff0000", 250, "in_use"],
      ["mock:2", profileId, "#00ff00", 250, "in_use"],
    ]);
    expect(db.select().from(schema.spoolWeightEntries).all()).toHaveLength(2);

    // Archived profiles take no spools, and a profile is never created.
    await app.inject({
      method: "PATCH",
      url: `/api/filament/profiles/${profileId}`,
      payload: { archived: true },
    });
    db.delete(schema.spoolWeightEntries).run();
    db.delete(schema.spools).run();
    const again = await open(spoolsUrl);
    const refused = await review.confirm(again, again.rows, {
      action: "create",
      refs: { profile: profileId },
    });
    expect([refused.statusCode, refused.json().error.code]).toEqual([400, "ref_not_found"]);
    expect(db.select().from(schema.spools).all()).toEqual([]);
  });
});
