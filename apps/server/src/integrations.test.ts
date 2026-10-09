import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  type ExternalPrint,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { loadKey } from "./integrations/secrets.ts";
import { createSyncer } from "./integrations/sync.ts";
import { modelIdFor } from "./lib/catalog.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;

beforeEach(async () => {
  db = openDb(":memory:");
  state = fixture();
  app = await buildApp(db, false, "", { adapters: [mockAdapter(state), loginAdapter()] });
});

// The mock vendor plus an email-code sign-in: password "pw", then code "123456".
const loginAdapter = (): IntegrationAdapter => ({
  ...mockAdapter(state),
  id: "mock-login",
  secretsSchema: z.object({ token: z.string().optional() }),
  login: async (_ctx, input) => {
    if ("password" in input) {
      if (input.password !== "pw") throw new IntegrationError("login_failed");
      return { challenge: "email_code", state: input.email };
    }
    if (input.code !== "123456") throw new IntegrationError("code_invalid");
    return { secrets: { token: `token-for-${input.state}` } };
  },
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
    const known = modelIdFor(db, "mock ", "m1"); // the adapter sends "Mock"/"M1": reused, any case
    const run = await sync(id);
    expect(run).toMatchObject({ status: "ok", trigger: "manual", created: 4, skipped: 0 });

    const printers = db.select().from(schema.printers).all();
    expect(printers).toHaveLength(1);
    expect(printers[0]).toMatchObject({ origin: "integration", integrationId: id, modelId: known });
    expect(db.select().from(schema.brands).all()).toHaveLength(1);
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
    expect((await get(`/api/integrations/${id}/runs`)).items).toHaveLength(2);
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

  it("links a hand-added printer with the same serial instead of importing a duplicate", async () => {
    await send("POST", "/api/printers", {
      name: "Mine",
      modelId: modelIdFor(db, "Mock", "M1"),
      serial: "mock0001",
    });
    const { id } = await create();
    expect(await sync(id)).toMatchObject({ status: "ok", created: 4 });
    const printers = db.select().from(schema.printers).all();
    expect(printers).toHaveLength(1);
    expect(printers[0]).toMatchObject({
      name: "Mine",
      origin: "manual",
      integrationId: id,
      externalId: "mock-1",
    });
    expect(db.select().from(schema.prints).all()).toHaveLength(3);
    expect(await sync(id)).toMatchObject({ created: 0, skipped: 1 });
  });

  it("scheduled syncs skip errors the user must fix and back off after rate limits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "integrations-"));
    try {
      app = await buildApp(db, false, dir, { adapters: [mockAdapter(state)] });
      const syncer = createSyncer(db, [mockAdapter(state)], loadKey(dir), app.log);
      await create();
      const runs = () => db.select().from(schema.syncRuns).all().length;
      const setError = (lastError: IntegrationErrorCode | null) =>
        db.update(schema.integrations).set({ lastError }).run();

      setError("auth_expired");
      await syncer.runAll();
      expect(runs()).toBe(0);

      setError(null);
      state.fail = "rate_limited";
      await syncer.runAll();
      expect(runs()).toBe(1);
      await syncer.runAll(); // backing off
      expect(runs()).toBe(1);

      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      db.update(schema.syncRuns).set({ startedAt: twoHoursAgo }).run();
      await syncer.runAll();
      expect(runs()).toBe(2);

      // Nothing to sync (cloud features off, e.g. slicer only): left alone.
      state.fail = undefined;
      db.update(schema.integrations)
        .set({ disabledFeatures: ["printers", "prints"] })
        .run();
      await syncer.runAll();
      expect(runs()).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("capabilities", () => {
  const caps = async (id: string) => (await get(`/api/integrations/${id}`)).capabilities;

  it("are what the adapter supports, switched on and set up", async () => {
    const { id } = await create();
    expect(await caps(id)).toEqual(["printers", "prints", "spools"]);
    const adapters = await get("/api/integrations/adapters");
    expect(adapters[0]).toMatchObject({
      id: "mock",
      capabilities: ["printers", "prints", "spools"],
    });

    await send("PATCH", `/api/integrations/${id}`, { disabledFeatures: ["prints"] });
    expect(await caps(id)).toEqual(["printers", "spools"]);
    await send("PATCH", `/api/integrations/${id}`, { enabled: false });
    expect(await caps(id)).toEqual([]);
    expect(
      (await send("PATCH", `/api/integrations/${id}`, { disabledFeatures: ["nope"] })).statusCode,
    ).toBe(400);
  });

  it("account ones need a sign-in when the adapter has one", async () => {
    const { id } = (
      await send("POST", "/api/integrations", { adapterId: "mock-login", name: "L" })
    ).json();
    expect(await caps(id)).toEqual([]);
  });

  it("slicer paths: empty means none, and openInSlicer needs a program", async () => {
    const slicer = { ...mockAdapter(state), id: "slicer", capabilities: ["openInSlicer" as const] };
    app = await buildApp(db, false, "", { adapters: [slicer] });
    const { id } = (
      await send("POST", "/api/integrations", {
        adapterId: "slicer",
        name: "S",
        secrets: { token: "t" },
      })
    ).json();
    expect(await caps(id)).toEqual([]);
    const set = async (slicerPath: string) =>
      (await send("PATCH", `/api/integrations/${id}`, { slicerPath })).json();
    expect(await set(" /bin/slicer ")).toMatchObject({
      slicerPath: "/bin/slicer",
      capabilities: ["openInSlicer"],
    });
    expect(await set("")).toMatchObject({ slicerPath: null, capabilities: [] });
  });

  it("sync skips switched-off features", async () => {
    const { id } = await create();
    await send("PATCH", `/api/integrations/${id}`, { disabledFeatures: ["prints"] });
    expect(await sync(id)).toMatchObject({ status: "ok", created: 1 });
    expect(db.select().from(schema.prints).all()).toHaveLength(0);
  });
});

describe("sign-in", () => {
  const login = (id: string, payload: object) =>
    send("POST", `/api/integrations/${id}/login`, payload);

  it("signs in with a code, stores the token and imports the printers", async () => {
    const adapters = await get("/api/integrations/adapters");
    expect(adapters.map((a: { id: string; login: boolean }) => [a.id, a.login])).toEqual([
      ["mock", false],
      ["mock-login", true],
    ]);
    const created = await send("POST", "/api/integrations", { adapterId: "mock-login", name: "x" });
    const { id, hasSecrets } = created.json();
    expect(hasSecrets).toBe(false);

    expect((await login(id, { code: "123456" })).json().error.code).toBe("login_not_started");
    expect((await login(id, { email: "a@b.c", password: "nope" })).json()).toEqual({
      status: "error",
      code: "login_failed",
    });
    expect((await login(id, { email: "a@b.c", password: "pw" })).json()).toEqual({
      status: "challenge",
      challenge: "email_code",
    });
    expect((await login(id, { code: "000000" })).json()).toEqual({
      status: "error",
      code: "code_invalid",
    });
    expect((await login(id, { code: "123456" })).json()).toEqual({ status: "ok" });
    // The challenge is used up.
    expect((await login(id, { code: "123456" })).statusCode).toBe(409);

    await vi.waitFor(() => expect(db.select().from(schema.syncRuns).all()).toHaveLength(1));
    expect(await get(`/api/integrations/${id}`)).toMatchObject({ hasSecrets: true, status: "ok" });
    expect(db.select().from(schema.printers).all()).toHaveLength(1);
    const row = db.select().from(schema.integrations).get();
    expect(row?.secrets).not.toContain("token-for");
  });

  it("rejects sign-in for adapters without one", async () => {
    const { id } = await create();
    const res = await login(id, { email: "a@b.c", password: "pw" });
    expect(res.json().error.code).toBe("login_unsupported");
  });
});

describe("filament matching of imported prints", () => {
  const spool = async (colorHex = "#ff8800", initialGrams = 1000) => {
    const profile = (
      await send("POST", "/api/filament/profiles", { material: "PLA", densityGcm3: 1.24 })
    ).json();
    return (
      await send("POST", "/api/filament/spools", { profileId: profile.id, colorHex, initialGrams })
    ).json();
  };
  const left = async (id: string) => (await get(`/api/filament/spools/${id}`)).remainingGrams;
  const review = async () => (await get("/api/prints/filament-review")).items;
  // Spools exist from "now", so the mock prints must start after that to be eligible.
  const syncNow = async () => {
    state.prints.forEach((p, i) => {
      p.startedAt = new Date(Date.now() + i * 1000).toISOString();
    });
    return sync((await create()).id);
  };

  it("books a unique type + colour match through the ledger, once", async () => {
    const s = await spool();
    await spool("#00ff00"); // other colour: not a candidate
    const { id } = await create();
    for (const p of state.prints) p.startedAt = new Date().toISOString();
    await sync(id);
    expect(await left(s.id)).toBe(1000 - 60);
    expect(await review()).toEqual([]);
    const usage = (await get("/api/prints?sort=startedAt")).items[0].usages[0];
    expect(usage).toMatchObject({
      spoolId: s.id,
      profileId: s.profileId,
      material: "PLA",
      colorHex: "#ff8800",
    });
    const history = await get(`/api/filament/spools/${s.id}/history`);
    expect(history.filter((e: { kind: string }) => e.kind === "print")).toHaveLength(3);

    await sync(id);
    expect(await left(s.id)).toBe(1000 - 60);
  });

  it("queues ambiguous, unknown and too-heavy slots instead of guessing", async () => {
    const a = await spool();
    const b = await spool();
    await syncNow();
    expect(await left(a.id)).toBe(1000);
    expect(await left(b.id)).toBe(1000);
    expect(await review()).toHaveLength(3);
  });

  it("queues a slot that doesn't fit the only matching spool", async () => {
    const s = await spool("#ff8800", 25); // jobs use 10, 20 and 30 g
    await syncNow();
    expect((await review()).map((r: { grams: number }) => r.grams).sort()).toEqual([20, 30]);
    expect(await left(s.id)).toBe(15);
  });

  it("assigns from the queue (ledger) or dismisses, and edits keep waiting slots", async () => {
    const a = await spool();
    await spool();
    await syncNow();
    const [first, second, third] = await review();
    expect(first.grams).toBe(30); // newest print first

    expect(
      (await send("POST", `/api/prints/filament-review/${first.usageId}/assign`, { spoolId: a.id }))
        .statusCode,
    ).toBe(204);
    expect(await left(a.id)).toBe(970);
    expect(
      (await send("POST", `/api/prints/filament-review/${first.usageId}/assign`, { spoolId: a.id }))
        .statusCode,
    ).toBe(404);

    // Editing the print's spools must not drop the slots still waiting in the queue.
    await send("PATCH", `/api/prints/${second.printId}`, { usages: [] });
    expect(await review()).toHaveLength(2);

    await send("POST", "/api/prints/filament-review/dismiss", {
      usageIds: [second.usageId, third.usageId],
    });
    expect(await review()).toEqual([]);
    expect((await get(`/api/prints/${second.printId}`)).usages).toMatchObject([
      { grams: 20, spoolId: null, dismissed: true },
    ]);
  });

  it("refuses to assign more than the spool holds", async () => {
    await spool();
    await spool();
    await syncNow();
    const small = await spool("#123456", 1);
    const [item] = await review();
    const res = await send("POST", `/api/prints/filament-review/${item.usageId}/assign`, {
      spoolId: small.id,
    });
    expect(res.json().error.code).toBe("insufficient_filament");
    expect(await review()).toHaveLength(3);
  });
});
