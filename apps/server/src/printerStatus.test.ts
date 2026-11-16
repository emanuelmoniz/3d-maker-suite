import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJobTotals } from "@3d-maker-suite/3mf";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
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
    // Two spools fit: a guess, so nobody's spool is charged.
    await spool("#ff8800");
    await spool("#ff8800");
    await reads(
      [snap(0, { state: "idle", job: undefined })],
      [snap(10)],
      [snap(70, { state: "cancelled" })],
    );
    const [print] = tracked();
    expect(print).toMatchObject({ outcome: "cancelled", projectId: null, noProject: false });
    expect(usagesOf(print?.id ?? "")).toMatchObject([{ spoolId: null, grams: 4 }]);
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
    expect(app.printerStatus.offline(Date.now() + 3 * 60_000)).toEqual([printer?.id]);
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
    await evaluateAlerts(db, key, log, undefined, undefined, [printer?.id ?? ""]);
    expect(mine()).toMatchObject([
      { kind: "printer_offline", severity: "warning", entityId: printer?.id, resolvedAt: null },
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
    await spool("#ff8800");
    expect(record("success", {})).toMatchObject([
      { spoolId: null, grams: 0, slot: 0, gramsSource: null },
    ]);
  });
});
