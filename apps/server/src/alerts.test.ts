import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ntfyBody } from "./alerts/channels.ts";
import { buildApp } from "./app.ts";
import type { Config } from "./config.ts";
import { modelIdFor } from "./lib/catalog.ts";
import { setRemaining } from "./lib/spools.ts";
import { reviewer } from "./testReview.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
const fetchMock = vi.fn(async () => new Response("ok"));

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db, false, "", { serverConfig: { host: "0.0.0.0", port: 4300 } as Config });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const send = (method: "POST" | "PATCH" | "PUT", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, payload });
const evaluate = () => send("POST", "/api/alerts/evaluate");
const ntfyOn = () =>
  send("PUT", "/api/alerts/channels/ntfy", {
    enabled: true,
    config: { server: "https://ntfy.example", topic: "t" },
    secrets: {},
  });
/** The `click` header of each ntfy call. */
const clicks = () =>
  (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
    ([, init]) => (init.headers as Record<string, string>).click,
  );
const list = async () => (await app.inject("/api/alerts")).json();
const detail = async (id: string) => (await app.inject(`/api/alerts/${id}`)).json().detail;

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
  it("ntfy gets a short form: a few detail lines, within its size limit", () => {
    const detail = Array.from({ length: 8 }, (_, i) => `line ${i}`);
    expect(ntfyBody({ title: "t", body: "b", detail }).split("\n")).toEqual([
      "b",
      ...detail.slice(0, 5),
      "…+3",
    ]);
    const huge = ntfyBody({ title: "t", body: "ã".repeat(5000) });
    expect(Buffer.byteLength(huge)).toBeLessThanOrEqual(4000);
    expect(huge).not.toContain("�");
  });

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
      {
        kind: "spool_low",
        severity: "warning",
        module: "filament",
        task: `spool:${id}`,
        entityId: id,
        context: { grams: 50 },
        hasDetail: false,
      },
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

  it("a spool's own weight and switch replace the default; empty follows it", async () => {
    const id = await lowSpool();
    const low = async () => {
      await evaluate();
      return (await list()).filter((a: { kind: string }) => a.kind === "spool_low").length;
    };
    expect(await low()).toBe(1);
    // Below the default but above its own limit: no alert.
    await send("PATCH", `/api/filament/spools/${id}`, { lowGrams: 20 });
    expect(await low()).toBe(0);
    await send("PATCH", `/api/filament/spools/${id}`, { lowGrams: 80 });
    expect(await low()).toBe(1);
    await send("PATCH", `/api/filament/spools/${id}`, { lowAlert: false });
    expect(await low()).toBe(0);
    // Empty = the default again.
    await send("PATCH", `/api/filament/spools/${id}`, { lowGrams: null, lowAlert: null });
    expect(await low()).toBe(1);
  });

  it("a maintenance type's lead and switches decide warning and error", async () => {
    const p = (
      await send("POST", "/api/printers", { name: "P1", modelId: modelIdFor(db, "Bambu", "P1S") })
    ).json();
    const type = (
      await send("POST", "/api/maintenance/types", { name: "Nozzle", intervalPrints: 100 })
    ).json();
    const printed = (n: number) =>
      db.update(schema.printers).set({ printsOffset: n }).where(eq(schema.printers.id, p.id)).run();
    const sev = async () => {
      await evaluate();
      return (await list()).find((a: { kind: string }) => a.kind === "maintenance_due")?.severity;
    };
    const set = (body: Record<string, unknown>) =>
      send("PATCH", `/api/maintenance/types/${type.id}`, body);

    // Default rule: nothing until "upcoming".
    printed(50);
    expect(await sev()).toBeUndefined();
    // A lead of 60 prints warns 10 prints in; the default rule no longer applies.
    await set({ warnLeadPrints: 60 });
    printed(30);
    expect(await sev()).toBeUndefined();
    printed(50);
    expect(await sev()).toBe("warning");
    await set({ warnEnabled: false });
    expect(await sev()).toBeUndefined();
    // Overdue: an error, unless that is off (then the warning, if on).
    printed(100);
    expect(await sev()).toBe("error");
    await set({ errorEnabled: false });
    expect(await sev()).toBeUndefined();
    await set({ warnEnabled: null });
    expect(await sev()).toBe("warning");
    // Empty = the default.
    await set({ errorEnabled: null, warnLeadPrints: null });
    expect(await sev()).toBe("error");
    // The Settings default for prints applies to a type without its own lead.
    printed(95);
    await set({ warnEnabled: null });
    expect(await sev()).toBe("warning");
    printed(30);
    await send("PATCH", "/api/preferences", { maintenanceLeadPrints: 80 });
    expect(await sev()).toBe("warning");
  });

  it("accessory maintenance raises an alert that logging it resolves", async () => {
    const p = (
      await send("POST", "/api/printers", { name: "P1", modelId: modelIdFor(db, "Bambu", "P1S") })
    ).json();
    const ams = (await send("POST", "/api/accessories", { name: "AMS", type: "AMS" })).json();
    await send("POST", `/api/accessories/${ams.id}/installs`, {
      printerId: p.id,
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    const type = (
      await send("POST", "/api/maintenance/types", {
        name: "Rollers",
        target: "accessory",
        intervalPrints: 1,
      })
    ).json();
    db.insert(schema.prints)
      .values({
        printerId: p.id,
        title: "t",
        outcome: "success",
        startedAt: "2026-01-02T00:00:00.000Z",
      })
      .run();
    await evaluate();
    expect(await list()).toMatchObject([
      {
        kind: "maintenance_due",
        severity: "error",
        module: "maintenance",
        task: `maintenance:${ams.id}:${type.id}`,
        entityId: `${ams.id}:${type.id}`,
        context: { printer: "01-AMS", task: "Rollers" },
      },
    ]);
    await send("POST", "/api/maintenance/tasks", { accessoryId: ams.id, typeId: type.id });
    await evaluate();
    expect(await list()).toHaveLength(0);
  });

  it("maintenance due soon is a warning that turns into an error in place, notified once", async () => {
    await ntfyOn();
    const p = (
      await send("POST", "/api/printers", { name: "P1", modelId: modelIdFor(db, "Bambu", "P1S") })
    ).json();
    await send("POST", "/api/maintenance/types", { name: "Nozzle", intervalPrints: 10 });
    const printed = (n: number) =>
      db
        .insert(schema.prints)
        .values(
          Array.from({ length: n }, (_, i) => ({
            printerId: p.id,
            title: `t${i}`,
            outcome: "success" as const,
            startedAt: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
          })),
        )
        .run();

    printed(9);
    await evaluate();
    const [soon] = await list();
    expect(soon).toMatchObject({ kind: "maintenance_due", severity: "warning" });
    printed(1);
    await evaluate();
    expect(await list()).toMatchObject([{ id: soon.id, severity: "error" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("read, unread and snooze can be undone; history holds what no longer needs attention", async () => {
    await lowSpool();
    await evaluate();
    const [{ id }] = await list();
    const patch = async (body: Record<string, unknown>) =>
      (await send("PATCH", `/api/alerts/${id}`, body)).json();
    const history = async (q = "") => (await app.inject(`/api/alerts/history${q}`)).json();

    // A warning that was read still needs attention.
    expect(await patch({ action: "read" })).toMatchObject({ readAt: expect.any(String) });
    expect((await patch({ action: "unread" })).readAt).toBeNull();
    expect((await history()).total).toBe(0);

    // Snoozed: out of "needs attention", into history; removing the snooze brings it back.
    const snoozed = await patch({ action: "snooze", days: 1 });
    expect(snoozed.updatedAt).toEqual(expect.any(String));
    expect(await history()).toMatchObject({
      total: 1,
      items: [{ id, status: "snoozed", hasDetail: false, updatedAt: snoozed.updatedAt }],
    });
    expect((await patch({ action: "unsnooze" })).snoozedUntil).toBeNull();
    expect((await history()).total).toBe(0);

    // A read success leaves "needs attention"; unread puts it back. Dismissed and resolved too.
    const [success] = db
      .insert(schema.alerts)
      .values({
        kind: "sync_success",
        severity: "success",
        module: "integrations",
        task: "sync:x:prints",
        entityType: "sync_run",
        entityId: "run-1",
        readAt: "2026-01-01T00:00:00.000Z",
      })
      .returning()
      .all();
    expect(await history("?status=read")).toMatchObject({ total: 1, items: [{ id: success?.id }] });
    await send("PATCH", `/api/alerts/${success?.id}`, { action: "unread" });
    expect((await history()).total).toBe(0);

    await patch({ action: "dismiss" });
    expect(await history()).toMatchObject({ total: 1, items: [{ status: "dismissed" }] });
    expect((await patch({ action: "undismiss" })).dismissedAt).toBeNull();
    expect((await history()).total).toBe(0);
    await patch({ action: "dismiss" });
    expect((await history("?module=printers")).total).toBe(0);
    expect((await history("?status=dismissed&sort=-createdAt")).total).toBe(1);
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
    expect(await list()).toMatchObject([
      { kind: "warranty_ending", severity: "warning", module: "printers", context: { days: 10 } },
    ]);
    await evaluate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("raises sync_pending while an auto sync leaves rows for review, unless switched off", async () => {
    const { id } = db.insert(schema.integrations).values({ adapterId: "mock" }).returning().get();
    const policy = (set: Partial<typeof schema.syncPolicies.$inferInsert>) =>
      db
        .insert(schema.syncPolicies)
        .values({ integrationId: id, type: "prints", mode: "auto", frequency: "1h", ...set })
        .onConflictDoUpdate({
          target: [schema.syncPolicies.integrationId, schema.syncPolicies.type],
          set,
        })
        .run();
    const open = async () => {
      await evaluate();
      return (await list()).filter((a: { kind: string }) => a.kind === "sync_pending");
    };

    await ntfyOn();
    policy({ pending: 2 });
    expect(await open()).toMatchObject([
      {
        severity: "warning",
        module: "integrations",
        task: `sync:${id}:prints`,
        entityId: `${id}:prints`,
        context: { integrationId: id, adapterId: "mock", type: "prints", count: 2 },
        // No run logged what was left.
        hasDetail: false,
      },
    ]);
    // The notification opens the alert; a wildcard host is reached by the machine's name.
    const [{ id: alertId }] = await list();
    expect(clicks()).toEqual([`http://${hostname()}:4300/alerts/${alertId}`]);
    // A new count refreshes the one alert.
    policy({ pending: 3 });
    expect(await open()).toMatchObject([{ context: { count: 3 } }]);
    // Confirming the review empties the queue.
    policy({ pending: 0 });
    expect(await open()).toHaveLength(0);
    // Off, or a manual type (the user opens the review anyway): no alert.
    policy({ pending: 1, alertSeverities: [] });
    expect(await open()).toHaveLength(0);
    policy({ alertSeverities: null, mode: "manual" });
    expect(await open()).toHaveLength(0);
  });

  it("a sync raises success with new rows, error once per failing streak; a review neither", async () => {
    const state = fixture();
    const dataDir = mkdtempSync(join(tmpdir(), "alerts-"));
    app = await buildApp(db, false, dataDir, { adapters: [mockAdapter(state)] });
    // The mock's prints are of this project's file, so they can be imported.
    db.insert(schema.projects)
      .values({
        number: 1,
        name: "mock",
        meta: { files: [{ path: "Mock print.3mf", kind: "model", size: 1 }] },
      })
      .run();
    try {
      await ntfyOn();
      const { id } = (
        await send("POST", "/api/integrations", { adapterId: "mock", secrets: { token: "t" } })
      ).json();
      const sync = (type: string) => send("POST", `/api/integrations/${id}/sync`, { type });
      const results = async () => {
        await evaluate();
        return (await list()).filter((a: { kind: string }) => a.kind.startsWith("sync_"));
      };

      await sync("printers");
      const [success] = await results();
      expect(success).toMatchObject({
        kind: "sync_success",
        severity: "success",
        module: "integrations",
        task: `sync:${id}:printers`,
        entityType: "sync_run",
        context: {
          integrationId: id,
          adapterId: "mock",
          type: "printers",
          created: 1,
          updated: 0,
        },
        hasDetail: true,
      });
      expect(success).not.toHaveProperty("detail");
      // The detail is the run's log, by row.
      expect(await detail(success.id)).toEqual({
        runId: success.entityId,
        log: [{ event: "created", label: expect.any(String) }],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The notification names severity and module, then the log.
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.body).toMatch(/^Success · Integrations\nprinters: 1 new, 0 updated\nNew: /);
      // Nothing new: no alert.
      await sync("printers");
      expect(await results()).toHaveLength(1);

      // Failing again and again alerts once; a run that goes through re-arms it.
      state.fail = "unreachable";
      await sync("printers");
      await sync("printers");
      const errors = async () =>
        (await results()).filter((a: { kind: string }) => a.kind === "sync_error");
      const [error] = await errors();
      expect(error).toMatchObject({
        severity: "error",
        task: `sync:${id}:printers`,
        context: { type: "printers", code: "unreachable" },
      });
      expect((await detail(error.id)).log).toEqual([{ event: "failed", code: "unreachable" }]);
      state.fail = undefined;
      await sync("printers");
      state.fail = "unreachable";
      await sync("printers");
      expect(await errors()).toHaveLength(2);
      state.fail = undefined;

      // Switched off for the type: no alert.
      await send("PATCH", `/api/integrations/${id}`, {
        policies: [{ type: "printers", alertSeverities: [] }],
      });
      state.fail = "blocked";
      await sync("printers");
      expect(await results()).toHaveLength(3);
      state.fail = undefined;

      // Only the severities picked are raised: success yes, error no.
      await send("PATCH", `/api/integrations/${id}`, {
        policies: [{ type: "printers", alertSeverities: ["success"] }],
      });
      state.fail = "unreachable";
      await sync("printers");
      state.fail = undefined;
      expect(await results()).toHaveLength(3);

      // A confirmed review imports rows but is no sync result.
      const review = reviewer(() => app);
      const preview = (
        await review.open(`/api/import/integration/${id}/prints?from=2000-01-01T00:00:00.000Z`)
      ).json();
      const done = await review.confirm(preview);
      expect(done.json(), done.body).toMatchObject({ created: 3 });
      expect(await results()).toHaveLength(3);

      // Dismissed: gone from the list, nothing re-sent.
      const calls = fetchMock.mock.calls.length;
      for (const a of await results())
        await send("PATCH", `/api/alerts/${a.id}`, { action: "dismiss" });
      expect(await results()).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("a pending review shows the rows the last run left, without secrets", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "alerts-"));
    app = await buildApp(db, false, dataDir, { adapters: [mockAdapter(fixture())] });
    try {
      const { id } = (
        await send("POST", "/api/integrations", {
          adapterId: "mock",
          secrets: { token: "tk_secret_42" },
        })
      ).json();
      // No spool fits the mock's filament, so its prints wait for a pick.
      await send("POST", `/api/integrations/${id}/sync`, { type: "printers" });
      await send("POST", `/api/integrations/${id}/sync`, { type: "prints" });
      await evaluate();
      const pending = (await list()).find((a: { kind: string }) => a.kind === "sync_pending");
      expect(pending).toMatchObject({ severity: "warning", hasDetail: true });
      const res = await app.inject(`/api/alerts/${pending.id}`);
      expect(res.body).not.toContain("tk_secret_42");
      const { log } = res.json().detail;
      expect(log.length).toBe(pending.context.count);
      expect(log[0]).toMatchObject({ event: "left", label: "Mock print 1", reason: "pick" });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
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
