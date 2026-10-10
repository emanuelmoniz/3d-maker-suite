import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";
import { setRemaining } from "./lib/spools.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
const fetchMock = vi.fn(async () => new Response("ok"));

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const send = (method: "POST" | "PATCH" | "PUT", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, payload });
const evaluate = () => send("POST", "/api/alerts/evaluate");
const list = async () => (await app.inject("/api/alerts")).json();

async function lowSpool() {
  const brand = (await send("POST", "/api/filament-brands", { name: "Prusament" })).json();
  const material = (await send("POST", "/api/filament-materials", { name: "PLA" })).json();
  const p = (
    await send("POST", "/api/filament/profiles", {
      brandId: brand.id,
      materialId: material.id,
      name: "Galaxy",
      densityGcm3: 1.24,
    })
  ).json();
  const s = (
    await send("POST", "/api/filament/spools", { profileId: p.id, initialGrams: 1000 })
  ).json();
  setRemaining(db, s.id, "manual", 50);
  return s.id as string;
}

describe("alerts", () => {
  it("alerts once per condition, resolves when it clears, comes back as a new alert", async () => {
    await send("PUT", "/api/alerts/channels/ntfy", {
      enabled: true,
      config: { server: "https://ntfy.example", topic: "t" },
      secrets: { token: "tk_secret" },
    });
    const id = await lowSpool();

    await evaluate();
    await evaluate();
    expect(await list()).toMatchObject([
      { kind: "spool_low", entityId: id, context: { grams: 50 } },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setRemaining(db, id, "manual", 800);
    await evaluate();
    expect(await list()).toHaveLength(0);

    setRemaining(db, id, "manual", 40);
    await evaluate();
    expect(await list()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.select().from(schema.alerts).all()).toHaveLength(2);
  });

  it("snooze hides and silences until it ends; dismiss stays quiet until resolved", async () => {
    await send("PUT", "/api/alerts/channels/ntfy", {
      enabled: true,
      config: { server: "https://ntfy.example", topic: "t" },
      secrets: {},
    });
    const id = await lowSpool();
    await evaluate();
    const [alert] = await list();

    const snoozed = await send("PATCH", `/api/alerts/${alert.id}`, { action: "snooze", days: 3 });
    expect(snoozed.json().snoozedUntil).not.toBeNull();
    await evaluate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The snooze ends while the spool is still low: alerts again.
    db.update(schema.alerts).set({ snoozedUntil: "2000-01-01T00:00:00.000Z" }).run();
    await evaluate();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await list())[0]).toMatchObject({ snoozedUntil: null, readAt: null });

    await send("PATCH", `/api/alerts/${alert.id}`, { action: "dismiss" });
    await evaluate();
    expect(await list()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.select().from(schema.alerts).all()).toHaveLength(1);
    expect(id).toBeTruthy();
  });

  it("raises warranty alerts; a failing channel does not block the others or the app", async () => {
    await send("PUT", "/api/alerts/channels/ntfy", {
      enabled: true,
      config: { server: "https://ntfy.example", topic: "t" },
      secrets: {},
    });
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    await send("POST", "/api/printers", {
      name: "P1",
      modelId: modelIdFor(db, "Bambu", "P1S"),
      warrantyEndsAt: soon,
    });
    await evaluate();
    expect(await list()).toMatchObject([{ kind: "warranty_ending", context: { days: 10 } }]);
    await evaluate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never returns channel secrets", async () => {
    await send("PUT", "/api/alerts/channels/email", {
      enabled: false,
      config: { host: "smtp.example", port: "587" },
      secrets: { password: "hunter2" },
    });
    const res = await app.inject("/api/alerts/channels");
    expect(res.body).not.toContain("hunter2");
    expect(res.json().find((c: { id: string }) => c.id === "email")).toMatchObject({
      secretsSet: ["password"],
    });
    // Saving again with an empty secret keeps the stored one.
    await send("PUT", "/api/alerts/channels/email", {
      enabled: false,
      config: { host: "smtp.example", port: "587" },
      secrets: { password: "" },
    });
    expect((await app.inject("/api/alerts/channels")).json()[1].secretsSet).toEqual(["password"]);
  });
});
