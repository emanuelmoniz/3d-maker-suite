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
import { eq, sum } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { filamentBrandIdFor, filamentMaterialIdFor, spoolName } from "./lib/catalog.ts";
import { setRemaining, takeFromSpool } from "./lib/spools.ts";
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

/** A spool's filament: brand, material, name. */
const galaxy = () => ({
  brandId: filamentBrandIdFor(db, "Prusament"),
  materialId: filamentMaterialIdFor(db, "PLA"),
  name: "Galaxy",
});

describe("filament", () => {
  it("a spool describes its filament with no profile; archived materials take no new spools", async () => {
    const res = await send("POST", "/api/filament/spools", { ...galaxy(), initialGrams: 1000 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ brand: "Prusament", material: "PLA", name: "Galaxy" });
    expect(db.select().from(schema.filamentProfiles).all()).toEqual([]);
    // No brand: a generic one.
    const plain = await send("POST", "/api/filament/spools", { materialId: galaxy().materialId });
    expect(plain.json()).toMatchObject({ brandId: null, brand: "", name: null });
    expect((await app.inject("/api/filament/spools")).json().total).toBe(2);

    const { materialId } = galaxy();
    await send("PATCH", `/api/filament-materials/${materialId}`, { archived: true });
    const refused = await send("POST", "/api/filament/spools", { materialId, initialGrams: 1000 });
    expect([refused.statusCode, refused.json().error.code]).toEqual([400, "invalid_reference"]);
    // A spool that has it keeps it.
    const kept = await send("PATCH", `/api/filament/spools/${res.json().id}`, {
      materialId,
      colorName: "Night",
    });
    expect(kept.statusCode).toBe(200);
  });

  it("changing the initial weight moves the remaining weight with it", async () => {
    const s = (
      await send("POST", "/api/filament/spools", {
        ...galaxy(),
        initialGrams: 1000,
        remainingGrams: 88,
      })
    ).json();
    const up = (await send("PATCH", `/api/filament/spools/${s.id}`, { initialGrams: 1200 })).json();
    expect(up).toMatchObject({ initialGrams: 1200, remainingGrams: 288 });
    const down = (
      await send("PATCH", `/api/filament/spools/${s.id}`, { initialGrams: 100 })
    ).json();
    expect(down.remainingGrams).toBe(0);
    // Another field leaves the weight alone.
    const same = (await send("PATCH", `/api/filament/spools/${s.id}`, { location: "A" })).json();
    expect(same.remainingGrams).toBe(0);
  });

  it("spools get the next free number; a taken one is refused", async () => {
    const post = (over = {}) =>
      send("POST", "/api/filament/spools", { ...galaxy(), initialGrams: 1000, ...over });
    const a = (await post()).json();
    const b = (await post({ number: 10, colorName: "Starlight" })).json();
    const c = (await post()).json();
    expect([a.number, b.number, c.number]).toEqual([1, 10, 11]);
    expect((await post({ number: 10 })).json()).toMatchObject({
      error: { code: "spool_number_taken" },
    });
    expect((await send("PATCH", `/api/filament/spools/${a.id}`, { number: 11 })).statusCode).toBe(
      409,
    );
    // Its own number is not "taken".
    expect((await send("PATCH", `/api/filament/spools/${a.id}`, { number: 1 })).statusCode).toBe(
      200,
    );
    expect(
      db
        .select({ name: spoolName })
        .from(schema.spools)
        .all()
        .map((s) => s.name),
    ).toEqual([
      "001-Prusament PLA Galaxy #808080",
      "010-Prusament PLA Galaxy Starlight",
      "011-Prusament PLA Galaxy #808080",
    ]);
    // The material leads unless the name starts with it; no name is the material alone.
    const nameOf = async (over: object) => {
      const { id } = (await post(over)).json();
      return db
        .select({ name: spoolName })
        .from(schema.spools)
        .where(eq(schema.spools.id, id))
        .get()?.name;
    };
    expect(await nameOf({ name: "PLA Basic" })).toBe("012-Prusament PLA Basic #808080");
    expect(await nameOf({ name: null, brandId: null })).toBe("013-PLA #808080");
  });

  it("every remaining-weight change is a ledger entry that sums to the weight", async () => {
    const spool = (
      await send("POST", "/api/filament/spools", {
        ...galaxy(),
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

  it("a spool without a weight books nothing until one is set", async () => {
    const spool = (await send("POST", "/api/filament/spools", galaxy())).json();
    expect(spool).toMatchObject({ initialGrams: null, remainingGrams: null });
    const entries = async () =>
      (await app.inject(`/api/filament/spools/${spool.id}/history`))
        .json()
        .map((e: { deltaGrams: number }) => e.deltaGrams);
    expect(await entries()).toEqual([]);
    // A print takes it without booking anything.
    expect(takeFromSpool(db, spool.id, 50, "benchy")).toBe(true);
    expect(await entries()).toEqual([]);
    // Setting the weight opens the ledger: the spool holds all of it.
    const set = (
      await send("PATCH", `/api/filament/spools/${spool.id}`, { initialGrams: 1000 })
    ).json();
    expect(set).toMatchObject({ initialGrams: 1000, remainingGrams: 1000 });
    expect(await entries()).toEqual([1000]);
    // A known weight can't go back to unknown.
    const unset = await send("PATCH", `/api/filament/spools/${spool.id}`, { initialGrams: null });
    expect(unset.statusCode).toBe(400);
  });
});

describe("filament brands and materials", () => {
  it("are unique by name, case-insensitive, and can't be deleted while a profile or spool uses them", async () => {
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
    // A spool's material holds on to it too.
    const material = (await send("POST", "/api/filament-materials", { name: "ASA" })).json();
    await send("POST", "/api/filament/spools", { materialId: material.id });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/filament-materials/${material.id}`,
    });
    expect(del.statusCode).toBe(409);
  });
});

describe("filament library", () => {
  const preset = (n: string, extra = {}): LibraryPreset => ({
    presetId: `system/${n}`,
    scope: "system" as const,
    brand: "Acme",
    material: "PLA",
    name: n,
    diameterMm: 1.75,
    densityGcm3: 1.24,
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
  // Spools sync starts off on a new integration; these tests use it.
  const addMock = async () => {
    const id = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "mock", secrets: { token: "t" } },
      })
    ).json().id as string;
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: { policies: [{ type: "spools", mode: "manual", trackUsage: true }] },
    });
    return id;
  };
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
    filament: { brand: "Acme", material: "PLA", name },
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
    expect(await review.rows(profilesUrl())).toEqual(["A:new", "B:new", "S:new"]);
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

  it("a profiles run imports presets, with the brand and material they need", async () => {
    // No folder yet: refused, and not logged as a failed run.
    expect((await run(slicerId, "filamentProfiles")).statusCode).toBe(404);
    expect(db.select().from(schema.syncRuns).all()).toEqual([]);
    await setDir(dir);

    expect((await run(slicerId, "filamentProfiles")).json()).toMatchObject({
      type: "filamentProfiles",
      status: "ok",
      created: 3,
    });
    expect(db.select().from(schema.filamentBrands).all()).toMatchObject([{ name: "Acme" }]);
    expect(db.select().from(schema.filamentMaterials).all()).toMatchObject([{ name: "PLA" }]);
    expect(await policy(slicerId, "filamentProfiles")).toMatchObject({ pending: 0 });
    expect(db.select().from(schema.importRuns).all()).toMatchObject([
      { source: "integration", type: "filamentProfiles", created: 3, backup: null },
    ]);
    expect((await run(slicerId, "filamentProfiles")).json()).toMatchObject({
      created: 0,
      skipped: 3,
    });
    expect(await review.rows(profilesUrl())).toEqual(["A:identical", "B:identical", "S:identical"]);
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
    expect(rows.find((r) => r.sourcePreset === "fake:system/A")?.nozzleTempC).toBe(235);
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
    ).toMatchObject({ densityGcm3: 1.24, sourcePreset: "fake:system/C" });
    expect(await policy(slicerId, "filamentProfiles")).toMatchObject({ pending: 0 });
  });

  it("a spools run imports each spool with its brand, material and name; no profile needed", async () => {
    mock.spools = [vendorSpool("1", "A"), vendorSpool("2", "PLA Matte"), vendorSpool("3", "PLA")];
    const mockId = await addMock();
    const spoolsUrl = `/api/import/integration/${mockId}/spools`;

    expect((await run(mockId, "spools")).json()).toMatchObject({
      type: "spools",
      trigger: "manual",
      created: 3,
      skipped: 0,
    });
    const acme = filamentBrandIdFor(db, "Acme");
    const pla = filamentMaterialIdFor(db, "PLA");
    expect(db.select().from(schema.spools).all()).toMatchObject([
      { sourceSpool: "mock:1", brandId: acme, materialId: pla, name: "A" },
      { sourceSpool: "mock:2", brandId: acme, materialId: pla, name: "PLA Matte" },
      // A name that is only the material is none.
      { sourceSpool: "mock:3", brandId: acme, materialId: pla, name: null },
    ]);
    expect(db.select().from(schema.filamentProfiles).all()).toEqual([]);
    expect(await policy(mockId, "spools")).toMatchObject({ pending: 0 });
    // The log names each spool by its filament and colour.
    expect(db.select().from(schema.syncRuns).get()?.log[0]).toMatchObject({
      event: "created",
      label: expect.stringMatching(/Acme PLA A/),
    });
    expect((await run(mockId, "spools")).json()).toMatchObject({ created: 0, skipped: 3 });
    expect(db.select().from(schema.importRuns).all()).toMatchObject([
      { source: "integration", type: "spools", created: 3, backup: null },
    ]);

    // A second roll of a filament you already imported is a new spool, not a match.
    mock.spools.push(vendorSpool("4", "A"));
    expect((await open(spoolsUrl)).rows.at(-1)).toMatchObject({ status: "new", targetId: null });

    // A vendor failure while opening the review comes back with its code.
    mock.fail = "auth_expired";
    const failed = await review.open(spoolsUrl);
    expect([failed.statusCode, failed.json().error.code]).toEqual([502, "auth_expired"]);
  });

  it("offers a spool or a profile you archived as a skip; a run leaves it, an update restores it", async () => {
    mock.spools = [vendorSpool("1", "A")];
    const mockId = await addMock();
    await run(mockId, "spools");
    const spoolId = db.select().from(schema.spools).get()?.id;
    await app.inject({
      method: "PATCH",
      url: `/api/filament/spools/${spoolId}`,
      payload: { archived: true },
    });
    expect((await run(mockId, "spools")).json()).toMatchObject({ created: 0, pending: 0 });
    const p = await open(`/api/import/integration/${mockId}/spools`);
    expect(p.rows).toMatchObject([{ status: "identical", action: "skip", targetId: spoolId }]);
    expect(p.rows[0]?.auto).toBeUndefined();
    expect(p.targets.find((t) => t.id === spoolId)?.archived).toBe(true);
    expect((await review.confirm(p, p.rows, { action: "update" })).json()).toMatchObject({
      updated: 1,
    });
    expect(db.select().from(schema.spools).all()).toMatchObject([
      { id: spoolId, archivedAt: null },
    ]);

    await setDir(dir);
    filamentBrandIdFor(db, "Acme");
    filamentMaterialIdFor(db, "PLA");
    await run(slicerId, "filamentProfiles");
    const profile = () =>
      db
        .select()
        .from(schema.filamentProfiles)
        .all()
        .find((x) => x.name === "B");
    const b = profile();
    await app.inject({
      method: "PATCH",
      url: `/api/filament/profiles/${b?.id}`,
      payload: { archived: true },
    });
    expect((await run(slicerId, "filamentProfiles")).json()).toMatchObject({ created: 0 });
    const q = await open(profilesUrl());
    const row = q.rows.find((r) => r.values.name === "B");
    expect(row).toMatchObject({ status: "identical", action: "skip", targetId: b?.id });
    expect(row?.auto).toBeUndefined();
    await review.confirm(q, row ? [row] : [], { action: "update" });
    expect(profile()).toMatchObject({ id: b?.id, archivedAt: null });
  });

  it("leaves an imported spool's new vendor weight for review, and writes it on request", async () => {
    mock.spools = [vendorSpool("1", "A")];
    const mockId = await addMock();
    await run(mockId, "spools");

    mock.spools = [{ ...vendorSpool("1", "A"), remainingGrams: 100 }];
    expect((await run(mockId, "spools")).json()).toMatchObject({ created: 0 });
    expect(db.select().from(schema.spools).get()?.remainingGrams).toBe(250);
    expect(await policy(mockId, "spools")).toMatchObject({ pending: 1 });

    const p = await open(`/api/import/integration/${mockId}/spools`);
    expect(p.rows).toMatchObject([{ status: "changed", action: "update", auto: "wait" }]);
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

  it("without Track usage, weight and usage alone never leave a spool for review", async () => {
    mock.spools = [vendorSpool("1", "A")];
    const mockId = await addMock();
    await run(mockId, "spools"); // linked: imported from the source
    // One you entered by hand, matched on filament and colour.
    await app.inject({
      method: "POST",
      url: "/api/filament/spools",
      payload: {
        brandId: filamentBrandIdFor(db, "Acme"),
        materialId: filamentMaterialIdFor(db, "PLA"),
        name: "A",
        colorHex: "#00ff00",
        initialGrams: 1000,
        remainingGrams: 300,
      },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${mockId}`,
      payload: { policies: [{ type: "spools", trackUsage: false }] },
    });
    // The source's weight and status differ for both.
    const full = { initialGrams: 1100, remainingGrams: 1100, status: "new" as const };
    mock.spools = [
      { ...vendorSpool("1", "A"), ...full },
      { ...vendorSpool("2", "A", "#00ff00"), ...full },
    ];
    expect((await run(mockId, "spools")).json()).toMatchObject({ created: 0, updated: 0 });
    expect(await policy(mockId, "spools")).toMatchObject({ pending: 0 });
    // Nothing to do for either: what the run left for you is empty, and a review opened by hand
    // shows both, with nothing to write.
    const url = `/api/import/integration/${mockId}/spools`;
    expect((await open(`${url}?waiting=1`)).rows).toEqual([]);
    expect((await open(url)).rows.map((r) => [r.status, r.action])).toEqual([
      ["identical", "skip"],
      ["identical", "skip"],
    ]);
    // Anything else still counts.
    mock.spools = [{ ...vendorSpool("1", "A"), ...full, colorHex: "#0000ff" }];
    expect((await open(`/api/import/integration/${mockId}/spools`)).rows).toMatchObject([
      { status: "changed" },
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
    expect(db.select().from(schema.filamentProfiles).get()?.sourcePreset).toBe("fake:system/A");
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
    expect(await review.rows(profilesUrl())).toEqual(["A:identical", "B:new", "S:new"]);

    // Same filament made by hand is its twin: matched, and never created again.
    addProfile("B");
    expect(await review.rows(profilesUrl())).toEqual(["A:identical", "B:changed", "S:new"]);
    expect((await only("B")).json()).toMatchObject({ created: 0 });
    expect(db.select().from(schema.filamentProfiles).all()).toHaveLength(2);
  });

  it("imports spools from the integration's inventory in a review, with the vendor's filament", async () => {
    // The slicer integration keeps no spools.
    expect(
      (await review.open(`/api/import/integration/${slicerId}/spools`)).json().error.code,
    ).toBe("capability_unavailable");

    mock.spools = [vendorSpool("1", "A"), vendorSpool("2", "Matte", "#00ff00")];
    const mockId = await addMock();
    const spoolsUrl = `/api/import/integration/${mockId}/spools`;
    const rowsOf = async () => (await open(spoolsUrl)).rows.map((r) => `${r.status}:${r.action}`);
    expect(await rowsOf()).toEqual(["new:create", "new:create"]);

    const p = await open(spoolsUrl);
    const both = () => review.confirm(p, p.rows, { action: "create" });
    expect((await both()).json()).toMatchObject({ created: 2 });
    // The review was used up.
    expect((await both()).statusCode).toBe(404);
    // A review opened by hand shows every spool the source has.
    expect(await rowsOf()).toEqual(["identical:skip", "identical:skip"]);

    const rows = db.select().from(schema.spools).all();
    expect(
      rows.map((r) => [r.sourceSpool, r.name, r.colorHex, r.remainingGrams, r.status]),
    ).toEqual([
      ["mock:1", "A", "#ff0000", 250, "in_use"],
      ["mock:2", "Matte", "#00ff00", 250, "in_use"],
    ]);
    expect(db.select().from(schema.spoolWeightEntries).all()).toHaveLength(2);
  });
});
