import { idList, listQuery } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";
import { inIds, listPage } from "./lib/list.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
});

describe("api", () => {
  it("health + openapi", async () => {
    expect((await app.inject("/api/health")).json()).toEqual({ status: "ok" });
    const spec = (await app.inject("/api/docs/json")).json();
    expect(spec.paths["/api/printers/{id}"]).toBeDefined();
    // Raw settings rows hold the encrypted channel secrets; only /api/preferences is exposed.
    expect(spec.paths["/api/settings/{key}"]).toBeUndefined();
  });

  it("preferences: defaults, partial patch, validation", async () => {
    const get = async () => (await app.inject("/api/preferences")).json();
    expect((await get()).values).toMatchObject({
      currency: "EUR",
      accent: "teal",
      projectRoots: [],
    });
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: "PATCH", url: "/api/preferences", payload });
    expect((await patch({ currency: "USD", energyCostPerKwh: 0.3 })).statusCode).toBe(200);
    expect((await patch({ defaultPrinterId: null })).statusCode).toBe(200);
    expect((await get()).values).toMatchObject({ currency: "USD", energyCostPerKwh: 0.3 });
    expect((await patch({ currency: "usd" })).statusCode).toBe(400);
    expect((await patch({ nope: 1 })).statusCode).toBe(400);
  });

  it("list paginates and sorts", async () => {
    for (const name of ["a", "b", "c"])
      await app.inject({ method: "POST", url: "/api/projects", payload: { name } });
    const res = (await app.inject("/api/projects?pageSize=2&page=2&sort=-name")).json();
    expect(res).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.items.map((i: { name: string }) => i.name)).toEqual(["a"]);
  });

  it("uniform validation + not-found errors", async () => {
    const bad = await app.inject("/api/projects?pageSize=999&sort=nope");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("validation_error");
    expect((await app.inject("/nope")).json().error.code).toBe("not_found");
  });
});

describe("listPage filters", () => {
  it("date range + entity filter", () => {
    const { printers } = schema;
    const [bambu, prusa, other] = [
      ["bambu", "m"],
      ["prusa", "m"],
      ["other", "m"],
    ].map(([b = "", m = ""]) => modelIdFor(db, b, m));
    db.insert(printers)
      .values([
        { name: "a", modelId: bambu, createdAt: "2026-01-10T00:00:00.000Z" },
        { name: "b", modelId: bambu, createdAt: "2026-02-10T00:00:00.000Z" },
        { name: "c", modelId: prusa, createdAt: "2026-02-20T00:00:00.000Z" },
        { name: "d", modelId: other, createdAt: "2026-02-20T00:00:00.000Z" },
      ])
      .run();
    const q = listQuery(["name", "createdAt"], { modelId: idList.optional() }).parse({
      from: "2026-02-01",
      to: "2026-02-20", // date-only `to` includes the whole day
      modelId: `${bambu},${prusa}`,
      sort: "-name",
    });
    const res = listPage(db, printers, q, {
      sort: { name: printers.name, createdAt: printers.createdAt },
      dateColumn: printers.createdAt,
      where: [inIds(printers.modelId, q.modelId)],
    });
    expect(res.items.map((p) => p.name)).toEqual(["c", "b"]);
    expect(res.total).toBe(2);
  });

  it("column filters on /api/prints", async () => {
    const printer = db
      .insert(schema.printers)
      .values({ name: "p", modelId: modelIdFor(db, "b", "m") })
      .returning()
      .get();
    const row = (title: string, day: string, durationSec: number, outcome = "success") => ({
      printerId: printer.id,
      title,
      startedAt: `2026-03-${day}T10:00:00.000Z`,
      durationSec,
      outcome: outcome as "success",
    });
    db.insert(schema.prints)
      .values([
        row("Benchy", "01", 600),
        row("benchy XL", "10", 3600, "failed"),
        row("Vase", "20", 7200),
      ])
      .run();
    const titles = async (qs: string) => {
      const res = (await app.inject(`/api/prints?${qs}`)).json();
      return [res.total, res.items.map((p: { title: string }) => p.title)];
    };
    expect(await titles("")).toEqual([3, ["Vase", "benchy XL", "Benchy"]]); // newest first
    expect(await titles("title=BENCHY&sort=title")).toEqual([2, ["Benchy", "benchy XL"]]);
    expect(await titles("outcome=failed")).toEqual([1, ["benchy XL"]]);
    expect(await titles("durationSec=600..3600&sort=-durationSec")).toEqual([
      2,
      ["benchy XL", "Benchy"],
    ]);
    expect(await titles("startedAt=2026-03-10..2026-03-20")).toEqual([2, ["Vase", "benchy XL"]]);
    expect(await titles("pageSize=1&page=3")).toEqual([3, ["Benchy"]]);
    expect((await app.inject("/api/prints?outcome=nope")).statusCode).toBe(400);
  });

  it("expression columns: printers by brand + model, spools by profile label, projects by material", async () => {
    const post = async (url: string, payload: object) =>
      (await app.inject({ method: "POST", url, payload })).json();
    const names = async (url: string, key = "name") =>
      (await app.inject(url)).json().items.map((x: Record<string, unknown>) => x[key]);

    const printer = await post("/api/printers", {
      name: "A1",
      modelId: modelIdFor(db, "Bambu Lab", "A1"),
      powerW: 100,
    });
    await post("/api/printers", {
      name: "MK4",
      modelId: modelIdFor(db, "Prusa", "MK4"),
      powerW: 300,
    });
    expect(await names("/api/printers?model=lab%20a1")).toEqual(["A1"]);
    expect(await names("/api/printers?sort=-model")).toEqual(["MK4", "A1"]);
    expect(await names("/api/printers?powerW=200..")).toEqual(["MK4"]);

    const brandA = await post("/api/filament-brands", { name: "Acme" });
    const brandZ = await post("/api/filament-brands", { name: "Zed" });
    const matPla = await post("/api/filament-materials", { name: "PLA" });
    const matPetg = await post("/api/filament-materials", { name: "PETG" });
    const pla = await post("/api/filament/profiles", {
      brandId: brandA.id,
      materialId: matPla.id,
      name: "Basic",
      densityGcm3: 1.24,
    });
    const petg = await post("/api/filament/profiles", {
      brandId: brandZ.id,
      materialId: matPetg.id,
      name: "",
      densityGcm3: 1.27,
    });
    await post("/api/filament/spools", { profileId: pla.id, initialGrams: 1000 });
    await post("/api/filament/spools", { profileId: petg.id, initialGrams: 500 });
    expect(await names("/api/filament/spools?filament=basic", "initialGrams")).toEqual([1000]);
    expect(await names("/api/filament/spools?sort=-filament", "initialGrams")).toEqual([500, 1000]);
    expect(await names("/api/filament/profiles?filament=petg", "brand")).toEqual(["Zed"]);

    db.insert(schema.projects)
      .values([
        { name: "Vase", description: "spiral", meta: { materials: ["PLA"], multicolor: false } },
        { name: "Dragon", meta: { materials: ["PETG", "TPU"], multicolor: true } },
      ])
      .run();
    expect(await names("/api/projects?material=TPU,ASA")).toEqual(["Dragon"]);
    expect(await names("/api/projects?multicolor=true")).toEqual(["Dragon"]);
    expect(await names("/api/projects?multicolor=false")).toEqual(["Vase"]);
    expect(await names("/api/projects?sort=-multicolor")).toEqual(["Dragon", "Vase"]);
    expect(await names("/api/projects?name=SPIRAL")).toEqual(["Vase"]);
    expect((await app.inject("/api/projects/materials")).json()).toEqual(["PETG", "PLA", "TPU"]);

    const [vase] = await names("/api/projects?name=vase", "id");
    db.insert(schema.prints)
      .values({
        printerId: printer.id,
        projectId: vase,
        title: "v",
        startedAt: "2026-03-01T10:00:00.000Z",
        outcome: "success",
      })
      .run();
    expect(await names("/api/projects?sort=-lastPrintAt", "lastPrintAt")).toEqual([
      "2026-03-01T10:00:00.000Z",
      null,
    ]);
    expect(await names("/api/projects?lastPrintAt=2026-03-01..2026-03-01")).toEqual(["Vase"]);
  });
});
