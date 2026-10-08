import { openDb, schema } from "@3d-maker-suite/db";
import { sum } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { setRemaining } from "./lib/spools.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
});

const send = (method: "POST" | "PATCH", url: string, payload: Record<string, unknown>) =>
  app.inject({ method, url, payload });

const profile = async () =>
  (
    await send("POST", "/api/filament/profiles", {
      brand: "Prusament",
      material: "PLA",
      name: "Galaxy Black",
      colorHex: "#1a1a1a",
      densityGcm3: 1.24,
    })
  ).json();

describe("filament", () => {
  it("many spools per profile; archived profiles take no new spools", async () => {
    const p = await profile();
    expect(p).toMatchObject({ diameterMm: 1.75, archivedAt: null });
    for (const initialGrams of [1000, 750])
      expect(
        (await send("POST", "/api/filament/spools", { profileId: p.id, initialGrams })).statusCode,
      ).toBe(201);
    const list = (await app.inject(`/api/filament/spools?profileId=${p.id}`)).json();
    expect(list.total).toBe(2);

    await send("PATCH", `/api/filament/profiles/${p.id}`, { archived: true });
    const res = await send("POST", "/api/filament/spools", { profileId: p.id, initialGrams: 1000 });
    expect(res.statusCode).toBe(400);
  });

  it("every remaining-weight change is a ledger entry that sums to the weight", async () => {
    const p = await profile();
    const spool = (
      await send("POST", "/api/filament/spools", {
        profileId: p.id,
        initialGrams: 1000,
        remainingGrams: 900,
      })
    ).json();
    const adjust = (kind: string, remainingGrams: number, note?: string) =>
      send("POST", `/api/filament/spools/${spool.id}/adjust`, { kind, remainingGrams, note });

    expect((await adjust("manual", 850, "weighed")).json().remainingGrams).toBe(850);
    await adjust("correction", 860);
    await adjust("manual", 860); // unchanged: no entry
    // Print entries come from prints (Step 9), not from the public endpoint.
    expect((await adjust("print", 800)).statusCode).toBe(400);
    setRemaining(db, spool.id, "print", 820, "benchy");

    const history = (await app.inject(`/api/filament/spools/${spool.id}/history`)).json();
    expect(
      history.map((e: { kind: string; deltaGrams: number }) => [e.kind, e.deltaGrams]),
    ).toEqual([
      ["print", -40],
      ["correction", 10],
      ["manual", -50],
      ["manual", 900],
    ]);
    const total = db
      .select({ n: sum(schema.spoolWeightEntries.deltaGrams) })
      .from(schema.spoolWeightEntries)
      .get();
    expect(Number(total?.n)).toBe(820);
    expect((await app.inject(`/api/filament/spools/${spool.id}`)).json().remainingGrams).toBe(820);

    // remaining weight is not patchable
    expect(
      (await send("PATCH", `/api/filament/spools/${spool.id}`, { remainingGrams: 1 })).statusCode,
    ).toBe(400);
  });
});
