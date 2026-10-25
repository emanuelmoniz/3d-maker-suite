import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  type ExternalPrint,
  type ImportPreview,
  type IntegrationAdapter,
  IntegrationError,
  type IntegrationErrorCode,
  type NewSpoolField,
  SYNC_FREQUENCIES,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { catalogName } from "./integrations/imports.ts";
import { loadKey } from "./integrations/secrets.ts";
import { printerRows, spoolRows } from "./integrations/sourceRows.ts";
import { createSyncer, schedulePattern } from "./integrations/sync.ts";
import { filamentProfileIdFor, modelIdFor } from "./lib/catalog.ts";
import { reviewer } from "./testReview.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;
// Reviews keep their rows (and confirms a backup) in the data folder.
let dataDir: string;

beforeEach(async () => {
  db = openDb(":memory:");
  state = fixture();
  dataDir = mkdtempSync(join(tmpdir(), "integrations-"));
  app = await buildApp(db, false, dataDir, { adapters: [mockAdapter(state), loginAdapter()] });
  // The mock's prints ("Mock print 1") are of this project's file, so a run can import them.
  db.insert(schema.projects)
    .values({
      number: 900,
      name: "mock",
      meta: { files: [{ path: "Mock print.3mf", kind: "model", size: 1 }] },
    })
    .run();
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

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
const mockProject = () =>
  db.select().from(schema.projects).where(eq(schema.projects.number, 900)).get()?.id ?? "";
const get = async (url: string) => (await app.inject(url)).json();

const create = async () =>
  (
    await send("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: "s3cr3t-token" },
    })
  ).json();
const syncType = async (id: string, type: string) =>
  (await send("POST", `/api/integrations/${id}/sync`, { type })).json();
/** Printers, then prints (one run each, as the scheduler does); the counts are added up. */
const sync = async (id: string) => {
  const printers = await syncType(id, "printers");
  if (printers.status !== "ok") return printers;
  const prints = await syncType(id, "prints");
  return {
    ...prints,
    created: printers.created + prints.created,
    skipped: printers.skipped + prints.skipped,
  };
};
const setPolicy = (id: string, type: string, policy: object) =>
  send("PATCH", `/api/integrations/${id}`, { policies: [{ type, ...policy }] });
/** A PLA spool; the mock's prints use PLA #ff8800, so one of that colour is their match. */
const spool = async (colorHex = "#ff8800", initialGrams = 1000) => {
  const material =
    (await get("/api/filament-materials")).items[0] ??
    (await send("POST", "/api/filament-materials", { name: "PLA" })).json();
  const profile = (
    await send("POST", "/api/filament/profiles", { materialId: material.id, densityGcm3: 1.24 })
  ).json();
  return (
    await send("POST", "/api/filament/spools", { profileId: profile.id, colorHex, initialGrams })
  ).json();
};
const left = async (id: string) => (await get(`/api/filament/spools/${id}`)).remainingGrams;
const review = reviewer(() => app);
const printsReview = async (id: string, q = "") =>
  (await review.open(`/api/import/integration/${id}/prints${q}`)).json() as ImportPreview;
const watermark = () =>
  db.select().from(schema.syncPolicies).where(eq(schema.syncPolicies.type, "prints")).get()
    ?.cursor ?? null;

describe("integrations", () => {
  it("stores secrets encrypted and never returns them", async () => {
    const res = await send("POST", "/api/integrations", {
      adapterId: "mock",
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
      send("POST", "/api/integrations", { adapterId: "mock", ...body });
    expect((await post({ adapterId: "nope" })).json().error.code).toBe("unknown_adapter");
    expect((await post({ config: { label: 1 } })).json().error.code).toBe("invalid_config");
    expect((await post({ secrets: {} })).json().error.code).toBe("invalid_secrets");
  });

  it("syncs printers and prints end to end, and re-syncs without duplicates", async () => {
    const { id } = await create();
    const known = modelIdFor(db, "mock ", "m1"); // the adapter sends "Mock"/"M1": reused, any case
    const s = await spool();
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
    expect(prints[0].usages).toMatchObject([{ grams: 10, slot: 0, spoolId: s.id }]);
    expect(await left(s.id)).toBe(940);
    expect(await get(`/api/integrations/${id}`)).toMatchObject({ status: "ok", lastError: null });

    // Local edits win: a re-sync skips the rows it already imported.
    await send("PATCH", `/api/prints/${prints[0].id}`, { title: "Renamed" });
    // Inside the overlap window, so the adapter returns them again.
    for (const p of state.prints) p.startedAt = new Date().toISOString();
    state.prints.push({ ...firstPrint(), externalId: "job-9", title: "Mock print 9" });
    expect(await sync(id)).toMatchObject({ status: "ok", created: 1, skipped: 4, pending: 0 });
    const after = (await get("/api/prints?sort=startedAt")).items;
    expect(after).toHaveLength(4);
    expect(after[0].title).toBe("Renamed");
    expect((await get(`/api/integrations/${id}/runs`)).items).toHaveLength(4);
  });

  it("a review without a range offers the prints since the last sync, and older ones never imported", async () => {
    const { id } = await create();
    await spool();
    await sync(id);
    // Before the last sync: imported ones stay out, one never imported comes back however old.
    const before = new Date(Date.now() - 3600 * 1000).toISOString();
    for (const p of state.prints) p.startedAt = before;
    const old = new Date(Date.UTC(2020, 0, 1)).toISOString();
    state.prints.push({
      ...firstPrint(),
      externalId: "job-7",
      title: "Mock print 7",
      startedAt: old,
    });
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    state.prints.push(
      { ...firstPrint(), externalId: "job-8", title: "Mock print 8", startedAt: before },
      { ...firstPrint(), externalId: "job-9", title: "Mock print 9", startedAt: later },
    );
    const p = await printsReview(id);
    expect(p.rows.map((r) => [r.values.title, r.status])).toEqual([
      ["Mock print 7", "new"],
      ["Mock print 8", "new"],
      ["Mock print 9", "new"],
    ]);
  });

  it("links a print to the project its title names and fills in a plate sent later", async () => {
    const { id } = await create();
    const file = (path: string) => ({ path, kind: "model", size: 1 });
    let n = 0;
    const project = (name: string, files: string[]) =>
      db
        .insert(schema.projects)
        .values({ number: ++n, name, meta: { files: files.map(file) } })
        .returning()
        .get();
    const boat = project("Boat", ["model/Benchy.3mf"]);
    project("Box A", ["box.3mf"]);
    project("Box B", ["box.3mf"]);
    await spool();
    const [first, second] = state.prints as [ExternalPrint, ExternalPrint];
    first.title = "benchy_plate_2";
    second.title = "box"; // two projects have a box.3mf: it waits for a person to pick one
    expect(await sync(id)).toMatchObject({ pending: 1 });
    const row = (p: ExternalPrint) =>
      db.select().from(schema.prints).where(eq(schema.prints.externalId, p.externalId)).get();
    expect(row(first)).toMatchObject({ projectId: boat.id, plate: null });
    expect(row(second)).toBeUndefined();

    for (const p of state.prints) p.startedAt = new Date().toISOString();
    first.plate = 2;
    await sync(id);
    expect(row(first)?.plate).toBe(2);
  });

  it("links by the MakerWorld model a 3MF came from, or the folder a file is in", async () => {
    const { id } = await create();
    let n = 0;
    const project = (files: string[], designs: (string | null)[] = []) =>
      db
        .insert(schema.projects)
        .values({
          number: ++n,
          name: `p${n}`,
          meta: {
            files: files.map((path) => ({ path, kind: "model", size: 1 })),
            models: files.map((file, i) => ({ file, designTitle: designs[i] ?? null })),
          },
        })
        .returning()
        .get();
    const azul = project(["03_model/azul.3mf"], ["Azul Tile Pour Box"]);
    project(["a.3mf"], ["Codenames Grid"]);
    project(["b.3mf"], ["Codenames Grid"]);
    const rack = project(["03_model/spice-rack-parametric/printables/spice_rack_rotation.3mf"]);
    await spool();
    await syncType(id, "printers");
    const profile = "0.2mm layer, 2 walls, 15% infill";
    const [a, b, c] = state.prints as [ExternalPrint, ExternalPrint, ExternalPrint];
    // Imported before the adapter titled prints after their model (and before a print needed a
    // project): the profile's name only; `b` renamed by hand since.
    const printerId = db.select().from(schema.printers).get()?.id ?? "";
    for (const [p, title] of [
      [a, profile],
      [b, "my codenames"],
    ] as const)
      db.insert(schema.prints)
        .values({
          number: Number(p.externalId.replace(/\D/g, "")),
          printerId,
          title,
          startedAt: p.startedAt,
          outcome: "success",
          origin: "integration",
          integrationId: id,
          externalId: p.externalId,
        })
        .run();
    Object.assign(a, { title: "Azul Tile Pour Box", profileTitle: profile });
    Object.assign(b, { title: "Codenames Grid", profileTitle: profile });
    Object.assign(c, { title: "spice-rack-parametric_rd_v2_Plate 3" });
    await syncType(id, "prints");
    const row = (p: ExternalPrint) =>
      db.select().from(schema.prints).where(eq(schema.prints.externalId, p.externalId)).get();
    // The title follows the model and the print links; one renamed by hand stays as it is.
    expect(row(a)).toMatchObject({ title: "Azul Tile Pour Box", projectId: azul.id });
    expect(row(b)).toMatchObject({ title: "my codenames", projectId: null });
    expect(row(c)?.projectId).toBe(rack.id);

    // A new print of a model two projects have waits for a person to pick one.
    state.prints.push({ ...b, externalId: "job-8", startedAt: new Date().toISOString() });
    expect(await syncType(id, "prints")).toMatchObject({ created: 0, pending: 1 });
  });

  it("records failures as an error code and raises one sync_error per failing streak", async () => {
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
        .filter((a) => a.kind === "sync_error" && a.context.integrationId === id);
    expect(open()).toHaveLength(1);

    state.fail = undefined;
    expect(await sync(id)).toMatchObject({ status: "ok" });
    // An event, not a condition: it stays until dismissed.
    expect(open()).toHaveLength(1);
  });

  it("skips prints of unknown printers and keeps imported rows when the integration goes", async () => {
    const { id } = await create();
    await spool();
    firstPrint().printerExternalId = "unknown";
    expect(await sync(id)).toMatchObject({ created: 3, pending: 0 });
    // The review shows why: the printer isn't there.
    expect((await printsReview(id, "?from=2026-01-01T00:00:00.000Z")).rows[0]).toMatchObject({
      status: "invalid",
      errors: [{ column: "printer", code: "unresolved" }],
    });

    expect((await send("DELETE", `/api/integrations/${id}`)).statusCode).toBe(204);
    const prints = db.select().from(schema.prints).all();
    expect(prints).toHaveLength(2);
    expect(prints.every((p) => p.integrationId === null)).toBe(true);
    expect(db.select().from(schema.syncRuns).all()).toHaveLength(0);
  });

  it("patches enabled and secrets; integrations have no name", async () => {
    const { id } = await create();
    const res = await send("PATCH", `/api/integrations/${id}`, {
      enabled: false,
      secrets: { token: "new" },
    });
    expect(res.json()).toMatchObject({ enabled: false, hasSecrets: true, capabilities: [] });
    // Disabled = off entirely: no manual sync or test either.
    expect(
      (await send("POST", `/api/integrations/${id}/sync`, { type: "printers" })).statusCode,
    ).toBe(409);
    expect((await send("POST", `/api/integrations/${id}/test`)).statusCode).toBe(409);
    expect(res.json()).not.toHaveProperty("name");
    const row = db.select().from(schema.integrations).where(eq(schema.integrations.id, id)).get();
    expect(row?.secrets).not.toContain("new");
    expect((await send("PATCH", `/api/integrations/${id}`, { name: "x" })).statusCode).toBe(400);
  });

  it("links a hand-added printer with the same serial instead of importing a duplicate", async () => {
    await send("POST", "/api/printers", {
      name: "Mine",
      modelId: modelIdFor(db, "Mock", "M1"),
      serial: "mock0001",
    });
    const { id } = await create();
    await spool();
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

  it("re-syncs printers: a change at the source waits for you, new ones are added", async () => {
    const { id } = await create();
    expect(await syncType(id, "printers")).toMatchObject({ created: 1 });
    db.update(schema.printers).set({ name: "Renamed" }).run();
    // Only your edit differs from the source: nothing to review.
    expect(await syncType(id, "printers")).toMatchObject({ created: 0, pending: 0 });
    const [first] = state.printers;
    if (!first) throw new Error("mock has a printer");
    state.printers = [
      { ...first, name: "Vendor name" },
      { ...first, externalId: "mock-2", serial: "mock0002", name: "Second" },
    ];
    expect(await syncType(id, "printers")).toMatchObject({ created: 1, pending: 1 });
    const names = () =>
      db
        .select({ name: schema.printers.name })
        .from(schema.printers)
        .all()
        .map((p) => p.name)
        .sort();
    expect(names()).toEqual(["Renamed", "Second"]);
    // It waits again on the next run, until you look at it.
    expect(await syncType(id, "printers")).toMatchObject({ pending: 1 });
    const p = (
      await review.open(`/api/import/integration/${id}/printers?waiting=1`)
    ).json() as ImportPreview;
    // "Second" was imported by the run and is unchanged: not in what the run left for you.
    expect(p.rows.map((r) => [r.values.name, r.action, r.auto])).toEqual([
      ["Vendor name", "update", "wait"],
    ]);
    // Skipped in the review: seen, so it doesn't come back until the source changes again.
    expect((await review.confirm(p, [])).statusCode).toBe(200);
    expect(await syncType(id, "printers")).toMatchObject({ pending: 0 });
    expect(names()).toEqual(["Renamed", "Second"]);
    // One you archived isn't imported again.
    db.update(schema.printers).set({ archivedAt: new Date().toISOString() }).run();
    expect(await syncType(id, "printers")).toMatchObject({ created: 0, pending: 0 });
    expect(db.select().from(schema.printers).all()).toHaveLength(2);
  });

  it("keeps the fields you edited and updates the rest under Keep my edits", async () => {
    const { id } = await create();
    await setPolicy(id, "printers", { merge: "keepEdits" });
    const [first] = state.printers;
    if (!first) throw new Error("mock has a printer");
    state.printers = [{ ...first, nozzleDiameterMm: 0.4 }];
    expect(await syncType(id, "printers")).toMatchObject({ created: 1 });
    db.update(schema.printers).set({ name: "Renamed" }).run();
    state.printers = [{ ...first, name: "Vendor name", nozzleDiameterMm: 0.6 }];
    expect(await syncType(id, "printers")).toMatchObject({ updated: 1, pending: 0 });
    expect(db.select().from(schema.printers).get()).toMatchObject({
      name: "Renamed",
      nozzleDiameterMm: 0.6,
    });
    // Only your edited name differs now: nothing to write, nothing waiting.
    state.printers = [{ ...first, name: "Vendor 2", nozzleDiameterMm: 0.6 }];
    expect(await syncType(id, "printers")).toMatchObject({ updated: 0, pending: 0 });
    // Overwrite takes your edit back to the source's.
    await setPolicy(id, "printers", { merge: "overwrite" });
    expect(await syncType(id, "printers")).toMatchObject({ updated: 1 });
    expect(db.select().from(schema.printers).get()?.name).toBe("Vendor 2");
  });

  it("takes only new printers of a brand you have under Only what I already have", async () => {
    const { id } = await create();
    await setPolicy(id, "printers", { scope: "imported" });
    // No Mock brand yet: nothing is added, and nothing waits.
    expect(await syncType(id, "printers")).toMatchObject({ created: 0, pending: 0 });
    await send("POST", "/api/brands", { name: "Mock" });
    expect(await syncType(id, "printers")).toMatchObject({ created: 1 });
  });

  it("Manual import offers the cloud's printers and links a hand-added twin", async () => {
    await send("POST", "/api/printers", {
      name: "Mine",
      modelId: modelIdFor(db, "Mock", "M1"),
      serial: "mock0001",
    });
    const { id } = await create();
    const p = (await review.open(`/api/import/integration/${id}/printers`)).json() as ImportPreview;
    expect(p.rows.map((r) => [r.values.serial, r.status, r.auto])).toEqual([
      ["MOCK0001", "new", "apply"],
    ]);
    expect((await review.confirm(p)).json()).toMatchObject({ created: 1 });
    expect(db.select().from(schema.printers).all()).toEqual([
      expect.objectContaining({ name: "Mine", origin: "manual", integrationId: id }),
    ]);
    // Linked now. A run leaves your name alone ("Let me review the changes"), while a review opened
    // by hand offers to write the source's, as "Overwrite" would.
    const again = (
      await review.open(`/api/import/integration/${id}/printers`)
    ).json() as ImportPreview;
    expect(again.rows.map((r) => [r.action, r.auto])).toEqual([["update", undefined]]);
  });

  it("scheduled syncs skip errors the user must fix and back off after rate limits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "integrations-"));
    try {
      app = await buildApp(db, false, dir, { adapters: [mockAdapter(state)] });
      const syncer = createSyncer(db, [mockAdapter(state)], loadKey(dir), app.log);
      const { id } = await create();
      const runs = () => db.select().from(schema.syncRuns).all().length;
      const setError = (lastError: IntegrationErrorCode | null) =>
        db.update(schema.integrations).set({ lastError }).run();

      setError("auth_expired");
      await syncer.runAll();
      expect(runs()).toBe(0);

      setError(null);
      state.fail = "rate_limited";
      await syncer.runAll(); // the first type fails: the others are left for later
      expect(runs()).toBe(1);
      await syncer.runAll(); // backing off
      expect(runs()).toBe(1);

      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      db.update(schema.syncRuns).set({ startedAt: twoHoursAgo }).run();
      await syncer.runAll();
      expect(runs()).toBe(2);

      // Any other failure is retried after 15 minutes, not on every tick.
      const ago = (ms: number) =>
        db
          .update(schema.syncRuns)
          .set({ startedAt: new Date(Date.now() - ms).toISOString() })
          .run();
      state.fail = "unreachable";
      ago(2 * 3600 * 1000);
      await syncer.runAll();
      expect(runs()).toBe(3);
      await syncer.runAll();
      expect(runs()).toBe(3);
      ago(16 * 60 * 1000);
      await syncer.runAll();
      expect(runs()).toBe(4);

      // Nothing in auto mode (off or manual): left alone.
      state.fail = undefined;
      setError(null);
      await setPolicy(id, "printers", { mode: "off" });
      await setPolicy(id, "prints", { mode: "manual" });
      await syncer.runAll();
      expect(runs()).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sync by type and date range", () => {
  const syncWith = async (id: string, body: object) =>
    (await send("POST", `/api/integrations/${id}/sync`, body)).json();
  const day = (d: number, end = false) =>
    new Date(Date.UTC(2026, 0, d, end ? 23 : 0, end ? 59 : 0)).toISOString();
  const printCount = () => db.select().from(schema.prints).all().length;

  it("syncs one type alone and logs it", async () => {
    const { id } = await create();
    await spool();
    expect(await syncWith(id, { type: "printers" })).toMatchObject({
      status: "ok",
      type: "printers",
      created: 1,
    });
    expect(printCount()).toBe(0);
    expect(watermark()).toBeNull(); // a printers-only run must not make prints skip history
    expect(await syncWith(id, { type: "prints" })).toMatchObject({ type: "prints", created: 3 });
    expect(watermark()).toBeTruthy();
    // One run is one type.
    expect((await send("POST", `/api/integrations/${id}/sync`)).statusCode).toBe(400);
    expect(
      (await get(`/api/integrations/${id}`)).policies.map(
        (p: { type: string; lastRunAt: string | null }) => [p.type, !!p.lastRunAt],
      ),
    ).toEqual([
      ["printers", true],
      ["prints", true],
      ["spools", false],
      ["slice", false],
    ]);
  });

  it("imports a past range without duplicates and leaves the incremental start alone", async () => {
    const { id } = await create();
    await spool();
    await syncWith(id, { type: "printers" });
    const range = { type: "prints", from: day(2), to: day(2, true) };
    expect(await syncWith(id, range)).toMatchObject({
      created: 1,
      rangeFrom: range.from,
      rangeTo: range.to,
    });
    expect(await syncWith(id, range)).toMatchObject({ created: 0 });
    expect(await syncWith(id, { type: "prints", from: day(1), to: day(3, true) })).toMatchObject({
      created: 2,
    });
    expect(printCount()).toBe(3);
    expect(watermark()).toBeNull();
  });

  it("a range run that leaves a print for review moves the cursor back to it, never on", async () => {
    const { id } = await create();
    await spool();
    await sync(id);
    const synced = watermark();
    // No spool of its colour, so it waits; it started before the last sync.
    const startedAt = new Date(Date.UTC(2026, 0, 2, 12)).toISOString();
    const filaments = firstPrint().filaments.map((f) => ({ ...f, colorHex: "#00ff00" }));
    state.prints.push({ ...firstPrint(), externalId: "job-9", startedAt, filaments });
    expect(await syncWith(id, { type: "prints", from: day(2), to: day(2, true) })).toMatchObject({
      pending: 1,
    });
    const at = (iso: unknown) => Date.parse(String(iso));
    expect(at(synced)).toBeGreaterThan(at(startedAt));
    expect(at(watermark())).toBe(at(startedAt));
    // "Since the last sync" offers it again.
    const p = await printsReview(id);
    expect(p.rows.filter((r) => r.status === "new").map((r) => at(r.values.startedAt))).toEqual([
      at(startedAt),
    ]);
    // A range run that leaves nothing doesn't move it on.
    await syncWith(id, { type: "prints", from: day(1), to: day(1, true) });
    expect(at(watermark())).toBe(at(startedAt));
  });

  it("a confirmed review isn't a sync: a print skipped there comes with the next sync", async () => {
    const { id } = await create();
    await spool();
    await sync(id);
    const synced = watermark();
    const now = new Date().toISOString();
    state.prints.push(
      { ...firstPrint(), externalId: "job-8", title: "Mock print 8", startedAt: now },
      { ...firstPrint(), externalId: "job-9", title: "Mock print 9", startedAt: now },
    );
    const p = await printsReview(id);
    // Only the prints not imported yet; import one, skip the other.
    expect(p.rows.map((r) => r.values.title)).toEqual(["Mock print 8", "Mock print 9"]);
    const eight = p.rows.filter((r) => r.values.title === "Mock print 8");
    expect((await review.confirm(p, eight)).json()).toMatchObject({ created: 1 });
    // Never on; back to the skipped print at most.
    expect(Date.parse(String(watermark()))).toBeLessThanOrEqual(Date.parse(String(synced)));
    expect(await syncType(id, "prints")).toMatchObject({ created: 1 });
    expect(printCount()).toBe(5);
  });

  it("reviews a range and applies it as that range, so the incremental start stays", async () => {
    const { id } = await create();
    await syncWith(id, { type: "printers" });
    // No spool: every print waits for a person.
    const q = `?from=${day(1)}&to=${day(2, true)}`;
    const p = await printsReview(id, q);
    expect(p.rows.map((r) => [r.values.title, r.status, r.auto])).toEqual([
      ["Mock print 1", "new", "wait"],
      ["Mock print 2", "new", "wait"],
    ]);
    expect((await review.confirm(p)).json()).toMatchObject({ created: 2 });
    expect(printCount()).toBe(2);
    expect(watermark()).toBeNull();
    // Their slots wait in the filament queue, with the colour the printer reported.
    expect((await get("/api/prints/filament-review")).items).toMatchObject([
      { material: "PLA", colorHex: "#ff8800", grams: 20, slot: 0 },
      { material: "PLA", colorHex: "#ff8800", grams: 10, slot: 0 },
    ]);
    // The queue sorts and filters like the other tables, and its total follows the filter.
    const sorted = await get("/api/prints/filament-review?sort=grams&grams=15..");
    expect(sorted).toMatchObject({ total: 1, items: [{ grams: 20 }] });
    expect((await get("/api/prints/filament-review?printTitle=nope")).total).toBe(0);
    // The range comes back whole: the prints already imported, skipped and unchanged.
    const again = await printsReview(id, q);
    expect(again.rows).toMatchObject([
      { status: "identical", action: "skip" },
      { status: "identical", action: "skip" },
    ]);
    // A slot waiting for a spool shows what the printer reported, to add the spool from.
    expect(again.targets.map((x) => x.values.filament)).toEqual(["PLA #ff8800", "PLA #ff8800"]);
  });

  it("holds unmatched prints from a run; the review suggests a spool per slot and books the pick", async () => {
    const { id } = await create();
    await syncWith(id, { type: "printers" });
    // Nobody watching and no spool: nothing is imported, all of it waits.
    expect(await syncWith(id, { type: "prints" })).toMatchObject({ created: 0, pending: 3 });
    expect(printCount()).toBe(0);

    const match = await spool();
    const other = await spool("#000000");
    const p = await printsReview(id, `?from=${day(1)}&to=${day(2, true)}`);
    expect(p.refsOptional).toContain("spool");
    expect(p.refOptions?.spool?.map((o) => o.id).sort()).toEqual([match.id, other.id].sort());
    const project = mockProject();
    expect(p.rows.map((r) => [r.action, r.refs])).toEqual([
      ["create", { project, spool: match.id }],
      ["create", { project, spool: match.id }],
    ]);
    const apply = (refs: Record<string, string>[]) =>
      send("POST", "/api/import/prints/apply", {
        uploadId: p.uploadId,
        policy: "overwrite",
        decisions: p.rows.map((r, i) => ({ row: r.row, action: "create", refs: refs[i] })),
      });
    // A pick must be a spool you have; one left out is fine. The project can't be left out.
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await apply([{ project, spool: unknown }, { project }])).statusCode).toBe(400);
    expect((await apply([{ project, spool: other.id }, {}])).statusCode).toBe(400);
    expect((await apply([{ project, spool: other.id }, { project }])).json()).toMatchObject({
      created: 2,
    });

    // The slot left out waits, and is matched again at once: exactly one spool fits it.
    const prints = (await get("/api/prints?sort=startedAt")).items;
    expect(
      prints.map((x: { usages: { spoolId: string | null }[] }) => x.usages[0]?.spoolId),
    ).toEqual([other.id, match.id]);

    // A print you have comes back as a skip; an update moves its slot to another spool by name,
    // and the slot keeps what the printer reported.
    const again = await printsReview(id, `?from=${day(1)}&to=${day(2, true)}`);
    const row = again.rows.find((r) => r.targetId === prints[0].id);
    expect(row).toMatchObject({ status: "identical", action: "skip" });
    const [usage] = prints[0].usages;
    const moved = await send("POST", "/api/import/prints/apply", {
      uploadId: again.uploadId,
      policy: "overwrite",
      decisions: [
        {
          row: row?.row,
          action: "update",
          targetId: row?.targetId,
          values: {
            spool: again.refOptions?.spool?.find((o) => o.id === match.id)?.label,
            grams: usage.grams,
          },
        },
      ],
    });
    expect(moved.json()).toMatchObject({ updated: 1 });
    expect((await get(`/api/prints/${prints[0].id}`)).usages).toMatchObject([
      { spoolId: match.id, slot: usage.slot, colorHex: usage.colorHex },
    ]);
  });

  it("rejects ranges for other types, backwards ranges and switched-off types", async () => {
    const { id } = await create();
    const code = async (body: object) => await send("POST", `/api/integrations/${id}/sync`, body);
    expect((await code({ type: "printers", from: day(1) })).statusCode).toBe(400);
    expect((await code({ from: day(1) })).statusCode).toBe(400);
    expect((await code({ type: "prints", from: day(3), to: day(1) })).statusCode).toBe(400);
    await setPolicy(id, "prints", { mode: "off" });
    expect((await code({ type: "prints" })).statusCode).toBe(409);
  });

  it("the scheduler runs each auto type at its own frequency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "integrations-"));
    try {
      app = await buildApp(db, false, dir, { adapters: [mockAdapter(state)] });
      const syncer = createSyncer(db, [mockAdapter(state)], loadKey(dir), app.log);
      const { id } = await create();
      const runs = (type: string) =>
        db
          .select()
          .from(schema.syncRuns)
          .all()
          .filter((r) => r.type === type && r.trigger === "scheduled").length;
      const counts = () => ["printers", "prints", "spools"].map(runs);
      // Every type last ran `ms` ago.
      const age = (ms: number) =>
        db
          .update(schema.syncPolicies)
          .set({ lastRunAt: new Date(Date.now() - ms).toISOString() })
          .run();

      await syncer.runAll(); // never ran: both auto types are due, spools are manual
      expect(counts()).toEqual([1, 1, 0]);
      await syncer.runAll(); // just ran
      expect(counts()).toEqual([1, 1, 0]);

      age(2 * 3600 * 1000);
      await syncer.runAll(); // prints are hourly, printers daily
      expect(counts()).toEqual([1, 2, 0]);
      await setPolicy(id, "printers", { frequency: "1h" });
      await syncer.runAll();
      expect(counts()).toEqual([2, 2, 0]);

      // A manual run counts too: the type is not due again right after it.
      age(2 * 3600 * 1000);
      await syncType(id, "prints");
      await syncer.runAll();
      expect(counts()).toEqual([3, 2, 0]);

      await setPolicy(id, "prints", { mode: "manual" });
      await setPolicy(id, "spools", { mode: "auto", frequency: "1w" });
      age(30 * 24 * 3600 * 1000);
      await syncer.runAll();
      expect(counts()).toEqual([4, 2, 1]);
      expect((await setPolicy(id, "prints", { frequency: "fortnightly" })).statusCode).toBe(400);
      expect((await setPolicy(id, "prints", { atHour: 24 })).statusCode).toBe(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a type with a time set runs at its slot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "integrations-"));
    try {
      app = await buildApp(db, false, dir, { adapters: [mockAdapter(state)] });
      const syncer = createSyncer(db, [mockAdapter(state)], loadKey(dir), app.log);
      const { id } = await create();
      await setPolicy(id, "printers", { mode: "off" });
      // Daily, at the local minute an hour ago.
      const slot = new Date(Date.now() - 3600 * 1000);
      slot.setSeconds(0, 0);
      await setPolicy(id, "prints", {
        frequency: "1d",
        atHour: slot.getHours(),
        atMinute: slot.getMinutes(),
      });
      const lastRun = (ms: number) =>
        db
          .update(schema.syncPolicies)
          .set({ lastRunAt: new Date(slot.getTime() + ms).toISOString() })
          .run();
      const runs = () => db.select().from(schema.syncRuns).all().length;

      lastRun(60 * 1000); // ran just after the slot: the next one is tomorrow
      await syncer.runAll();
      expect(runs()).toBe(0);
      lastRun(-60 * 1000); // ran just before it: the slot has come since
      await syncer.runAll();
      expect(runs()).toBe(1);
      await syncer.runAll();
      expect(runs()).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds the croner pattern for each frequency", () => {
    const none = { atMinute: null, atHour: null, atWeekday: null, atDay: null };
    const at = { atMinute: 35, atHour: 7, atWeekday: 3, atDay: 12 };
    expect(SYNC_FREQUENCIES.map((f) => schedulePattern(f, none))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(SYNC_FREQUENCIES.map((f) => schedulePattern(f, at))).toEqual([
      "5/15 * * * *",
      "35 * * * *",
      "35 7 * * *",
      "0 7 * * 3",
      "0 7 12 * *",
    ]);
    // A field the frequency doesn't use doesn't count; a missing one it uses is filled in.
    expect(schedulePattern("1h", { ...none, atHour: 7 })).toBeNull();
    expect(schedulePattern("1w", { ...none, atHour: 6 })).toBe("0 6 * * 1");
    expect(schedulePattern("1M", { ...none, atHour: 3 })).toBe("0 3 1 * *");
  });
});

describe("capabilities", () => {
  const caps = async (id: string) => (await get(`/api/integrations/${id}`)).capabilities;

  it("are what the adapter supports, switched on and set up", async () => {
    const { id } = await create();
    // `slice` also needs a slicer program.
    expect(await caps(id)).toEqual(["printers", "prints", "spools"]);
    const adapters = await get("/api/integrations/adapters");
    expect(adapters[0]).toMatchObject({
      id: "mock",
      capabilities: ["printers", "prints", "spools", "slice"],
    });

    // Until changed, every type follows its default policy; spools start untracked on a new one.
    const defaults = {
      lastRunAt: null,
      pending: 0,
      alertSeverities: null,
      trackUsage: true,
      scope: "all",
      merge: "keepEdits",
      newWeight: "import",
      newOpenedAt: "unset",
      atMinute: null,
      atHour: null,
      atWeekday: null,
      atDay: null,
      editorSync: false,
      editorReview: false,
    };
    expect((await get(`/api/integrations/${id}`)).policies).toEqual([
      { type: "printers", mode: "auto", frequency: "1d", ...defaults, merge: "review" },
      { type: "prints", mode: "auto", frequency: "1h", ...defaults },
      {
        type: "spools",
        mode: "manual",
        frequency: "1d",
        ...defaults,
        trackUsage: false,
        merge: "review",
      },
      { type: "slice", mode: "manual", frequency: "1d", ...defaults },
    ]);
    const patched = (await setPolicy(id, "prints", { mode: "off" })).json();
    expect(patched.capabilities).toEqual(["printers", "spools"]);
    expect(patched.policies[1]).toMatchObject({ type: "prints", mode: "off", frequency: "1h" });
    await send("PATCH", `/api/integrations/${id}`, { enabled: false });
    expect(await caps(id)).toEqual([]);
    // Unknown types and ones this adapter doesn't have are refused.
    expect((await setPolicy(id, "nope", { mode: "off" })).statusCode).toBe(400);
    expect((await setPolicy(id, "openInSlicer", { mode: "off" })).json().error.code).toBe(
      "invalid_policy",
    );
  });

  it("keep the setting of integrations added before spools started off", async () => {
    const { id } = await create();
    db.delete(schema.syncPolicies).where(eq(schema.syncPolicies.integrationId, id)).run();
    expect(await caps(id)).toEqual(["printers", "prints", "spools"]);
    const spools = (await get(`/api/integrations/${id}`)).policies[2];
    expect(spools).toMatchObject({ type: "spools", mode: "manual", trackUsage: true });
    await setPolicy(id, "spools", { trackUsage: false });
    expect((await get(`/api/integrations/${id}`)).policies[2]).toMatchObject({
      mode: "manual",
      trackUsage: false,
    });
  });

  it("account ones need a sign-in when the adapter has one", async () => {
    const { id } = (await send("POST", "/api/integrations", { adapterId: "mock-login" })).json();
    expect(await caps(id)).toEqual([]);
  });

  it("slicer paths: empty means none, and openInSlicer needs a program that exists", async () => {
    const slicer = {
      ...mockAdapter(state),
      id: "slicer",
      kind: "local" as const,
      capabilities: ["openInSlicer" as const],
    };
    app = await buildApp(db, false, "", { adapters: [slicer] });
    const { id } = (
      await send("POST", "/api/integrations", {
        adapterId: "slicer",
        secrets: { token: "t" },
      })
    ).json();
    expect(await caps(id)).toEqual([]);
    const set = async (slicerPath: string) =>
      (await send("PATCH", `/api/integrations/${id}`, { slicerPath })).json();
    expect(await set(` ${process.execPath} `)).toMatchObject({
      slicerPath: process.execPath,
      capabilities: ["openInSlicer"],
    });
    expect(await set("/no/such/slicer")).toMatchObject({ capabilities: [] });
    expect(await set("")).toMatchObject({ slicerPath: null, capabilities: [] });
    // An action is on (manual) or off, never scheduled.
    expect((await setPolicy(id, "openInSlicer", { mode: "auto" })).statusCode).toBe(400);
    await set(process.execPath);
    expect((await setPolicy(id, "openInSlicer", { mode: "off" })).json().capabilities).toEqual([]);
  });

  it("a local source is ok when its folder is on this server, else unavailable; only its own types run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "local-"));
    try {
      const local: IntegrationAdapter = {
        id: "local",
        kind: "local",
        capabilities: ["filamentProfiles"],
        configSchema: z.object({}),
        secretsSchema: z.object({}),
        library: { id: "local", defaultDirs: () => [join(dir, "missing")], read: async () => [] },
      };
      app = await buildApp(db, false, "", { adapters: [mockAdapter(state), local] });
      const adapters = await get("/api/integrations/adapters");
      expect(adapters.map((a: { id: string; kind: string }) => [a.id, a.kind])).toEqual([
        ["mock", "cloud"],
        ["local", "local"],
      ]);
      expect(await create()).toMatchObject({ kind: "cloud", status: "new" });

      const { id, ...created } = (
        await send("POST", "/api/integrations", { adapterId: "local" })
      ).json();
      expect(created).toMatchObject({ kind: "local", status: "unavailable", capabilities: [] });
      const found = await send("PATCH", `/api/integrations/${id}`, { slicerConfigDir: dir });
      expect(found.json()).toMatchObject({ status: "ok", capabilities: ["filamentProfiles"] });

      expect(
        (await send("POST", `/api/integrations/${id}/sync`, { type: "printers" })).statusCode,
      ).toBe(409);
      expect((await send("POST", `/api/integrations/${id}/test`)).statusCode).toBe(409);
      expect(db.select().from(schema.syncRuns).all()).toEqual([]);
      expect(await syncType(id, "filamentProfiles")).toMatchObject({ status: "ok", created: 0 });
      expect((await get(`/api/integrations/${id}`)).status).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sync skips switched-off features", async () => {
    const { id } = await create();
    await setPolicy(id, "prints", { mode: "off" });
    expect(await syncType(id, "printers")).toMatchObject({ status: "ok", created: 1 });
    expect((await syncType(id, "prints")).error.code).toBe("capability_unavailable");
    expect(db.select().from(schema.prints).all()).toHaveLength(0);
  });

  it("stops an adapter that keeps handing back the same page", async () => {
    let calls = 0;
    const stuck: IntegrationAdapter = {
      ...mockAdapter(state),
      id: "stuck",
      create: () => ({
        test: async () => ({ ok: true }),
        printHistory: {
          listPrints: async () => {
            calls++;
            return { items: [], nextCursor: "same" };
          },
        },
      }),
    };
    app = await buildApp(db, false, "", { adapters: [stuck] });
    const { id } = (
      await send("POST", "/api/integrations", { adapterId: "stuck", secrets: { token: "t" } })
    ).json();
    expect(await sync(id)).toMatchObject({ status: "error", errorCode: "api_changed" });
    expect(calls).toBe(2);
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
    const created = await send("POST", "/api/integrations", { adapterId: "mock-login" });
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
  const queue = async () => (await get("/api/prints/filament-review")).items;
  const printCount = () => db.select().from(schema.prints).all().length;
  // Spools exist from "now"; prints an hour later take from them (earlier ones only link them).
  const later = () =>
    state.prints.forEach((p, i) => {
      p.startedAt = new Date(Date.now() + 3600 * 1000 + i * 1000).toISOString();
    });
  const syncNow = async () => {
    later();
    const { id } = await create();
    return { id, run: await sync(id) };
  };
  /** Imports every print the review holds, as the user confirming the review screen. */
  const importHeld = async (id: string) => review.confirm(await printsReview(id));

  it("books a unique type + colour match through the ledger, once", async () => {
    const s = await spool();
    await spool("#00ff00"); // other colour: not a candidate
    const { id } = await syncNow();
    expect(await left(s.id)).toBe(1000 - 60);
    expect(await queue()).toEqual([]);
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

  it("holds prints picked from several spools of one colour, and keeps the cursor at them", async () => {
    const a = await spool();
    const b = await spool();
    const { id, run } = await syncNow();
    expect(run).toMatchObject({ created: 1, pending: 3 }); // the printer only
    expect(printCount()).toBe(0);
    expect(await left(a.id)).toBe(1000);
    expect(await left(b.id)).toBe(1000);
    // To the second, as the review reads the start.
    expect(Date.parse(watermark() ?? "")).toBe(
      Math.floor(Date.parse(state.prints[0]?.startedAt ?? "") / 1000) * 1000,
    );
    expect((await get(`/api/integrations/${id}`)).policies[1]).toMatchObject({ pending: 3 });

    // The review suggests the oldest, to be checked; confirming books it.
    const p = await printsReview(id);
    expect(p.rows.map((r) => [r.refs?.spool, r.refsUnsure, r.auto])).toEqual([
      [a.id, ["spool"], "wait"],
      [a.id, ["spool"], "wait"],
      [a.id, ["spool"], "wait"],
    ]);
    expect((await review.confirm(p)).json()).toMatchObject({ created: 3 });
    expect(await queue()).toEqual([]);
    expect(await left(a.id)).toBe(1000 - 60);
    expect(await left(b.id)).toBe(1000);
  });

  it("holds a print with no spool of its colour, and queues its slot when imported", async () => {
    await spool("#00ff00");
    const { id, run } = await syncNow();
    expect(run).toMatchObject({ pending: 3 });
    const p = await printsReview(id);
    expect(p.rows.map((r) => [r.values.spool ?? null, r.values.filament, r.auto])).toEqual([
      [null, "PLA #ff8800", "wait"],
      [null, "PLA #ff8800", "wait"],
      [null, "PLA #ff8800", "wait"],
    ]);
    expect((await review.confirm(p)).json()).toMatchObject({ created: 3 });
    expect(await queue()).toHaveLength(3);
  });

  it("only links the spools when the policy says not to track usage", async () => {
    const s = await spool();
    later();
    const { id } = await create();
    await setPolicy(id, "prints", { trackUsage: false });
    expect((await get(`/api/integrations/${id}`)).policies[1]).toMatchObject({ trackUsage: false });
    await sync(id);
    expect(printCount()).toBe(3);
    expect(await left(s.id)).toBe(1000);
    const usage = (await get("/api/prints?sort=startedAt")).items[0].usages[0];
    expect(usage).toMatchObject({ spoolId: s.id, grams: 10 });
  });

  it("a review row ticked off saves its print and leaves the weight alone", async () => {
    const a = await spool();
    await spool();
    const { id } = await syncNow();
    const p = await printsReview(id);
    const res = await send("POST", "/api/import/prints/apply", {
      uploadId: p.uploadId,
      policy: "overwrite",
      decisions: p.rows.map((r) => ({
        row: r.row,
        action: "create",
        refs: { project: mockProject(), spool: a.id },
        // The 10 g print isn't tracked; the 20 g and 30 g ones are.
        trackUsage: r.values.grams !== 10,
      })),
    });
    expect(res.json()).toMatchObject({ created: 3 });
    expect(await left(a.id)).toBe(1000 - 50);
    expect(await queue()).toEqual([]);
  });

  it("holds a print that doesn't fit what the only matching spool has left", async () => {
    const s = await spool("#ff8800", 25); // jobs use 10, 20 and 30 g
    const { run } = await syncNow();
    expect(run).toMatchObject({ pending: 2 });
    expect(printCount()).toBe(1);
    expect(await left(s.id)).toBe(15);
  });

  it("matches waiting slots again once a single spool fits, never on a guess", async () => {
    const { id } = await syncNow();
    await importHeld(id);
    expect(await queue()).toHaveLength(3);
    const a = await spool();
    const b = await spool();
    await sync(id);
    expect(await queue()).toHaveLength(3);
    await send("PATCH", `/api/filament/spools/${b.id}`, { archived: true });
    await sync(id);
    expect(await queue()).toEqual([]);
    expect(await left(a.id)).toBe(1000 - 60);
  });

  it("tells spools of one colour apart by the one the printer used last", async () => {
    const a = await spool();
    const b = await spool();
    // Both in use, so the oldest would be the first one entered (a): only the history says b.
    await send("PATCH", `/api/filament/spools/${a.id}`, { status: "in_use" });
    const { id } = await syncNow();
    const p = await printsReview(id);
    await review.confirm(p, p.rows, { refs: { spool: b.id } });
    expect(await left(b.id)).toBe(1000 - 60);
    state.prints.push({
      ...firstPrint(),
      externalId: "job-9",
      startedAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    });
    // Still a guess, so held for a person.
    expect(await sync(id)).toMatchObject({ created: 0, pending: 1 });
    const next = await printsReview(id);
    const fresh = next.rows.filter((r) => r.status === "new");
    expect(fresh.map((r) => [r.refs?.spool, r.refsUnsure])).toEqual([[b.id, ["spool"]]]);
  });

  it("assigns from the queue (ledger) or dismisses, and edits keep waiting slots", async () => {
    const a = await spool("#00ff00"); // no match: every slot waits
    const { id } = await syncNow();
    await importHeld(id);
    const [first, second, third] = await queue();
    expect(first.grams).toBe(30); // newest print first

    expect(
      (await send("POST", `/api/prints/filament-review/${first.usageId}/assign`, { spoolId: a.id }))
        .statusCode,
    ).toBe(204);
    expect(await left(a.id)).toBe(970);
    // The spool's own lists: the prints that used it, and the projects of those.
    expect(
      (await get(`/api/prints?spoolId=${a.id}`)).items.map((p: { id: string }) => p.id),
    ).toEqual([first.printId]);
    expect((await app.inject(`/api/projects?spoolId=${a.id}`)).statusCode).toBe(200);
    expect(
      (await send("POST", `/api/prints/filament-review/${first.usageId}/assign`, { spoolId: a.id }))
        .statusCode,
    ).toBe(404);

    // Editing the print's spools must not drop the slots still waiting in the queue.
    await send("PATCH", `/api/prints/${second.printId}`, { usages: [] });
    expect(await queue()).toHaveLength(2);

    await send("POST", "/api/prints/filament-review/dismiss", {
      usageIds: [second.usageId, third.usageId],
    });
    expect(await queue()).toEqual([]);
    expect((await get(`/api/prints/${second.printId}`)).usages).toMatchObject([
      { grams: 20, spoolId: null, dismissed: true },
    ]);
  });

  it("refuses to assign more than the spool holds", async () => {
    const { id } = await syncNow();
    await importHeld(id);
    const small = await spool("#123456", 1);
    const [item] = await queue();
    const res = await send("POST", `/api/prints/filament-review/${item.usageId}/assign`, {
      spoolId: small.id,
    });
    expect(res.json().error).toMatchObject({
      code: "insufficient_filament",
      message: expect.stringMatching(/Spool \d{3}-.* has 1 g left, but ".*" needs \d+(\.\d+)? g/),
    });
    expect(await queue()).toHaveLength(3);
  });
});

describe("spool rows from a vendor", () => {
  const vendor = (spoolId: string) => ({
    spoolId,
    profile: { brand: "", material: "PLA", name: "PLA" },
    colorHex: "#ff8800",
    colorName: null,
    initialGrams: 1000,
    remainingGrams: 400,
    emptyWeightGrams: null,
    status: "in_use" as const,
  });

  it("spell a short name like the catalog only when one name fits", () => {
    const names = ["Bambu PLA Basic", "Generic PLA Basic", "Bambu PLA Matte"];
    expect(catalogName("pla matte", names)).toBe("Bambu PLA Matte");
    expect(catalogName("Bambu PLA Matte", names)).toBe("Bambu PLA Matte");
    // Two end with it: no guess.
    expect(catalogName("PLA Basic", names)).toBe("PLA Basic");
    expect(catalogName("PLA Silk", names)).toBe("PLA Silk");
  });

  it("take the catalog's name for a vendor's short one", () => {
    filamentProfileIdFor(db, { brand: "Bambu Lab", material: "PLA", name: "Bambu PLA Basic" });
    filamentProfileIdFor(db, { brand: "Bambu Lab", material: "PLA", name: "Bambu PLA Matte" });
    const short = {
      ...vendor("mock:3"),
      profile: { brand: "Bambu Lab", material: "PLA", name: "PLA Basic" },
    };
    const unknown = {
      ...short,
      spoolId: "mock:4",
      profile: { ...short.profile, name: "PLA Galaxy" },
    };
    expect(spoolRows(db, [short, unknown]).map((r) => r.raw.profile)).toEqual([
      "Bambu PLA Basic",
      "PLA Galaxy",
    ]);
    modelIdFor(db, "Bambu Lab", "Bambu Lab A1");
    modelIdFor(db, "Bambu Lab", "Bambu Lab A1 mini");
    const printer = { externalId: "d1", name: "A1", brand: "Bambu Lab", model: "A1" };
    expect(printerRows(db, "i1", [printer])[0]?.raw.model).toBe("Bambu Lab A1");
  });

  it("bring a new spool in the way the spools policy says", () => {
    const sealed = { ...vendor("mock:5"), remainingGrams: 1000, status: "new" as const };
    const rows = (newWeight: NewSpoolField, newOpenedAt: NewSpoolField) =>
      spoolRows(db, [vendor("mock:6"), sealed], { newWeight, newOpenedAt }, "2026-10-23").map(
        ({ raw: { initialGrams, remainingGrams, openedAt, hold } }) => ({
          initialGrams,
          remainingGrams,
          openedAt,
          hold,
        }),
      );
    // Only the spool in use gets the import day as its open date.
    expect(rows("import", "import")).toEqual([
      { initialGrams: 1000, remainingGrams: 400, openedAt: "2026-10-23", hold: undefined },
      { initialGrams: 1000, remainingGrams: 1000, openedAt: undefined, hold: undefined },
    ]);
    expect(rows("unset", "unset")[0]).toEqual({
      initialGrams: undefined,
      remainingGrams: undefined,
      openedAt: undefined,
      hold: undefined,
    });
    expect(rows("review", "unset").map((r) => r.hold)).toEqual([true, true]);
    expect(rows("import", "review").map((r) => r.hold)).toEqual([true, true]);
  });
});
