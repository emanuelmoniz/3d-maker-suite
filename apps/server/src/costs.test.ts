import { openDb } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  app = await buildApp(openDb(":memory:"));
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
        brand: "Bambu Lab",
        model: "P1S",
        powerW: 200,
        purchasePrice: 50000,
      })
    ).json();
    const profile = (
      await send("POST", "/api/filament/profiles", {
        material: "PLA",
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

  it("saves, lists and deletes quotes", async () => {
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
    const res = await send("POST", "/api/costs/quotes", body);
    expect(res.statusCode).toBe(201);
    expect((await app.inject("/api/costs/quotes")).json()).toHaveLength(1);
    expect(
      (await send("POST", "/api/costs/quotes", { ...body, projectId: crypto.randomUUID() }))
        .statusCode,
    ).toBe(400);
    expect((await send("DELETE", `/api/costs/quotes/${res.json().id}`)).statusCode).toBe(204);
    expect((await app.inject("/api/costs/quotes")).json()).toEqual([]);
  });
});
