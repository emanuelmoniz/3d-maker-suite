import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJobTotals } from "@3d-maker-suite/3mf";
import { fixture, type MockState, mockAdapter, pushChange } from "@3d-maker-suite/adapter-mock";
import type { PrinterSnapshot, PrinterStatus } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { loadKey } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateAlerts } from "./alerts/evaluate.ts";
import { buildApp } from "./app.ts";
import { createSyncer } from "./integrations/sync.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let state: MockState;
let dataDir: string;
let integrationId: string;

const build = () => buildApp(db, false, dataDir, { adapters: [mockAdapter(state)] });

beforeEach(async () => {
  db = openDb(":memory:");
  state = { ...fixture(), status: [] };
  dataDir = mkdtempSync(join(tmpdir(), "printer-status-"));
  app = await build();
  integrationId = (
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "mock", secrets: { token: "t" } },
    })
  ).json().id;
  // Its printer first: status and prints are only kept for printers you have.
  await app.inject({
    method: "POST",
    url: `/api/integrations/${integrationId}/sync`,
    payload: { type: "printers" },
  });
  app.printerStatus.refresh();
});
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const at = (s: number) => new Date(Date.UTC(2026, 10, 15, 10, 0, s)).toISOString();
const snap = (s: number, over: Partial<PrinterSnapshot> = {}): PrinterSnapshot => ({
  printerExternalId: "mock-1",
  at: at(s),
  state: "printing",
  job: { id: "j1", file: "benchy.gcode", progress: 50 },
  slots: [{ slot: 0, material: "PLA", colorHex: "#ff8800", active: true, gramsUsed: 4 }],
  ...over,
});
/** Each snapshot read once, in order. */
async function reads(...snaps: PrinterSnapshot[][]) {
  for (const s of snaps) {
    state.status = s;
    await app.printerStatus.pollAll();
  }
}
const statuses = async (): Promise<PrinterStatus[]> =>
  (await app.inject("/api/printers/status")).json();
const tracked = () =>
  db.select().from(schema.prints).where(eq(schema.prints.externalId, "j1")).all();
const usagesOf = (printId: string) =>
  db
    .select()
    .from(schema.printFilamentUsages)
    .where(eq(schema.printFilamentUsages.printId, printId))
    .all();
const spool = async (colorHex: string) => {
  const material =
    (await app.inject("/api/filament-materials")).json().items[0] ??
    (
      await app.inject({ method: "POST", url: "/api/filament-materials", payload: { name: "PLA" } })
    ).json();
  return (
    await app.inject({
      method: "POST",
      url: "/api/filament/spools",
      payload: { materialId: material.id, colorHex, initialGrams: 1000 },
    })
  ).json();
};

describe("live status", () => {
  it("lists what each printer you have is doing, by your printer's id", async () => {
    await reads([snap(0), snap(0, { printerExternalId: "not-imported" })]);
    const printer = db.select().from(schema.printers).get();
    expect(await statuses()).toEqual([
      { printerId: printer?.id, integrationId, snapshot: snap(0) },
    ]);
  });

  it("a printer that stops answering, or a source that fails, is offline", async () => {
    await reads([snap(0)], []);
    expect((await statuses())[0]?.snapshot.state).toBe("offline");
    await reads([snap(10)]);
    state.fail = "unreachable";
    await app.printerStatus.pollAll();
    expect((await statuses())[0]?.snapshot).toMatchObject({ state: "offline", slots: [] });
  });

  it("a sync of the same source doesn't restart its status", async () => {
    await reads([snap(0)]);
    await app.inject({
      method: "POST",
      url: `/api/integrations/${integrationId}/sync`,
      payload: { type: "printers" },
    });
    app.printerStatus.refresh();
    await reads([]);
    expect((await statuses())[0]?.snapshot.state).toBe("offline");
  });

  it("a source switched off has no status any more", async () => {
    await reads([snap(0)]);
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${integrationId}`,
      payload: { policies: [{ type: "printerStatus", mode: "off" }] },
    });
    app.printerStatus.refresh();
    expect(await statuses()).toEqual([]);
  });
});

describe("a printer that pushes a change (Step 19c)", () => {
  it("is read at once, a burst once, and no more after it is switched off", async () => {
    state.push = new Set();
    app.printerStatus.refresh(); // unchanged setup: still the source made without push
    await app.close();
    app = await build();
    app.printerStatus.refresh();
    expect(state.push.size).toBe(1);
    state.status = [snap(0)];
    for (let i = 0; i < 5; i++) pushChange(state);
    await new Promise((r) => setTimeout(r, 50));
    expect((await statuses())[0]?.snapshot.state).toBe("printing");
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${integrationId}`,
      payload: { policies: [{ type: "printerStatus", mode: "off" }] },
    });
    app.printerStatus.refresh();
    expect(state.push.size).toBe(0);
  });
});

describe("monitoring (6.0.0 Step 18)", () => {
  it("a source that fails whole says so on its printers, also before it ever read one", async () => {
    state.fail = "auth_required";
    await app.printerStatus.pollAll();
    const [one] = await statuses();
    expect(one).toMatchObject({ failing: "refused", snapshot: { state: "offline" } });
    // Any other failure is not a wrong key.
    state.fail = "unreachable";
    await app.printerStatus.pollAll();
    expect((await statuses())[0]?.failing).toBe("other");
    // Read again: the flag goes.
    state.fail = undefined;
    await reads([snap(10)]);
    expect((await statuses())[0]?.failing).toBeUndefined();
  });

  it("a source that started and hasn't read yet is checking, not unmonitored", async () => {
    const [one] = await statuses();
    expect(one).toMatchObject({ pending: true, snapshot: { state: "offline" } });
    await reads([snap(0)]);
    expect((await statuses())[0]?.pending).toBeUndefined();
  });

  it("the connection names the source, its secrets and where it is reached from, never a value", async () => {
    const printer = db.select().from(schema.printers).get();
    const body = (await app.inject(`/api/printers/${printer?.id}/connection`)).json();
    expect(body.sources).toEqual([
      expect.objectContaining({
        integrationId,
        adapterId: "mock",
        enabled: true,
        deviceId: null,
        deviceName: null,
        host: null,
        secrets: ["token"],
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('"t"');
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${integrationId}`,
      payload: { enabled: false },
    });
    expect(
      (await app.inject(`/api/printers/${printer?.id}/connection`)).json().sources[0].enabled,
    ).toBe(false);
    expect(
      (await app.inject("/api/printers/00000000-0000-4000-8000-000000000000/connection"))
        .statusCode,
    ).toBe(404);
  });
});

describe("prints from the job tracker", () => {
  it("a print is written once, when it ends; a sure spool is charged", async () => {
    const orange = await spool("#ff8800");
    await reads([snap(0, { state: "idle", job: undefined })], [snap(10)]);
    expect(tracked()).toEqual([]);
    const end = snap(70, { state: "finished", job: { id: "j1" } });
    await reads([end], [end], [snap(80, { state: "idle", job: undefined })]);
    const [print] = tracked();
    expect(print).toMatchObject({
      origin: "integration",
      integrationId,
      title: "benchy",
      startedAt: at(10),
      durationSec: 60,
      outcome: "success",
    });
    expect(tracked()).toHaveLength(1);
    expect(usagesOf(print?.id ?? "")).toMatchObject([{ slot: 0, grams: 4, spoolId: orange.id }]);
  });

  it("is never held back: no project, no sure spool, its slot waits in Filament to review", async () => {
    // Two spools fit: a guess, so nobody's spool is charged; the oldest is only suggested.
    const oldest = await spool("#ff8800");
    await spool("#ff8800");
    await reads(
      [snap(0, { state: "idle", job: undefined })],
      [snap(10)],
      [snap(70, { state: "cancelled" })],
    );
    const [print] = tracked();
    expect(print).toMatchObject({ outcome: "cancelled", projectId: null, noProject: false });
    expect(usagesOf(print?.id ?? "")).toMatchObject([
      { spoolId: null, grams: 4, suggestedSpoolId: oldest.id, dismissed: false },
    ]);
  });

  it("its project is the one its title names", async () => {
    const project = db
      .insert(schema.projects)
      .values({
        number: 7,
        name: "Benchy",
        meta: { files: [{ path: "benchy.3mf", kind: "model", size: 1 }] },
      })
      .returning()
      .get();
    await reads(
      [snap(0, { state: "idle", job: undefined })],
      [snap(10)],
      [snap(70, { state: "finished" })],
    );
    expect(tracked()[0]?.projectId).toBe(project.id);
  });

  it("a restart during a print keeps the job: its start is when it was first seen", async () => {
    await reads([snap(0, { state: "idle", job: undefined })], [snap(10)]);
    await app.close();
    app = await build();
    app.printerStatus.refresh();
    await reads([snap(600, { state: "finished" })]);
    expect(tracked()[0]).toMatchObject({ startedAt: at(10), durationSec: 590 });
  });
});

describe("the spool loaded in a slot", () => {
  const printerId = () => db.select().from(schema.printers).get()?.id ?? "";
  const load = (slot: number, spoolId: string | null) =>
    app.inject({
      method: "PUT",
      url: `/api/printers/${printerId()}/slots`,
      payload: { slot, spoolId },
    });
  const placeOf = async (id: string) => {
    const s = (await app.inject(`/api/filament/spools/${id}`)).json();
    return [s.loadedPrinterId, s.loadedSlot];
  };
  const print = (material = "PLA") =>
    reads(
      [snap(0, { state: "idle", job: undefined })],
      [
        snap(10, {
          slots: [{ slot: 0, material, colorHex: "#ff8800", active: true, gramsUsed: 4 }],
        }),
      ],
      [snap(70, { state: "finished" })],
    );

  it("is set, moved, replaced and cleared; an archived spool leaves its slot", async () => {
    const [a, b] = [await spool("#ff8800"), await spool("#0000ff")];
    expect((await load(0, a.id)).statusCode).toBe(204);
    expect(await placeOf(a.id)).toEqual([printerId(), 0]);
    // Moved to another slot: one place at a time.
    await load(2, a.id);
    expect(await placeOf(a.id)).toEqual([printerId(), 2]);
    // Another spool in its slot takes it out.
    await load(2, b.id);
    expect(await placeOf(a.id)).toEqual([null, null]);
    await load(2, null);
    expect(await placeOf(b.id)).toEqual([null, null]);
    await load(1, b.id);
    await app.inject({
      method: "PATCH",
      url: `/api/filament/spools/${b.id}`,
      payload: { archived: true },
    });
    expect(await placeOf(b.id)).toEqual([null, null]);
    expect((await load(1, b.id)).statusCode).toBe(400);
  });

  it("a print on that slot charges it, though another spool of its colour fits too", async () => {
    const [, loaded] = [await spool("#ff8800"), await spool("#ff8800")];
    await load(0, loaded.id);
    // Loaded before the print ended.
    db.update(schema.spools)
      .set({ loadedAt: at(30) })
      .where(eq(schema.spools.id, loaded.id))
      .run();
    await print();
    expect(usagesOf(tracked()[0]?.id ?? "")).toMatchObject([{ spoolId: loaded.id, grams: 4 }]);
  });

  it("isn't charged for a print that ended before it was loaded", async () => {
    const [, loaded] = [await spool("#ff8800"), await spool("#ff8800")];
    await load(0, loaded.id);
    await print();
    // Loaded now, after the print: two spools fit, a guess.
    expect(usagesOf(tracked()[0]?.id ?? "")).toMatchObject([{ spoolId: null }]);
  });

  it("a PLA spool on a slot the printer reports as PETG waits for review, after a sync too", async () => {
    const loaded = await spool("#ff8800");
    const petg = (
      await app.inject({
        method: "POST",
        url: "/api/filament-materials",
        payload: { name: "PETG" },
      })
    ).json();
    // A PETG spool of the colour would be a sure match; the loaded spool says otherwise.
    await app.inject({
      method: "POST",
      url: "/api/filament/spools",
      payload: { materialId: petg.id, colorHex: "#ff8800", initialGrams: 1000 },
    });
    await load(0, loaded.id);
    db.update(schema.spools)
      .set({ loadedAt: at(0) })
      .where(eq(schema.spools.id, loaded.id))
      .run();
    await print("PETG");
    const id = tracked()[0]?.id ?? "";
    // The loaded spool is only the suggestion.
    const waits = { spoolId: null, material: "PETG", suggestedSpoolId: loaded.id };
    expect(usagesOf(id)).toMatchObject([waits]);
    // A prints sync matches what waits again: still nothing charged for this slot.
    await app.inject({
      method: "POST",
      url: `/api/integrations/${integrationId}/sync`,
      payload: { type: "prints" },
    });
    expect(usagesOf(id)).toMatchObject([waits]);
  });
});

describe("spools loaded by the printer (Step 19b)", () => {
  const printerId = () => db.select().from(schema.printers).get()?.id ?? "";
  const load = (slot: number, spoolId: string | null) =>
    app.inject({
      method: "PUT",
      url: `/api/printers/${printerId()}/slots`,
      payload: { slot, spoolId },
    });
  const row = (id: string) => db.select().from(schema.spools).where(eq(schema.spools.id, id)).get();
  const placeOf = (id: string) => {
    const s = row(id);
    return [s?.loadedSlot ?? null, s?.loadedBy ?? null];
  };
  type Tray = PrinterSnapshot["slots"][number];
  const tray = (slot: number, over: Partial<Tray> = {}): Tray => ({
    slot,
    material: "PLA",
    colorHex: "#ff8800",
    ...over,
  });
  /** An idle printer that reads its trays (Bambu LAN). */
  const trays = (...slots: Tray[]) =>
    reads([snap(0, { state: "idle", job: undefined, slots, physicalSlots: true })]);
  const tag = (id: string, rfid: string) =>
    db.update(schema.spools).set({ rfid }).where(eq(schema.spools.id, id)).run();

  it("the only spool that fits is loaded with no click, and the status says so", async () => {
    const a = await spool("#ff8800");
    await spool("#0000ff");
    await trays(tray(0));
    expect(placeOf(a.id)).toEqual([0, "printer"]);
    expect((await statuses())[0]?.loaded).toEqual([{ slot: 0, spoolId: a.id, by: "printer" }]);
    expect((await app.inject(`/api/filament/spools/${a.id}`)).json().loadedBy).toBe("printer");
  });

  it("the back spool (254) is loaded, by the printer or by hand", async () => {
    const a = await spool("#ff8800");
    await trays(tray(254));
    expect(placeOf(a.id)).toEqual([254, "printer"]);
    expect((await load(254, null)).statusCode).toBe(204);
    expect((await load(254, a.id)).statusCode).toBe(204);
    expect(placeOf(a.id)).toEqual([254, "user"]);
    expect((await load(256, a.id)).statusCode).toBe(400);
  });

  it("several fit: a suggestion one click accepts, as yours", async () => {
    const [a, b] = [await spool("#ff8800"), await spool("#ff8800")];
    await trays(tray(0));
    expect(placeOf(a.id)).toEqual([null, null]);
    const [s] = await statuses();
    expect(s?.suggestions).toHaveLength(1);
    const idea = s?.suggestions?.[0]?.spoolId ?? "";
    expect([a.id, b.id]).toContain(idea);
    await load(0, idea);
    expect(placeOf(idea)).toEqual([0, "user"]);
    expect((await statuses())[0]?.suggestions).toBeUndefined();
  });

  it("a spool set by hand is replaced only by a tag, from wherever the tagged one is", async () => {
    const [mine, tagged] = [await spool("#0000ff"), await spool("#ff8800")];
    await load(0, mine.id);
    await load(1, tagged.id);
    // Another colour, no tag: yours stays.
    await trays(tray(0), tray(1, { colorHex: "#00ff00" }));
    expect(placeOf(mine.id)).toEqual([0, "user"]);
    tag(tagged.id, "T1");
    await trays(tray(0, { rfid: "T1" }));
    expect(placeOf(tagged.id)).toEqual([0, "printer"]);
    expect(placeOf(mine.id)).toEqual([null, null]);
  });

  it("an emptied tray unloads only a spool the printer loaded", async () => {
    const [a, mine] = [await spool("#ff8800"), await spool("#0000ff")];
    await trays(tray(0));
    await load(1, mine.id);
    await trays();
    expect(placeOf(a.id)).toEqual([null, null]);
    expect(placeOf(mine.id)).toEqual([1, "user"]);
  });

  it("a slot you empty stays empty until the printer reads something else there", async () => {
    const a = await spool("#ff8800");
    await trays(tray(0));
    await load(0, null);
    await trays(tray(0, { colorHex: "#ff8800" }));
    expect(placeOf(a.id)).toEqual([null, null]);
    await trays();
    await trays(tray(0));
    expect(placeOf(a.id)).toEqual([0, "printer"]);
  });

  it("a job file's colours (Moonraker) load nothing; its Spoolman spool does", async () => {
    const a = await spool("#ff8800");
    await reads([snap(0, { slots: [tray(0)] })]);
    expect(placeOf(a.id)).toEqual([null, null]);
    db.insert(schema.spoolSources)
      .values({ spoolId: a.id, library: "spoolman", source: "spoolman:9" })
      .run();
    await reads([snap(10, { slots: [tray(0, { spoolId: "spoolman:9" })] })]);
    expect(placeOf(a.id)).toEqual([0, "printer"]);
  });
});

describe("printer alerts", () => {
  // The setup sync raised its own.
  const mine = () =>
    db
      .select()
      .from(schema.alerts)
      .all()
      .filter((a) => a.kind.startsWith("print"));
  const alertKinds = () => mine().map((a) => a.kind);
  const idle = snap(0, { state: "idle", job: undefined });

  it("a finished print raises print_finished once, a failed one print_failed", async () => {
    const end = snap(70, { state: "finished" });
    await reads([idle], [snap(10)], [end], [end], [snap(80, { state: "idle", job: undefined })]);
    expect(alertKinds()).toEqual(["print_finished"]);
    const [alert] = mine();
    expect(alert).toMatchObject({
      severity: "success",
      entityType: "print",
      entityId: tracked()[0]?.id,
    });

    const fail = (id: string) => snap(70, { state: "error", job: { id, failureReason: "clog" } });
    await reads([snap(90, { job: { id: "j2", file: "b.gcode" } })], [fail("j2")]);
    expect(alertKinds()).toEqual(["print_finished", "print_failed"]);
  });

  it("a cancelled print raises none", async () => {
    await reads([idle], [snap(10)], [snap(70, { state: "cancelled" })]);
    expect(tracked()).toHaveLength(1);
    expect(alertKinds()).toEqual([]);
  });

  it("a printer silent during a print is offline after the threshold, and back when it answers", async () => {
    await reads([idle], [snap(10)], []);
    const printer = db.select().from(schema.printers).get();
    expect(app.printerStatus.offline()).toEqual([]);
    expect(app.printerStatus.offline(Date.now() + 3 * 60_000)).toEqual([
      { printerId: printer?.id, reason: "printer" },
    ]);
    await reads([snap(100)]);
    expect(app.printerStatus.offline(Date.now() + 3 * 60_000)).toEqual([]);
  });

  it("a printer off while idle is never offline", async () => {
    await reads([idle], []);
    expect(app.printerStatus.offline(Date.now() + 3_600_000)).toEqual([]);
  });

  it("evaluate raises printer_offline for the printers given and resolves it when they answer", async () => {
    const printer = db.select().from(schema.printers).get();
    const log = { warn: () => {} };
    const key = Buffer.alloc(32);
    const printerId = printer?.id ?? "";
    await evaluateAlerts(db, key, log, undefined, undefined, [{ printerId, reason: "printer" }]);
    expect(mine()).toMatchObject([
      { kind: "printer_offline", severity: "warning", entityId: printer?.id, resolvedAt: null },
    ]);
    await evaluateAlerts(db, key, log, undefined, undefined, []);
    expect(mine()[0]?.resolvedAt).not.toBeNull();
  });

  it("evaluate raises printer_unreachable, naming the connector, when the connector went away", async () => {
    const printerId = db.select().from(schema.printers).get()?.id ?? "";
    const log = { warn: () => {} };
    const key = Buffer.alloc(32);
    const silent = [{ printerId, reason: "connector" as const, device: "WS-3" }];
    await evaluateAlerts(db, key, log, undefined, undefined, silent);
    expect(mine()).toMatchObject([
      { kind: "printer_unreachable", context: { device: "WS-3" }, resolvedAt: null },
    ]);
    await evaluateAlerts(db, key, log, undefined, undefined, []);
    expect(mine()[0]?.resolvedAt).not.toBeNull();
  });
});

it("sends every printer's status over SSE, again when one changes", async () => {
  await reads([snap(0)]);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/api/printers/status/events`);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const next = async () => {
    const text = new TextDecoder().decode((await reader.read()).value);
    return JSON.parse(text.replace(/^data: /, "")) as PrinterStatus[];
  };
  expect((await next())[0]?.snapshot.state).toBe("printing");
  // A newer read time alone is no change.
  await reads([snap(5)], [snap(6, { state: "paused" })]);
  expect((await next())[0]?.snapshot).toMatchObject({ state: "paused", at: at(6) });
  await reader.cancel();
});

describe("grams the printer didn't report (ADR-0015)", () => {
  const job = (name: string) =>
    new Uint8Array(
      readFileSync(new URL(`../../../packages/3mf/fixtures/job-headers/${name}`, import.meta.url)),
    );
  const record = (
    outcome: "success" | "cancelled",
    progress: { layer?: number; totalLayers?: number; progress?: number },
    file?: Awaited<ReturnType<typeof readJobTotals>>,
    title = "benchy",
    plate?: number,
  ) => {
    const syncer = createSyncer(db, [mockAdapter(state)], loadKey(dataDir), app.log, dataDir);
    syncer.recordPrint(
      integrationId,
      {
        print: {
          externalId: "j9",
          printerExternalId: "mock-1",
          title,
          ...(plate && { plate }),
          startedAt: at(0),
          outcome,
          filaments: [{ slot: 0, material: "PLA", colorHex: "#ff8800" }],
        },
        partial: false,
        endSeen: true,
        job: progress,
      },
      file,
    );
    const [print] = db.select().from(schema.prints).where(eq(schema.prints.externalId, "j9")).all();
    return usagesOf(print?.id ?? "");
  };

  it("a file's totals from the fixtures; none for a slicer that wrote none", async () => {
    for (const [name, grams] of [
      ["orcaslicer-klipper.gcode", 0.99],
      ["prusaslicer-klipper.gcode", 1.2],
      ["prusaslicer.bgcode", 1.2],
    ] as const) {
      const [u] = record("success", {}, await readJobTotals(job(name)), `t-${name}`);
      expect(u).toMatchObject({ grams, gramsSource: "file", gramsEstimated: false });
      db.delete(schema.printFilamentUsages).run();
      db.delete(schema.prints).run();
    }
  });

  it("a print cancelled on layer 6 of 45 at 40% gets 6/45 of the file's grams, estimated", async () => {
    const totals = [{ slot: 0, grams: 4.35 }];
    const [u] = record("cancelled", { layer: 6, totalLayers: 45, progress: 40 }, totals);
    expect(u).toMatchObject({ grams: 0.58, gramsSource: "file", gramsEstimated: true });
  });

  it("the project plate answers when there is no file, and says it is the plate", async () => {
    const project = db
      .insert(schema.projects)
      .values({
        number: 7,
        name: "Benchy",
        meta: { files: [{ path: "benchy.3mf", kind: "model", size: 1 }] },
      })
      .returning()
      .get();
    db.insert(schema.projectSlicePlates)
      .values({
        projectId: project.id,
        file: "benchy.3mf",
        plate: 1,
        fileSize: 1,
        fileMtimeMs: 1,
        fileSha256: "x",
        slicedFilaments: [{ slot: 1, grams: 8, material: "PLA" }],
      })
      .run();
    const [u] = record("cancelled", { layer: 15, totalLayers: 30 });
    expect(u).toMatchObject({ grams: 4, gramsSource: "plate", gramsEstimated: true });
  });

  it("nothing to go on: the slot waits in Filament to review at 0 g, never booked", async () => {
    const s = await spool("#ff8800");
    expect(record("success", {})).toMatchObject([
      { spoolId: null, grams: 0, slot: 0, gramsSource: null, suggestedSpoolId: s.id },
    ]);
  });

  it("a source with no print history keeps its level and tracking on its live status policy", async () => {
    const s = await spool("#ff8800");
    const patch = (policies: object[]) =>
      app.inject({
        method: "PATCH",
        url: `/api/integrations/${integrationId}`,
        payload: { policies },
      });
    // Its print history settings would say otherwise: a status-only source has none to read.
    expect((await patch([{ type: "prints", reviewPolicy: "never" }])).statusCode).toBe(200);
    const live = await patch([
      { type: "printerStatus", reviewPolicy: "always", trackUsage: false },
    ]);
    expect(live.statusCode).toBe(200);
    expect(
      live.json().policies.find((p: { type: string }) => p.type === "printerStatus"),
    ).toMatchObject({ reviewPolicy: "always", trackUsage: false });

    // PrusaLink, OctoPrint: live status, no print history.
    const statusOnly = {
      ...mockAdapter(state),
      capabilities: ["printers", "printerStatus"] as const,
    };
    const syncer = createSyncer(db, [statusOnly], loadKey(dataDir), app.log, dataDir);
    // Each its own start: one printer, two starts within a minute are one print (the dedupe).
    const print = (externalId: string, startedAt: string) =>
      syncer.recordPrint(integrationId, {
        print: {
          externalId,
          printerExternalId: "mock-1",
          title: "benchy",
          startedAt,
          outcome: "success",
          filaments: [{ slot: 0, material: "PLA", colorHex: "#ff8800", grams: 5 }],
        },
        partial: false,
        endSeen: true,
        job: {},
      });
    const usage = (externalId: string) => {
      const [p] = db
        .select()
        .from(schema.prints)
        .where(eq(schema.prints.externalId, externalId))
        .all();
      return usagesOf(p?.id ?? "");
    };
    // `always`: the sure spool is only suggested.
    expect(print("s1", at(0))).toBe(true);
    expect(usage("s1")).toMatchObject([{ spoolId: null, suggestedSpoolId: s.id }]);
    // `never` with tracking off: linked, nothing taken from the spool.
    await patch([{ type: "printerStatus", reviewPolicy: "never" }]);
    expect(print("s2", new Date(Date.UTC(2026, 10, 15, 11)).toISOString())).toBe(true);
    expect(usage("s2")).toMatchObject([{ spoolId: s.id, grams: 5 }]);
    const left = (await app.inject(`/api/filament/spools/${s.id}`)).json().remainingGrams;
    expect(left).toBe(1000);
  });

  it("estimated grams wait with the spool suggested; under the printer's `never` they are charged", async () => {
    const s = await spool("#ff8800");
    const totals = [{ slot: 0, grams: 4.35 }];
    const cut = { layer: 6, totalLayers: 45, progress: 40 };
    expect(record("cancelled", cut, totals)).toMatchObject([
      { spoolId: null, suggestedSpoolId: s.id, gramsEstimated: true, dismissed: false },
    ]);
    db.delete(schema.printFilamentUsages).run();
    db.delete(schema.prints).run();
    db.update(schema.printers).set({ reviewPolicy: "never" }).run();
    expect(record("cancelled", cut, totals)).toMatchObject([
      { spoolId: s.id, suggestedSpoolId: null, gramsEstimated: true },
    ]);
  });
});

describe("one printer, two sources (ADR-0015: Bambu Cloud and Bambu LAN)", () => {
  /** A second source of the same printer (same serial), its printers synced. */
  const second = async () => {
    const id = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "mock", secrets: { token: "t" } },
      })
    ).json().id as string;
    await app.inject({
      method: "POST",
      url: `/api/integrations/${id}/sync`,
      payload: { type: "printers" },
    });
    return id;
  };
  const syncer = () => createSyncer(db, [mockAdapter(state)], loadKey(dataDir), app.log, dataDir);
  /** A print the second source's job tracker saw end. */
  const lan = (id: string, externalId: string, startedAt: string, peerId?: string) =>
    syncer().recordPrint(id, {
      print: {
        externalId,
        ...(peerId && { peerId }),
        printerExternalId: "mock-1",
        title: "benchy",
        startedAt,
        outcome: "success",
        filaments: [{ slot: 0, material: "PLA", colorHex: "#ff8800", grams: 4 }],
      },
      partial: false,
      endSeen: true,
      job: {},
    });
  const syncPrints = (id: string) =>
    app.inject({
      method: "POST",
      url: `/api/integrations/${id}/sync`,
      payload: { type: "prints" },
    });
  const printsOf = () => db.select().from(schema.prints).all();

  it("the second source of a serial is linked to the printer, not imported again", async () => {
    const lanId = await second();
    expect(db.select().from(schema.printers).all()).toHaveLength(1);
    const [printer] = db.select().from(schema.printers).all();
    expect(db.select().from(schema.printerSources).all()).toMatchObject([
      { printerId: printer?.id, integrationId: lanId, externalId: "mock-1" },
    ]);
    // Synced again: still linked, nothing new to import.
    await second();
    expect(db.select().from(schema.printers).all()).toHaveLength(1);
    // Its status shows on that printer.
    app.printerStatus.refresh();
    await reads([snap(0)]);
    expect((await statuses()).map((s) => [s.printerId, s.integrationId])).toContainEqual([
      printer?.id,
      lanId,
    ]);
  });

  it("each print once: the live one names the cloud's task id, whichever comes first", async () => {
    const lanId = await second();
    // The LAN saw job-1 end first and names the cloud's id. It joined half-way, so its start is
    // minutes off: only the id can tell.
    const job1 = state.prints[0];
    if (!job1) throw new Error("fixture");
    const late = new Date(Date.parse(job1.startedAt) + 300_000).toISOString();
    expect(lan(lanId, "100000001", late, job1.externalId)).toBe(true);
    await syncPrints(integrationId);
    expect(
      printsOf()
        .map((p) => p.externalId)
        .sort(),
    ).toEqual(["100000001", "job-2", "job-3"]);
    // The cloud had job-3 already: the LAN's copy isn't written.
    const job3 = state.prints[2];
    expect(lan(lanId, "100000003", job3?.startedAt ?? "", job3?.externalId)).toBe(false);
    expect(printsOf()).toHaveLength(3);
  });

  it("a print neither names is the same print when they started within a minute", async () => {
    const lanId = await second();
    const job2 = state.prints[1];
    const near = new Date(Date.parse(job2?.startedAt ?? "") - 50_000).toISOString();
    const far = new Date(Date.parse(job2?.startedAt ?? "") - 70_000).toISOString();
    await syncPrints(integrationId);
    expect(lan(lanId, "local-1", near)).toBe(false);
    expect(lan(lanId, "local-2", far)).toBe(true);
  });

  it("both sources watching the same print record it once", async () => {
    await second();
    app.printerStatus.refresh();
    const end = snap(70, { state: "finished", job: { id: "j1" } });
    await reads([snap(10)], [end], [snap(80, { state: "idle", job: undefined })]);
    expect(tracked()).toHaveLength(1);
  });
});

describe("a spool's tag (Bambu AMS RFID)", () => {
  const record = (externalId: string, rfid: string, startedAt = at(0)) =>
    createSyncer(db, [mockAdapter(state)], loadKey(dataDir), app.log, dataDir).recordPrint(
      integrationId,
      {
        print: {
          externalId,
          printerExternalId: "mock-1",
          title: "benchy",
          startedAt,
          outcome: "success",
          filaments: [{ slot: 2, material: "PLA", colorHex: "#ff8800", grams: 5, rfid }],
        },
        partial: false,
        endSeen: true,
        job: {},
      },
    );
  const printUsages = (externalId: string) =>
    usagesOf(
      db.select().from(schema.prints).where(eq(schema.prints.externalId, externalId)).get()?.id ??
        "",
    );
  const tagOf = (id: string) =>
    db.select().from(schema.spools).where(eq(schema.spools.id, id)).get()?.rfid;

  it("is learned by the spool a sure match charged; that spool is then sure among look-alikes", async () => {
    const first = await spool("#ff8800");
    record("p1", "TAG-A");
    expect(printUsages("p1")).toMatchObject([{ spoolId: first.id, rfid: "TAG-A" }]);
    expect(tagOf(first.id)).toBe("TAG-A");
    // A second orange spool: colour alone is a guess now, the tag isn't.
    await spool("#ff8800");
    record("p2", "TAG-A", at(100));
    expect(printUsages("p2")).toMatchObject([{ spoolId: first.id }]);
  });

  it("a slot waiting for review gives its tag to the spool a person picks", async () => {
    const a = await spool("#ff8800");
    const b = await spool("#ff8800");
    record("p1", "TAG-B");
    const [waiting] = printUsages("p1");
    expect(waiting).toMatchObject({ spoolId: null, rfid: "TAG-B" });
    const res = await app.inject({
      method: "POST",
      url: `/api/prints/filament-review/${waiting?.id}/assign`,
      payload: { spoolId: b.id },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(tagOf(b.id)).toBe("TAG-B");
    expect(tagOf(a.id)).toBeNull();
    record("p2", "TAG-B", at(100));
    expect(printUsages("p2")).toMatchObject([{ spoolId: b.id }]);
  });

  it("can be forgotten on the spool; the next charge teaches it again", async () => {
    const a = await spool("#ff8800");
    record("p1", "TAG-C");
    expect(tagOf(a.id)).toBe("TAG-C");
    const res = await app.inject({ method: "DELETE", url: `/api/filament/spools/${a.id}/rfid` });
    expect(res.json()).toMatchObject({ id: a.id, rfid: null });
    expect(tagOf(a.id)).toBeNull();
    record("p2", "TAG-C", at(100));
    expect(tagOf(a.id)).toBe("TAG-C");
  });
});
