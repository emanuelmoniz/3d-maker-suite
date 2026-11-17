import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import { spoolmanAdapter } from "@3d-maker-suite/adapter-spoolman";
import { type FakeSpoolman, fakeSpoolman } from "@3d-maker-suite/adapter-spoolman/src/fake.ts";
import type { ImportPreview, PrinterSnapshot } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { HOST_GRACE_MS } from "./integrations/spoolPush.ts";
import { reviewer } from "./testReview.ts";

// Spoolman two-way (6.0.0 Step 12): a print charges the Spoolman spool its app spool came from
// exactly once, across retries, restarts, edits and re-imports (ADR-0015). Spoolman is the fake in
// the adapter package, behind `fetch`; the printer is the mock adapter's live status.

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;
let spoolman: FakeSpoolman;
let mockId: string;

let dataDir: string;
// Reviews keep their rows and take a backup in the data folder.
const build = () =>
  buildApp(db, false, dataDir, { adapters: [mockAdapter(state), spoolmanAdapter()] });

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "spoolman-"));
  db = openDb(":memory:");
  state = { ...fixture(), prints: [], status: [] };
  spoolman = fakeSpoolman();
  vi.stubGlobal("fetch", vi.fn(spoolman.handle));
  app = await build();
  mockId = (
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "mock", secrets: { token: "t" } },
    })
  ).json().id;
  await sync(mockId, "printers");
  app.printerStatus.refresh();
});
afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  rmSync(dataDir, { recursive: true, force: true });
});

const sync = (id: string, type: string) =>
  app.inject({ method: "POST", url: `/api/integrations/${id}/sync`, payload: { type } });
const addSpoolman = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "spoolman", config: { host: "spoolman.local:7912" } },
    })
  ).json().id as string;

const at = (s: number) => new Date(Date.UTC(2026, 10, 16, 10, 0, s)).toISOString();
const slot = { slot: 0, material: "PLA", colorHex: "#ff8800" };
/** One job on the mock printer, from printing to finished: the tracker records it. */
async function print(
  id: string | undefined,
  grams: number,
  extra: Partial<PrinterSnapshot["slots"][number]> = {},
  start = 0,
) {
  const job = { ...(id && { id }), file: "benchy.gcode", progress: 50 };
  for (const [s, st] of [
    [start, "printing"],
    [start + 30, "finished"],
    [start + 40, "idle"],
  ] as const) {
    state.status = [
      {
        printerExternalId: "mock-1",
        at: at(s),
        state: st,
        ...(st !== "idle" && { job: { ...job, ...(st === "finished" && { progress: 100 }) } }),
        slots: [{ ...slot, ...extra, active: st === "printing", gramsUsed: grams }],
      },
    ];
    await app.printerStatus.pollAll();
  }
}
const prints = () => db.select().from(schema.prints).all();
const appSpool = (id?: string) =>
  db
    .select()
    .from(schema.spools)
    .where(eq(schema.spools.id, id ?? ""))
    .get();
/** The library keys an app spool is linked by now. */
const keysOf = (id?: string) =>
  db
    .select()
    .from(schema.spoolSources)
    .where(eq(schema.spoolSources.spoolId, id ?? ""))
    .all()
    .filter((l) => !l.unlinkedAt)
    .map((l) => l.source);
const usedIn = (id: number) => spoolman.spools.find((s) => s.id === id)?.used_weight;
const patches = () => spoolman.writes().filter((w) => w.method === "PATCH");
const policy = async (id: string, type: string) =>
  (await app.inject(`/api/integrations/${id}`))
    .json()
    .policies.find((p: { type: string }) => p.type === type);

/** Spoolman with one spool, imported into the app. */
async function imported() {
  const vendor = spoolman.addSpool({ vendor: "Bambu Lab", colorHex: "ff8800", used: 100 });
  const id = await addSpoolman();
  expect((await sync(id, "spools")).json()).toMatchObject({ created: 1 });
  const mine = db.select().from(schema.spools).get();
  expect(mine).toMatchObject({ remainingGrams: 900 });
  expect(keysOf(mine?.id)).toEqual([`spoolman:${vendor.id}`]);
  return { id, vendor, mine: mine?.id };
}

describe("Spoolman two-way", () => {
  it("charges the Spoolman spool once across runs and a restart", async () => {
    const { vendor, mine } = await imported();
    await print("j1", 12.5);
    expect(prints()).toHaveLength(1);
    // The app's own spool, at once.
    expect(appSpool(mine)?.remainingGrams).toBe(887.5);
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(112.5);
    await app.spoolPush.run();
    await app.spoolPush.run();
    // A restart: a new server on the same database.
    await app.close();
    app = await build();
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(112.5);
    expect(patches()).toHaveLength(1);
  });

  it("never charges twice when Spoolman took a write but its answer was lost", async () => {
    const { id, vendor } = await imported();
    await print("j1", 10);
    spoolman.state.loseAnswers = 1;
    await app.spoolPush.run();
    // Spoolman has it; the app doesn't know yet.
    expect(usedIn(vendor.id)).toBe(110);
    expect(await policy(id, "spoolUsage")).toMatchObject({ mode: "manual", pending: 1 });
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(110);
    expect(patches()).toHaveLength(1);
    expect(await policy(id, "spoolUsage")).toMatchObject({ pending: 0 });
  });

  it("waits while Spoolman is down, then writes", async () => {
    const { id, vendor } = await imported();
    await print("j1", 10);
    spoolman.state.down = true;
    await app.spoolPush.run();
    expect(await policy(id, "spoolUsage")).toMatchObject({ pending: 1 });
    spoolman.state.down = false;
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(110);
  });

  it("sends an edit as the difference and gives a deleted print back", async () => {
    const { vendor, mine } = await imported();
    await print("j1", 10);
    await app.spoolPush.run();
    const [p] = prints();
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/prints/${p?.id}`,
      payload: { usages: [{ spoolId: mine, grams: 14, slot: 0 }] },
    });
    expect(edit.statusCode).toBe(200);
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(114);
    expect((await app.inject({ method: "DELETE", url: `/api/prints/${p?.id}` })).statusCode).toBe(
      204,
    );
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(100);
    expect(appSpool(mine)?.remainingGrams).toBe(900);
  });

  it("a job Moonraker reported is charged in the app, not written back", async () => {
    const { vendor, mine } = await imported();
    await print("j1", 8, { spoolId: `spoolman:${vendor.id}`, chargedAtSource: true });
    // The named spool is that spool for sure, and the app charges it.
    expect(appSpool(mine)?.remainingGrams).toBe(892);
    expect(db.select().from(schema.printFilamentUsages).get()).toMatchObject({
      spoolId: mine,
      sourceSpool: `spoolman:${vendor.id}`,
      chargedAtSource: true,
    });
    await app.spoolPush.run();
    expect(patches()).toEqual([]);
    expect(usedIn(vendor.id)).toBe(100);
    // An edit of it isn't written either.
    const [p] = prints();
    await app.inject({
      method: "PATCH",
      url: `/api/prints/${p?.id}`,
      payload: { usages: [{ spoolId: mine, grams: 9, slot: 0 }] },
    });
    await app.spoolPush.run();
    expect(patches()).toEqual([]);
  });

  it("waits while Moonraker may report to the same spool, then writes", async () => {
    const { id, vendor } = await imported();
    await print("j1", 8);
    // The same spool now prints on a printer whose host reports to Spoolman.
    const printing = (state: PrinterSnapshot["state"], s: number): PrinterSnapshot => ({
      printerExternalId: "mock-1",
      at: at(s),
      state,
      job: { id: "j2", file: "cube.gcode", progress: 50 },
      slots: [{ ...slot, spoolId: `spoolman:${vendor.id}`, chargedAtSource: true, active: true }],
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      state.status = [printing("printing", 100)];
      await app.printerStatus.pollAll();
      await app.spoolPush.run();
      expect(patches()).toEqual([]);
      expect(await policy(id, "spoolUsage")).toMatchObject({ pending: 1 });
      // It ended: Moonraker sends its last report; still a minute to wait.
      state.status = [printing("finished", 200)];
      await app.printerStatus.pollAll();
      vi.setSystemTime(Date.now() + HOST_GRACE_MS - 1000);
      await app.spoolPush.run();
      expect(patches()).toEqual([]);
      vi.setSystemTime(Date.now() + 2000);
      await app.spoolPush.run();
      // j1 only: j2 is Moonraker's own.
      expect(usedIn(vendor.id)).toBe(108);
      expect(await policy(id, "spoolUsage")).toMatchObject({ pending: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a print that names no Spoolman spool is written back", async () => {
    const { vendor } = await imported();
    await print("j1", 8);
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(108);
  });

  it("without Spoolman the app's spool is still charged and nothing is pushed", async () => {
    const material = (
      await app.inject({ method: "POST", url: "/api/filament-materials", payload: { name: "PLA" } })
    ).json();
    const mine = (
      await app.inject({
        method: "POST",
        url: "/api/filament/spools",
        payload: { materialId: material.id, colorHex: "#ff8800", initialGrams: 1000 },
      })
    ).json().id;
    await print("j1", 8);
    expect(appSpool(mine)?.remainingGrams).toBe(992);
    await app.spoolPush.run();
    expect(db.select().from(schema.spoolUsagePushes).all()).toEqual([]);
    expect(spoolman.calls).toEqual([]);
  });

  it("a re-import of the spools charges nothing more", async () => {
    const { id, vendor, mine } = await imported();
    await print("j1", 10);
    await app.spoolPush.run();
    expect((await sync(id, "spools")).json()).toMatchObject({ created: 0 });
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(110);
    expect(appSpool(mine)?.remainingGrams).toBe(890);
    expect(patches()).toHaveLength(1);
  });

  it("a spool linked later starts from its prints so far", async () => {
    const vendor = spoolman.addSpool({ colorHex: "ff8800", used: 50 });
    const material = (
      await app.inject({ method: "POST", url: "/api/filament-materials", payload: { name: "PLA" } })
    ).json();
    const mine = (
      await app.inject({
        method: "POST",
        url: "/api/filament/spools",
        payload: { materialId: material.id, colorHex: "#ff8800", initialGrams: 1000 },
      })
    ).json().id;
    await print("j1", 10);
    await addSpoolman();
    // Linked by the review ("this is that spool"), here straight in the table.
    db.insert(schema.spoolSources)
      .values({ spoolId: mine, library: "spoolman", source: `spoolman:${vendor.id}` })
      .run();
    await app.spoolPush.run();
    expect(patches()).toEqual([]);
    // Its next print is.
    await print("j2", 5, {}, 100);
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(55);
  });

  it("adds a spool of the app's that Spoolman doesn't have when a print uses it", async () => {
    await addSpoolman();
    const material = (
      await app.inject({ method: "POST", url: "/api/filament-materials", payload: { name: "PLA" } })
    ).json();
    const mine = (
      await app.inject({
        method: "POST",
        url: "/api/filament/spools",
        payload: { materialId: material.id, colorHex: "#ff8800", initialGrams: 1000 },
      })
    ).json().id;
    await print("j1", 10);
    await app.spoolPush.run();
    expect(spoolman.spools).toHaveLength(1);
    const made = spoolman.spools[0];
    // As the app's spool is now, print included: nothing more to write for it.
    expect(made).toMatchObject({ initial_weight: 1000, used_weight: 10 });
    expect(keysOf(mine)).toEqual([`spoolman:${made?.id}`]);
    await app.spoolPush.run();
    expect(patches()).toEqual([]);
    expect(spoolman.spools).toHaveLength(1);
  });

  it("only one Spoolman can be set up", async () => {
    await addSpoolman();
    const again = await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "spoolman", config: { host: "other:7912" } },
    });
    expect([again.statusCode, again.json().error.code]).toEqual([409, "integration_exists"]);
  });
});

// 6.0.0 Step 12b: one physical spool in two libraries is one spool, linked to both. The mock
// adapter's spools stand in for Bambu Cloud's filament manager.
describe("a spool in two libraries", () => {
  const cloudSpool = {
    spoolId: "c1",
    filament: { brand: "Bambu Lab", material: "PLA", name: "PLA Basic" },
    colorHex: "#ff8800",
    colorName: "Orange",
    initialGrams: 1000,
    remainingGrams: 900,
    emptyWeightGrams: null,
    status: "in_use" as const,
  };
  const reviewUrl = (id: string, waiting = false) =>
    `/api/import/integration/${id}/spools${waiting ? "?waiting=1" : ""}`;
  const openReview = async (id: string, waiting = false) =>
    (await app.inject({ method: "POST", url: reviewUrl(id, waiting) })).json() as ImportPreview;
  const appSpools = () => db.select().from(schema.spools).all();

  /** Imported from "Bambu Cloud"; Spoolman has the same roll under its own names. */
  async function inBoth() {
    state.spools = [cloudSpool];
    expect((await sync(mockId, "spools")).json()).toMatchObject({ created: 1 });
    const mine = appSpools()[0]?.id;
    const vendor = spoolman.addSpool({
      vendor: "Bambu",
      name: "Basic PLA",
      colorHex: "FF8800",
      used: 100,
    });
    const id = await addSpoolman();
    return { id, vendor, mine };
  }
  /** `inBoth`, with the Spoolman spool confirmed as that spool in its review. */
  async function linked() {
    const both = await inBoth();
    expect((await sync(both.id, "spools")).json()).toMatchObject({ created: 0, updated: 0 });
    const p = await openReview(both.id, true);
    expect(p.rows).toMatchObject([{ link: true, action: "update", targetId: both.mine }]);
    expect((await reviewer(() => app).confirm(p)).json()).toMatchObject({ updated: 1 });
    expect(keysOf(both.mine).sort()).toEqual(["mock:c1", `spoolman:${both.vendor.id}`]);
    return both;
  }

  it("matches it by material and colour, and waits for you to link it", async () => {
    const { id, mine } = await inBoth();
    expect((await sync(id, "spools")).json()).toMatchObject({ created: 0, updated: 0 });
    expect(await policy(id, "spools")).toMatchObject({ pending: 1 });
    expect(appSpools()).toHaveLength(1);
    // Your filament stays as Bambu Cloud named it.
    expect(appSpools()[0]).toMatchObject({ id: mine, name: "PLA Basic" });
  });

  it("isn't added to Spoolman while its link waits", async () => {
    const { id } = await inBoth();
    await sync(id, "spools");
    await print("j1", 10);
    await app.spoolPush.run();
    expect(spoolman.spools).toHaveLength(1);
    expect(patches()).toEqual([]);
  });

  it("once linked, each print is written to Spoolman exactly once", async () => {
    const { vendor, mine } = await linked();
    await print("j1", 5);
    expect(appSpool(mine)?.remainingGrams).toBe(895);
    await app.spoolPush.run();
    await app.spoolPush.run();
    await app.close();
    app = await build();
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(105);
    expect(patches()).toHaveLength(1);
  });

  it("a re-import from either library makes no second spool", async () => {
    const { id, mine } = await linked();
    expect((await sync(mockId, "spools")).json()).toMatchObject({ created: 0 });
    expect((await sync(id, "spools")).json()).toMatchObject({ created: 0 });
    expect((await openReview(id, true)).rows).toEqual([]);
    expect(appSpools().map((s) => s.id)).toEqual([mine]);
  });

  it("the other way round: from Spoolman first, then Bambu Cloud", async () => {
    const { mine } = await imported();
    state.spools = [cloudSpool];
    expect((await sync(mockId, "spools")).json()).toMatchObject({ created: 0 });
    const p = await openReview(mockId, true);
    expect(p.rows).toMatchObject([{ link: true, targetId: mine }]);
    await reviewer(() => app).confirm(p);
    expect(keysOf(mine)).toHaveLength(2);
    expect(appSpools()).toHaveLength(1);
  });

  it("unlinking Spoolman keeps Bambu Cloud, and Spoolman doesn't take it back", async () => {
    const { id, vendor, mine } = await linked();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/filament/spools/${mine}/sources/spoolman`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources).toMatchObject([{ library: "mock" }]);
    expect(keysOf(mine)).toEqual(["mock:c1"]);
    // Its Spoolman spool is no new spool and isn't linked again.
    expect((await sync(id, "spools")).json()).toMatchObject({ created: 0, updated: 0 });
    expect((await openReview(id)).rows).toMatchObject([
      { deleted: true, action: "skip", candidates: [] },
    ]);
    // Nor is it made in Spoolman again.
    await print("j1", 10);
    await app.spoolPush.run();
    expect(spoolman.spools).toHaveLength(1);
    expect(usedIn(vendor.id)).toBe(100);
    // Unlinking what isn't linked is a 404.
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/filament/spools/${mine}/sources/spoolman`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("deleting the spool remembers both libraries' spools", async () => {
    const { vendor, mine } = await linked();
    expect(
      (await app.inject({ method: "DELETE", url: `/api/filament/spools/${mine}` })).statusCode,
    ).toBe(204);
    expect(
      db
        .select()
        .from(schema.deletedSources)
        .all()
        .map((d) => d.source)
        .sort(),
    ).toEqual(["mock:c1", `spoolman:${vendor.id}`]);
    expect(db.select().from(schema.spoolSources).all()).toEqual([]);
  });
});

describe("one job from the tracker and from the history", () => {
  const historyOf = (externalId: string, startedAt: string) => ({
    externalId,
    printerExternalId: "mock-1",
    title: "benchy",
    startedAt,
    durationSec: 40,
    outcome: "success" as const,
    filaments: [{ ...slot, grams: 10 }],
  });

  it("the tracker's print takes the history's id: one print, charged once", async () => {
    const { vendor, mine } = await imported();
    // The printer gave the job no id yet: the tracker keys it by its start.
    await print(undefined, 10);
    expect(prints().map((p) => p.externalId)).toEqual([prints()[0]?.startedAt]);
    state.prints = [historyOf("000003", at(2))];
    expect((await sync(mockId, "prints")).statusCode).toBe(200);
    expect(prints().map((p) => p.externalId)).toEqual(["000003"]);
    expect(appSpool(mine)?.remainingGrams).toBe(890);
    await app.spoolPush.run();
    expect(usedIn(vendor.id)).toBe(110);
    // Known by its id from now on.
    expect((await sync(mockId, "prints")).json()).toMatchObject({ created: 0 });
    expect(prints()).toHaveLength(1);
  });

  it("the tracker's print after the history's is that print", async () => {
    state.prints = [historyOf("000003", at(-5))];
    await sync(mockId, "prints");
    await print(undefined, 10);
    expect(prints().map((p) => p.externalId)).toEqual(["000003"]);
  });

  it("two prints two minutes apart stay two", async () => {
    await print(undefined, 10);
    state.prints = [historyOf("000004", at(120))];
    await sync(mockId, "prints");
    expect(prints()).toHaveLength(2);
  });
});
