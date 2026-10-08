import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import type { ExternalPrint } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;

beforeEach(async () => {
  db = openDb(":memory:");
  state = fixture();
  app = await buildApp(db, false, "", { adapters: [mockAdapter(state)] });
});

const send = (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });
const firstPrint = () => state.prints[0] as ExternalPrint;
const get = async (url: string) => (await app.inject(url)).json();

const create = async () =>
  (
    await send("POST", "/api/integrations", {
      adapterId: "mock",
      name: "My mock",
      secrets: { token: "s3cr3t-token" },
    })
  ).json();
const sync = async (id: string) => (await send("POST", `/api/integrations/${id}/sync`)).json();

describe("integrations", () => {
  it("stores secrets encrypted and never returns them", async () => {
    const res = await send("POST", "/api/integrations", {
      adapterId: "mock",
      name: "My mock",
      secrets: { token: "s3cr3t-token" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ hasSecrets: true, status: "new" });
    expect(res.body).not.toContain("s3cr3t");
    const row = db.select().from(schema.integrations).get();
    expect(row?.secrets).toBeTruthy();
    expect(row?.secrets).not.toContain("s3cr3t");
    expect((await send("POST", `/api/integrations/${res.json().id}/test`)).json()).toEqual({
      ok: true,
    });
  });

  it("rejects unknown adapters and invalid config or secrets", async () => {
    const post = (body: object) =>
      send("POST", "/api/integrations", { adapterId: "mock", name: "x", ...body });
    expect((await post({ adapterId: "nope" })).json().error.code).toBe("unknown_adapter");
    expect((await post({ config: { label: 1 } })).json().error.code).toBe("invalid_config");
    expect((await post({ secrets: {} })).json().error.code).toBe("invalid_secrets");
  });

  it("syncs printers and prints end to end, and re-syncs without duplicates", async () => {
    const { id } = await create();
    const run = await sync(id);
    expect(run).toMatchObject({ status: "ok", trigger: "manual", created: 4, skipped: 0 });

    const printers = db.select().from(schema.printers).all();
    expect(printers).toHaveLength(1);
    expect(printers[0]).toMatchObject({ origin: "integration", integrationId: id, brand: "Mock" });
    const prints = (await get("/api/prints?sort=startedAt")).items;
    expect(prints).toHaveLength(3); // 2 pages from the adapter
    expect(prints[1]).toMatchObject({
      origin: "integration",
      externalId: "job-2",
      outcome: "failed",
      failureReason: "Spaghetti",
      printerId: printers[0]?.id,
    });
    expect(prints[0].usages).toMatchObject([{ grams: 10, slot: 0, spoolId: null }]);
    expect(await get(`/api/integrations/${id}`)).toMatchObject({ status: "ok", lastError: null });

    // Local edits win: a re-sync skips rows it already imported.
    await send("PATCH", `/api/prints/${prints[0].id}`, { title: "Renamed" });
    // Inside the overlap window, so the adapter returns them again.
    for (const p of state.prints) p.startedAt = new Date().toISOString();
    state.prints.push({ ...firstPrint(), externalId: "job-9", title: "New one" });
    expect(await sync(id)).toMatchObject({ status: "ok", created: 1, skipped: 4 });
    const after = (await get("/api/prints?sort=startedAt")).items;
    expect(after).toHaveLength(4);
    expect(after[0].title).toBe("Renamed");
    expect(await get(`/api/integrations/${id}/runs`)).toHaveLength(2);
  });

  it("records failures as an error code, raises and resolves a sync_failed alert", async () => {
    const { id } = await create();
    state.fail = "auth_expired";
    expect(await sync(id)).toMatchObject({ status: "error", errorCode: "auth_expired" });
    expect(await get(`/api/integrations/${id}`)).toMatchObject({
      status: "error",
      lastError: "auth_expired",
      lastSyncAt: null,
    });
    await sync(id);
    const open = () =>
      db
        .select()
        .from(schema.alerts)
        .all()
        .filter((a) => a.kind === "sync_failed" && a.entityId === id && !a.resolvedAt);
    expect(open()).toHaveLength(1);

    state.fail = undefined;
    expect(await sync(id)).toMatchObject({ status: "ok" });
    expect(open()).toHaveLength(0);
  });

  it("skips prints of unknown printers and keeps imported rows when the integration goes", async () => {
    const { id } = await create();
    firstPrint().printerExternalId = "unknown";
    expect(await sync(id)).toMatchObject({ created: 3, skipped: 1 });

    expect((await send("DELETE", `/api/integrations/${id}`)).statusCode).toBe(204);
    const prints = db.select().from(schema.prints).all();
    expect(prints).toHaveLength(2);
    expect(prints.every((p) => p.integrationId === null)).toBe(true);
    expect(db.select().from(schema.syncRuns).all()).toHaveLength(0);
  });

  it("patches name, enabled and secrets", async () => {
    const { id } = await create();
    const res = await send("PATCH", `/api/integrations/${id}`, {
      name: "Renamed",
      enabled: false,
      secrets: { token: "new" },
    });
    expect(res.json()).toMatchObject({ name: "Renamed", enabled: false, hasSecrets: true });
    const row = db.select().from(schema.integrations).where(eq(schema.integrations.id, id)).get();
    expect(row?.secrets).not.toContain("new");
  });
});
