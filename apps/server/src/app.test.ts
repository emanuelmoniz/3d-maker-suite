import { idList, listQuery } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { listPage } from "./lib/list.ts";

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
    db.insert(printers)
      .values([
        { name: "a", brand: "bambu", model: "m", createdAt: "2026-01-10T00:00:00.000Z" },
        { name: "b", brand: "bambu", model: "m", createdAt: "2026-02-10T00:00:00.000Z" },
        { name: "c", brand: "prusa", model: "m", createdAt: "2026-02-20T00:00:00.000Z" },
      ])
      .run();
    const q = listQuery(["name", "createdAt"], { brand: idList.optional() }).parse({
      from: "2026-02-01",
      to: "2026-02-20", // date-only `to` includes the whole day
      brand: "bambu,prusa",
      sort: "-name",
    });
    const res = listPage(db, printers, q, {
      sort: { name: printers.name, createdAt: printers.createdAt },
      dateColumn: printers.createdAt,
      where: [q.brand ? inArrayBrand(q.brand) : undefined],
    });
    expect(res.items.map((p) => p.name)).toEqual(["c", "b"]);
    expect(res.total).toBe(2);
  });
});

import { inIds } from "./lib/list.ts";

const inArrayBrand = (ids: string[]) => inIds(schema.printers.brand, ids);
