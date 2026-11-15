import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import type { PrinterSnapshot, PrinterStatus } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

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
