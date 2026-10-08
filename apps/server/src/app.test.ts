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
    expect(spec.paths["/api/settings/{key}"]).toBeDefined();
  });

  it("settings CRUD", async () => {
    const put = (value: unknown) =>
      app.inject({ method: "PUT", url: "/api/settings/currency", payload: { value } });
    expect((await put("EUR")).json()).toEqual({ key: "currency", value: "EUR" });
    expect((await put({ a: 1 })).json().value).toEqual({ a: 1 });
    expect((await app.inject("/api/settings/currency")).json().value).toEqual({ a: 1 });
    expect((await app.inject({ method: "DELETE", url: "/api/settings/currency" })).statusCode).toBe(
      204,
    );
    const missing = await app.inject("/api/settings/currency");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("settings list paginates and sorts", async () => {
    for (const k of ["a", "b", "c"])
      await app.inject({ method: "PUT", url: `/api/settings/${k}`, payload: { value: k } });
    const res = (await app.inject("/api/settings?pageSize=2&page=2&sort=-key")).json();
    expect(res).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.items.map((i: { key: string }) => i.key)).toEqual(["a"]);
  });

  it("uniform validation + not-found errors", async () => {
    const bad = await app.inject("/api/settings?pageSize=999&sort=nope");
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
