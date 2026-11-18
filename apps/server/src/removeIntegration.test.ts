import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import type { IntegrationAdapter } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

// Remove integration (Step 10 of 6.1.0): `DELETE /api/integrations?library=<id>`.

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let dataDir: string;
let db: ReturnType<typeof openDb>;

const start = async (adapters: IntegrationAdapter[]) => {
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "remove-integration-"));
  app = await buildApp(db, false, dataDir, { adapters });
};
afterEach(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const add = async (adapterId: string, token = "t") =>
  (
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId, secrets: { token } },
    })
  ).json().id as string;
const remove = (library: string) =>
  app.inject({ method: "DELETE", url: `/api/integrations?library=${library}` });
const rows = () => db.select().from(schema.integrations).all();

describe("remove integration", () => {
  it("removes every row of the card and keeps the imported printers, unlinked", async () => {
    const state = fixture();
    const base = mockAdapter(state);
    // Three sources of one library, one more of another that stays.
    const a = { ...base, id: "mock-a", library: { ...base.library, id: "mock-lib" } };
    const b = { ...base, id: "mock-b", library: { ...base.library, id: "mock-lib" } };
    const c = { ...base, id: "mock-c", library: { ...base.library, id: "mock-lib" } };
    const other = { ...base, id: "mock-other" };
    await start([a, b, c, other] as IntegrationAdapter[]);
    const ids = [await add("mock-a"), await add("mock-b"), await add("mock-c")];
    const kept = await add("mock-other");
    for (const id of ids)
      await app.inject({
        method: "POST",
        url: `/api/integrations/${id}/sync`,
        payload: { type: "printers" },
      });
    const printers = db.select().from(schema.printers).all().length;
    expect(printers).toBeGreaterThan(0);

    const res = await remove("mock-lib");
    expect(res.statusCode).toBe(200);
    expect([...res.json().removed].sort()).toEqual([...ids].sort());
    expect(rows().map((r) => r.id)).toEqual([kept]);
    // The printers stay; nothing links them to a source any more.
    expect(db.select().from(schema.printers).all()).toHaveLength(printers);
    expect(
      db
        .select()
        .from(schema.syncRuns)
        .all()
        .every((r) => r.integrationId === kept),
    ).toBe(true);
  });

  it("a running sync blocks it and removes nothing", async () => {
    const state = fixture();
    let entered = () => {};
    const inside = new Promise<void>((r) => {
      entered = r;
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = mockAdapter(state);
    const gated: IntegrationAdapter = {
      ...base,
      id: "mock-gated",
      library: { ...base.library, id: "mock-lib" },
      create: (ctx) => {
        const made = base.create?.(ctx);
        if (!made?.printers) throw new Error("no instance");
        const { listPrinters } = made.printers;
        return {
          ...made,
          printers: {
            listPrinters: async (...args) => {
              entered();
              await gate;
              return listPrinters(...args);
            },
          },
        };
      },
    } as IntegrationAdapter;
    const idle = { ...base, id: "mock-idle", library: { ...base.library, id: "mock-lib" } };
    await start([gated, idle as IntegrationAdapter]);
    const quiet = await add("mock-idle");
    const held = await add("mock-gated");
    const running = app.inject({
      method: "POST",
      url: `/api/integrations/${held}/sync`,
      payload: { type: "printers" },
    });
    await inside;

    const res = await remove("mock-lib");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("sync_running");
    // The idle row is still there: the check came before any removal.
    expect(
      rows()
        .map((r) => r.id)
        .sort(),
    ).toEqual([quiet, held].sort());

    release();
    expect((await running).json().status).toBe("ok");
    expect((await remove("mock-lib")).json().removed).toHaveLength(2);
  });

  it("an unknown library removes nothing", async () => {
    await start([mockAdapter(fixture())]);
    const id = await add("mock");
    expect((await remove("nothing")).json()).toEqual({ removed: [] });
    expect(rows().map((r) => r.id)).toEqual([id]);
  });
});
