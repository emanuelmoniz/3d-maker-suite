import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
});

const post = async (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, payload });

const due = async (q = "") => (await app.inject(`/api/maintenance/due${q}`)).json();

describe("maintenance", () => {
  it("due dates move with prints and with logged maintenance", async () => {
    const printer = (
      await post("/api/printers", { name: "P1", brand: "Bambu", model: "P1S" })
    ).json();
    const nozzle = (
      await post("/api/maintenance/types", { name: "Clean nozzle", intervalPrints: 10 })
    ).json();
    // Only for other models: must not show up for the P1S.
    await post("/api/maintenance/types", {
      name: "X1 only",
      intervalDays: 30,
      appliesToModel: "X1C",
    });

    const row = async () => (await due()).find((i: { typeId: string }) => i.typeId === nozzle.id);
    expect(await due()).toHaveLength(1);
    expect(await row()).toMatchObject({ status: "ok", remainingPrints: 10, lastDoneAt: null });

    db.insert(schema.prints)
      .values(
        Array.from({ length: 9 }, () => ({
          printerId: printer.id,
          title: "t",
          outcome: "success" as const,
          startedAt: "2026-01-01T00:00:00.000Z",
          durationSec: 600,
        })),
      )
      .run();
    expect(await row()).toMatchObject({ status: "upcoming", remainingPrints: 1 });
    expect(await due("?attention=true")).toHaveLength(1);

    const done = await post("/api/maintenance/tasks", {
      printerId: printer.id,
      typeId: nozzle.id,
      cost: 500,
      notes: "new nozzle",
    });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ printerPrintsAt: 9, printerRuntimeSecAt: 5400, cost: 500 });
    expect(await row()).toMatchObject({ status: "ok", remainingPrints: 10 });
    expect(await due("?attention=true")).toHaveLength(0);

    const history = (await app.inject(`/api/maintenance/tasks?printerId=${printer.id}`)).json();
    expect(history.total).toBe(1);
  });

  it("archive type, unknown ids", async () => {
    const printer = (await post("/api/printers", { name: "P1", brand: "B", model: "M" })).json();
    const type = (await post("/api/maintenance/types", { name: "T", intervalDays: 7 })).json();
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/maintenance/types/${type.id}`,
      payload: { archived: true },
    });
    expect(patch.json().archivedAt).not.toBeNull();
    expect(await due()).toHaveLength(0);
    const log = await post("/api/maintenance/tasks", { printerId: printer.id, typeId: type.id });
    expect(log.statusCode).toBe(400);
    const missing = await post("/api/maintenance/tasks", {
      printerId: crypto.randomUUID(),
      typeId: type.id,
    });
    expect(missing.statusCode).toBe(404);
  });
});
