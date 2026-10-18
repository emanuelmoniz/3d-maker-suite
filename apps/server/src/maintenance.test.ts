import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";

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
      await post("/api/printers", { name: "P1", modelId: modelIdFor(db, "Bambu", "P1S") })
    ).json();
    const nozzle = (
      await post("/api/maintenance/types", { name: "Clean nozzle", intervalPrints: 10 })
    ).json();
    // Only for other models: must not show up for the P1S.
    await post("/api/maintenance/types", {
      name: "X1 only",
      intervalDays: 30,
      appliesToModelIds: [modelIdFor(db, "Bambu", "X1C")],
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

  describe("accessories", () => {
    const at = (day: number, h = 0) => new Date(Date.UTC(2026, 0, day, h)).toISOString();
    const printPart = (printerId: string, startedAt: string) => ({
      printerId,
      title: "t",
      outcome: "success" as const,
      startedAt,
      durationSec: 3600,
    });
    async function setup() {
      const model = modelIdFor(db, "Bambu", "P1S");
      const p1 = (await post("/api/printers", { name: "P1", modelId: model })).json();
      const p2 = (await post("/api/printers", { name: "P2", modelId: model })).json();
      const ams = (await post("/api/accessories", { name: "AMS", type: "AMS" })).json();
      // On P1 [day 1, day 5), then on P2 from day 10 (still on it).
      const install = (printerId: string, installedAt: string, removedAt?: string) =>
        post(`/api/accessories/${ams.id}/installs`, { printerId, installedAt, removedAt });
      expect((await install(p1.id, at(1), at(5))).statusCode).toBe(201);
      expect((await install(p2.id, at(10))).statusCode).toBe(201);
      return { p1, p2, ams };
    }
    const get = async (id: string) => (await app.inject(`/api/accessories/${id}`)).json();

    it("usage counts the printer's prints inside each install period", async () => {
      const { p1, p2, ams } = await setup();
      db.insert(schema.prints)
        .values([
          printPart(p1.id, at(1)), // on the install instant: counts
          printPart(p1.id, at(3)), // inside: counts
          printPart(p1.id, at(5)), // on the removal instant: not on it any more
          printPart(p1.id, at(12)), // P1 after removal: no
          printPart(p2.id, at(7)), // P2 before install: no
          printPart(p2.id, at(10)), // P2 from install: counts
          printPart(p2.id, at(20)), // open period: counts
        ])
        .run();
      expect(await get(ams.id)).toMatchObject({ prints: 4, runtimeSec: 4 * 3600 });
      const list = (await app.inject("/api/accessories?sort=prints")).json();
      expect(list.items[0]).toMatchObject({ id: ams.id, prints: 4 });
    });

    it("due follows the accessory's usage; logging resets it", async () => {
      const { p1, p2, ams } = await setup();
      const type = (
        await post("/api/maintenance/types", {
          name: "AMS rollers",
          target: "accessory",
          intervalPrints: 3,
          appliesToAccessoryTypes: ["AMS"],
        })
      ).json();
      const row = async () => (await due()).find((i: { typeId: string }) => i.typeId === type.id);
      // Not listed for the printers, only for the accessory.
      expect(await due()).toHaveLength(1);
      expect(await row()).toMatchObject({
        target: "accessory",
        targetId: ams.id,
        targetName: "01-AMS",
        remainingPrints: 3,
      });

      db.insert(schema.prints)
        .values([printPart(p1.id, at(2)), printPart(p1.id, at(3)), printPart(p2.id, at(11))])
        .run();
      expect(await row()).toMatchObject({ status: "overdue", remainingPrints: 0 });
      expect(await due(`?accessoryId=${ams.id}`)).toHaveLength(1);
      expect(await due(`?printerId=${p1.id}`)).toHaveLength(0);

      const wrong = await post("/api/maintenance/tasks", { printerId: p2.id, typeId: type.id });
      expect(wrong.json().error.code).toBe("wrong_target");
      const both = await post("/api/maintenance/tasks", {
        printerId: p2.id,
        accessoryId: ams.id,
        typeId: type.id,
      });
      expect(both.statusCode).toBe(400);

      const done = await post("/api/maintenance/tasks", { accessoryId: ams.id, typeId: type.id });
      expect(done.statusCode).toBe(201);
      expect(done.json()).toMatchObject({ printerId: null, printerPrintsAt: 3 });
      expect(await row()).toMatchObject({ status: "ok", remainingPrints: 3 });
      const history = (await app.inject(`/api/maintenance/tasks?accessoryId=${ams.id}`)).json();
      expect(history.total).toBe(1);
    });
  });

  it("archive type, unknown ids", async () => {
    const printer = (
      await post("/api/printers", { name: "P1", modelId: modelIdFor(db, "B", "M") })
    ).json();
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
