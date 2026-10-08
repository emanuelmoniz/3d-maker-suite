import { openDb, schema } from "@3d-maker-suite/db";
import { sum } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
});

const send = (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });

async function setup() {
  const printer = (
    await send("POST", "/api/printers", {
      name: "P1S",
      brand: "Bambu Lab",
      model: "P1S",
      powerW: 100,
    })
  ).json();
  const profile = (
    await send("POST", "/api/filament/profiles", {
      material: "PLA",
      densityGcm3: 1.24,
    })
  ).json();
  const spool = async (initialGrams = 1000) =>
    (await send("POST", "/api/filament/spools", { profileId: profile.id, initialGrams })).json();
  return { printer, profile, spool, a: await spool(), b: await spool(500) };
}

const remaining = async (id: string) =>
  (await app.inject(`/api/filament/spools/${id}`)).json().remainingGrams;

describe("prints", () => {
  it("create, edit and delete keep spool weights and the ledger consistent", async () => {
    const { printer, a, b } = await setup();
    const res = await send("POST", "/api/prints", {
      printerId: printer.id,
      title: "Benchy",
      startedAt: "2026-01-01T10:00:00.000Z",
      durationSec: 3600,
      outcome: "success",
      usages: [
        { spoolId: a.id, grams: 100 },
        { spoolId: b.id, grams: 20.5 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const print = res.json();
    expect(print).toMatchObject({ energyWh: 100, energySource: "estimated" });
    expect(print.usages.every((u: { profileId: string }) => u.profileId)).toBe(true);
    expect(await remaining(a.id)).toBe(900);
    expect(await remaining(b.id)).toBe(479.5);

    // Edit: spool a 100 -> 60 (refund 40), spool b dropped (refund all).
    const edited = await send("PATCH", `/api/prints/${print.id}`, {
      usages: [{ spoolId: a.id, grams: 60 }],
    });
    expect(edited.statusCode).toBe(200);
    expect(await remaining(a.id)).toBe(940);
    expect(await remaining(b.id)).toBe(500);

    // Failed prints still consume filament (partial grams).
    await send("PATCH", `/api/prints/${print.id}`, {
      outcome: "failed",
      failureReason: "Spaghetti",
      usages: [{ spoolId: a.id, grams: 15 }],
    });
    expect(await remaining(a.id)).toBe(985);

    expect((await send("DELETE", `/api/prints/${print.id}`)).statusCode).toBe(204);
    expect(await remaining(a.id)).toBe(1000);

    for (const s of [a, b]) {
      const total = db
        .select({ n: sum(schema.spoolWeightEntries.deltaGrams) })
        .from(schema.spoolWeightEntries)
        .get();
      expect(Number(total?.n)).toBe(1500);
      const history = (await app.inject(`/api/filament/spools/${s.id}/history`)).json();
      expect(history.at(-1).remainingAfter).toBe(s.initialGrams);
    }
  });

  it("rolls back when a spool has too little filament, and validates reasons", async () => {
    const { printer, b } = await setup();
    const body = {
      printerId: printer.id,
      title: "Big",
      startedAt: "2026-01-01T10:00:00.000Z",
      outcome: "success",
    };
    const tooMuch = await send("POST", "/api/prints", {
      ...body,
      usages: [{ spoolId: b.id, grams: 501 }],
    });
    expect(tooMuch.statusCode).toBe(400);
    expect((await app.inject("/api/prints")).json().total).toBe(0);
    expect(await remaining(b.id)).toBe(500);

    expect(
      (await send("POST", "/api/prints", { ...body, failureReason: "Spaghetti" })).statusCode,
    ).toBe(400); // success cannot have a failure reason
    expect(
      (await send("POST", "/api/prints", { ...body, outcome: "failed", failureReason: "Gremlins" }))
        .statusCode,
    ).toBe(400);
  });

  it("manual energy is kept as measured; switching to success drops the reason", async () => {
    const { printer } = await setup();
    const print = (
      await send("POST", "/api/prints", {
        printerId: printer.id,
        title: "X",
        startedAt: "2026-01-01T10:00:00.000Z",
        durationSec: 7200,
        outcome: "cancelled",
        failureReason: "Clog",
        energyWh: 42,
      })
    ).json();
    expect(print).toMatchObject({ energyWh: 42, energySource: "measured" });
    const patched = (
      await send("PATCH", `/api/prints/${print.id}`, { durationSec: 10, outcome: "success" })
    ).json();
    expect(patched).toMatchObject({ energyWh: 42, failureReason: null });
    const reset = (await send("PATCH", `/api/prints/${print.id}`, { energyWh: null })).json();
    expect(reset).toMatchObject({ energySource: "estimated" });
  });
});
