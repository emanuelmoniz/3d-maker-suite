import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "printers-"));
  db = openDb(":memory:");
  app = await buildApp(db, false, dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const create = async (payload: Record<string, unknown> = {}) =>
  (
    await app.inject({
      method: "POST",
      url: "/api/printers",
      payload: { name: "P1", brand: "Bambu Lab", model: "P1S", ...payload },
    })
  ).json();

describe("printers", () => {
  it("CRUD, state validation, archive/restore", async () => {
    const p = await create({ powerW: 120, purchasePrice: 59900 });
    expect(p).toMatchObject({ state: "working", powerW: 120, archivedAt: null });

    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: "PATCH", url: `/api/printers/${p.id}`, payload });
    expect((await patch({ state: "maintenance" })).json().state).toBe("maintenance");
    const bad = await patch({ state: "exploded" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_state");

    const list = async (q = "") => (await app.inject(`/api/printers${q}`)).json();
    expect((await list("?state=maintenance")).total).toBe(1);
    expect((await list("?state=working")).total).toBe(0);

    expect((await app.inject({ method: "DELETE", url: `/api/printers/${p.id}` })).statusCode).toBe(
      204,
    );
    expect((await list()).total).toBe(0);
    expect((await list("?archived=true")).total).toBe(1);
    expect((await patch({ archived: false })).json().archivedAt).toBeNull();
    expect((await list()).total).toBe(1);

    expect((await app.inject(`/api/printers/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });

  it("stats: period filter, energy fallback to powerW", async () => {
    const p = await create({ powerW: 100 });
    const base = { printerId: p.id, title: "t", outcome: "success" } as const;
    db.insert(schema.prints)
      .values([
        {
          ...base,
          startedAt: "2026-01-10T10:00:00.000Z",
          durationSec: 3600,
          energyWh: 90,
          energySource: "measured",
        },
        {
          ...base,
          startedAt: "2026-02-10T10:00:00.000Z",
          durationSec: 7200,
          outcome: "failed",
          failureReason: "x",
        },
      ])
      .run();
    const stats = async (q = "") => (await app.inject(`/api/printers/${p.id}/stats${q}`)).json();
    expect(await stats()).toMatchObject({
      printCount: 2,
      failedCount: 1,
      totalSec: 10800,
      energyWh: 290,
    });
    expect(await stats("?from=2026-02-01")).toMatchObject({
      printCount: 1,
      totalSec: 7200,
      energyWh: 200,
    });
  });

  it("comments: pinned first, status, delete", async () => {
    const p = await create();
    const url = `/api/printers/${p.id}/comments`;
    const add = async (payload: Record<string, unknown>) =>
      (await app.inject({ method: "POST", url, payload })).json();
    const a = await add({ body: "X axis issue" });
    const b = await add({ body: "Part ordered", pinned: true });
    expect((await app.inject({ method: "POST", url, payload: { body: "  " } })).statusCode).toBe(
      400,
    );

    const bodies = async () => (await app.inject(url)).json().map((c: { body: string }) => c.body);
    expect(await bodies()).toEqual(["Part ordered", "X axis issue"]);

    const resolved = await app.inject({
      method: "PATCH",
      url: `${url}/${a.id}`,
      payload: { status: "resolved", pinned: true },
    });
    expect(resolved.json()).toMatchObject({ status: "resolved", pinned: true });

    expect((await app.inject({ method: "DELETE", url: `${url}/${b.id}` })).statusCode).toBe(204);
    expect(await bodies()).toEqual(["X axis issue"]);
    expect((await app.inject({ method: "DELETE", url: `${url}/${b.id}` })).statusCode).toBe(404);
  });

  it("photo: upload, serve, reject other types, remove", async () => {
    const p = await create();
    const url = `/api/printers/${p.id}/photo`;
    expect((await app.inject(url)).statusCode).toBe(404);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const put = await app.inject({
      method: "PUT",
      url,
      headers: { "content-type": "image/png" },
      payload: png,
    });
    expect(put.json().photoPath).toBe(`photos/${p.id}.png`);
    const got = await app.inject(url);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.rawPayload.equals(png)).toBe(true);

    const txt = await app.inject({
      method: "PUT",
      url,
      headers: { "content-type": "text/plain" },
      payload: "nope",
    });
    expect(txt.statusCode).toBe(415);

    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(204);
    expect((await app.inject(url)).statusCode).toBe(404);
  });
});
