import { openDb } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
});

const send = (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });

describe("costs", () => {
  it("breaks a print down into material, energy and wear", async () => {
    await send("PATCH", "/api/preferences", {
      energyCostPerKwh: 0.3,
      printerLifetimeHours: 1000,
    });
    const printer = (
      await send("POST", "/api/printers", {
        name: "P1S",
        modelId: modelIdFor(db, "Bambu Lab", "P1S"),
        powerW: 200,
        purchasePrice: 50000,
      })
    ).json();
    const material = (await send("POST", "/api/filament-materials", { name: "PLA" })).json();
    const profile = (
      await send("POST", "/api/filament/profiles", {
        materialId: material.id,
        densityGcm3: 1.24,
        pricePerKg: 2000,
      })
    ).json();
    const priced = (
      await send("POST", "/api/filament/spools", { profileId: profile.id, initialGrams: 1000 })
    ).json();
    // Paid 15.00 for 500 g: 3000 per kg, beats the profile's 2000.
    const paid = (
      await send("POST", "/api/filament/spools", {
        profileId: profile.id,
        initialGrams: 500,
        pricePaid: 1500,
      })
    ).json();
    const print = (
      await send("POST", "/api/prints", {
        printerId: printer.id,
        title: "Benchy",
        startedAt: "2026-01-01T10:00:00.000Z",
        durationSec: 7200,
        outcome: "success",
        usages: [
          { spoolId: priced.id, grams: 100 },
          { spoolId: paid.id, grams: 50 },
        ],
      })
    ).json();
    // material 200 + 150, energy 0.4 kWh * 30, wear 2 h * 50000/1000
    expect(print.cost).toEqual({
      material: 350,
      energy: 12,
      wear: 100,
      maintenance: 0,
      total: 462,
      unpricedGrams: 0,
    });
    const list = (await app.inject("/api/prints")).json();
    expect(list.items[0].cost.total).toBe(462);

    const ctx = (await app.inject("/api/costs/context")).json();
    expect(ctx.rates.energyPerKwh).toBe(30);
    expect(ctx.printers[0]).toMatchObject({ id: printer.id, wearPerHour: 50 });
    expect(ctx.materialPrices).toEqual({ PLA: 2000 });
  });

  it("device settings override the defaults; accessories count inside their install periods", async () => {
    await send("PATCH", "/api/preferences", {
      printerLifetimeHours: 1000,
      accessoryLifetimeHours: 100,
    });
    // 50000 over its own 500 h, not the default 1000: 100 per hour.
    const printer = (
      await send("POST", "/api/printers", {
        name: "P1S",
        modelId: modelIdFor(db, "Bambu Lab", "P1S"),
        purchasePrice: 50000,
        lifetimeHours: 500,
      })
    ).json();
    const accessory = async (body: object) =>
      (await send("POST", "/api/accessories", { type: "AMS", ...body })).json();
    const install = (a: { id: string }, installedAt: string, removedAt?: string) =>
      send("POST", `/api/accessories/${a.id}/installs`, {
        printerId: printer.id,
        installedAt,
        removedAt,
      });
    const ams = await accessory({ name: "AMS", purchasePrice: 10000 }); // default 100 h: 100/h
    const lid = await accessory({ name: "Lid", purchasePrice: 10000, countInCosts: false });
    const hotend = await accessory({ name: "Hotend", purchasePrice: 20000, lifetimeHours: 1000 });
    await install(lid, "2026-01-01T00:00:00.000Z");
    await install(ams, "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
    await install(hotend, "2026-03-01T00:00:00.000Z"); // 20/h, still on

    const wear = async (startedAt: string) =>
      (
        await send("POST", "/api/prints", {
          printerId: printer.id,
          title: startedAt,
          startedAt,
          durationSec: 3600,
          outcome: "success",
          usages: [],
        })
      ).json().cost.wear;
    expect(await wear("2026-01-15T00:00:00.000Z")).toBe(100); // lid not counted
    expect(await wear("2026-02-15T00:00:00.000Z")).toBe(200); // + AMS
    expect(await wear("2026-03-01T00:00:00.000Z")).toBe(120); // AMS off that day, hotend on

    const ctx = async () => (await app.inject("/api/costs/context")).json().printers[0];
    expect(await ctx()).toMatchObject({ wearPerHour: 120 });
    // Back to the defaults: printer 50/h, and the lid counts (100/h).
    await send("PATCH", `/api/printers/${printer.id}`, { lifetimeHours: null });
    await send("PATCH", `/api/accessories/${lid.id}`, { countInCosts: null });
    expect(await ctx()).toMatchObject({ wearPerHour: 170 });
    // Printers left out of costs: only the accessories remain, and stats still count every print.
    await send("PATCH", "/api/preferences", { printerCountInCosts: false });
    expect(await ctx()).toMatchObject({ wearPerHour: 120 });
    const stats = (await app.inject("/api/stats")).json();
    // Jan: lid; Feb: lid + AMS; Mar: lid + hotend.
    expect(stats.totals).toMatchObject({ prints: 3, wear: 100 + 200 + 120 });
    // The printer's own setting beats the default: back in at 50/h.
    await send("PATCH", `/api/printers/${printer.id}`, { countInCosts: true });
    expect(await ctx()).toMatchObject({ wearPerHour: 170 });
  });

  it("saves, numbers, lists, patches and deletes quotes", async () => {
    const body = {
      name: "Vase x3",
      form: { grams: 120 },
      cost: { material: 1, energy: 1, wear: 0, maintenance: 0, total: 2, unpricedGrams: 0 },
      quote: {
        unitCost: 2,
        labor: 0,
        failureMargin: 0,
        subtotal: 2,
        markup: 0,
        unitPrice: 2,
        quantity: 3,
        total: 6,
      },
    };
    const list = async (q = "") => (await app.inject(`/api/costs/quotes${q}`)).json();
    const res = await send("POST", "/api/costs/quotes", { ...body, notes: "  " });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ number: 1, notes: null, clientId: null });
    expect((await list()).total).toBe(1);
    expect(
      (await send("POST", "/api/costs/quotes", { ...body, projectId: crypto.randomUUID() }))
        .statusCode,
    ).toBe(400);
    expect(
      (await send("POST", "/api/costs/quotes", { ...body, clientId: crypto.randomUUID() }))
        .statusCode,
    ).toBe(400);
    const taken = await send("POST", "/api/costs/quotes", { ...body, number: 1 });
    expect([taken.statusCode, taken.json().error.code]).toEqual([409, "quote_number_taken"]);

    const client = (await send("POST", "/api/clients", { name: "Ana", mobile: "911" })).json();
    const project = (await send("POST", "/api/projects", { name: "Lamp" })).json();
    const big = { ...body.quote, total: 99 };
    const second = (
      await send("POST", "/api/costs/quotes", {
        ...body,
        name: "Lamp",
        clientId: client.id,
        projectId: project.id,
        quote: big,
      })
    ).json();
    expect(second.number).toBe(2);
    expect((await list(`?clientId=${client.id}`)).items.map((q: { id: string }) => q.id)).toEqual([
      second.id,
    ]);
    expect((await list(`?projectId=${project.id}`)).total).toBe(1);
    expect((await list("?name=002-la")).total).toBe(1);
    expect((await list("?sort=-total")).items[0].id).toBe(second.id);
    expect((await list("?sort=total")).items[0].id).toBe(res.json().id);
    expect((await list("?sort=client")).total).toBe(2);
    expect((await list("?sort=project")).total).toBe(2);

    const patched = await send("PATCH", `/api/costs/quotes/${res.json().id}`, {
      notes: "Rush",
      clientId: client.id,
    });
    expect(patched.json()).toMatchObject({ notes: "Rush", clientId: client.id, number: 1 });
    expect((await list(`?clientId=${client.id}`)).total).toBe(2);
    expect(
      (await send("PATCH", `/api/costs/quotes/${res.json().id}`, { number: 2 })).statusCode,
    ).toBe(409);

    expect((await send("DELETE", `/api/costs/quotes/${res.json().id}`)).statusCode).toBe(204);
    expect((await list()).total).toBe(1);
  });
});
