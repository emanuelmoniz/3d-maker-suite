import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import { BUILT_IN_ROLE_IDS, type RoleBuiltIn } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { encrypt } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ntfyBody, writeChannel } from "./alerts/channels.ts";
import { evaluateAlerts, raise } from "./alerts/evaluate.ts";
import { buildApp } from "./app.ts";
import type { Config } from "./config.ts";
import { modelIdFor } from "./lib/catalog.ts";
import { hashPassword } from "./lib/password.ts";
import { setRemaining } from "./lib/spools.ts";
import { reviewer } from "./testReview.ts";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
const fetchMock = vi.fn(async () => new Response("ok"));

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db, false, "", { serverConfig: { host: "10.0.0.5", port: 4300 } as Config });
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

/** A spool in use that is low; `bare` leaves out its price and open date (two more alerts). */
async function lowSpool(bare = false) {
  const brand = (await send("POST", "/api/filament-brands", { name: "Prusament" })).json();
  const material = (await send("POST", "/api/filament-materials", { name: "PLA" })).json();
  const s = (
    await send("POST", "/api/filament/spools", {
      brandId: brand.id,
      materialId: material.id,
      name: "Galaxy",
      initialGrams: 1000,
      ...(!bare && { pricePaid: 2000, openedAt: "2026-10-01T12:00:00.000Z" }),
    })
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

  it("a spool with no price or no open date always warns (ADR-0016: who sees it is the subscription), sealed ones aside", async () => {
    const used = await lowSpool(true); // in use: some was taken
    const materialId = db.select().from(schema.spools).get()?.materialId ?? "";
    const sealed = (
      await send("POST", "/api/filament/spools", { materialId, initialGrams: 1000 })
    ).json().id;
    const kinds = async () => {
      await evaluate();
      return (await list())
        .filter((a: { kind: string }) => a.kind !== "spool_low")
        .map(
          (a: { kind: string; entityId: string }) =>
            `${a.kind}:${a.entityId === used ? "used" : "sealed"}`,
        )
        .sort();
    };
    expect(await kinds()).toEqual([
      "spool_no_open_date:used",
      "spool_no_price:sealed",
      "spool_no_price:used",
    ]);
    await send("PATCH", `/api/filament/spools/${used}`, {
      pricePaid: 2000,
      openedAt: "2026-10-01T12:00:00.000Z",
    });
    expect(await kinds()).toEqual(["spool_no_price:sealed"]);
    expect(sealed).toBeTruthy();
  });

  it("the global channel is told only the kinds the Admin role gets as notify", async () => {
    await ntfyOn();
    await lowSpool(true); // low, no price, no open date; the last two are off for the Admin role
    await evaluate();
    const told = await list();
    const low = told.find((a: { kind: string }) => a.kind === "spool_low");
    expect(clicks()).toEqual([`http://10.0.0.5:4300/alerts/${low.id}`]);
    db.update(schema.roles)
      .set({ alertKinds: { spool_no_price: "notify" } })
      .where(eq(schema.roles.builtIn, "admin"))
      .run();
    await evaluate();
    const price = told.find((a: { kind: string }) => a.kind === "spool_no_price");
    expect(clicks()).toContain(`http://10.0.0.5:4300/alerts/${price.id}`);
    expect(clicks()).toHaveLength(2);
  });

  it("a maintenance type's lead and switches decide warning and error", async () => {
    const p = (
      await send("POST", "/api/printers", { name: "P1", modelId: modelIdFor(db, "Bambu", "P1S") })
    ).json();
    const type = (
      await send("POST", "/api/maintenance/types", { name: "Nozzle", intervalPrints: 100 })
    ).json();
    const printed = (n: number) => {
      const c = schema.usageCorrections;
      db.delete(c).where(eq(c.printerId, p.id)).run();
      db.insert(c).values({ printerId: p.id, deltaSec: 0, deltaPrints: n }).run();
    };
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
    expect(clicks()).toEqual([`http://10.0.0.5:4300/alerts/${alertId}`]);
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
      // The run that went through resolved the first error; the next failure raises a new one.
      expect(await errors()).toHaveLength(0);
      state.fail = "unreachable";
      await sync("printers");
      const [again] = await errors();
      expect(again.id).not.toBe(error.id);
      state.fail = undefined;

      // Switched off for the type: no alert.
      await send("PATCH", `/api/integrations/${id}`, {
        policies: [{ type: "printers", alertSeverities: [] }],
      });
      state.fail = "blocked";
      await sync("printers");
      expect(await results()).toHaveLength(2);
      state.fail = undefined;

      // Only the severities picked are raised: success yes, error no.
      await send("PATCH", `/api/integrations/${id}`, {
        policies: [{ type: "printers", alertSeverities: ["success"] }],
      });
      state.fail = "unreachable";
      await sync("printers");
      state.fail = undefined;
      expect(await results()).toHaveLength(2);

      // A confirmed review imports rows but is no sync result.
      const review = reviewer(() => app);
      const preview = (
        await review.open(`/api/import/integration/${id}/prints?from=2000-01-01T00:00:00.000Z`)
      ).json();
      const done = await review.confirm(preview);
      expect(done.json(), done.body).toMatchObject({ created: 3 });
      expect(await results()).toHaveLength(2);

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

describe("delivery per user (ADR-0016)", () => {
  const key = randomBytes(32);
  const log = { warn: vi.fn() };
  const t0 = new Date("2026-11-02T10:00:00.000Z");
  const later = (min: number) => new Date(t0.getTime() + min * 60_000);
  const run = (now = t0) => evaluateAlerts(db, key, log, undefined, now);

  const channelsOn = () => {
    writeChannel(db, key, "ntfy", {
      enabled: true,
      config: { server: "https://ntfy.example" },
      secrets: {},
    });
    writeChannel(db, key, "email", {
      enabled: true,
      config: { host: "smtp.example", port: "587", from: "app@x.io" },
      secrets: {},
    });
  };
  const user = (
    name: string,
    role: RoleBuiltIn,
    delivery: { email?: boolean; emailTo?: string; ntfyTopic?: string; ntfyToken?: string } = {},
    more: Partial<typeof schema.users.$inferInsert> = {},
  ) => {
    const { ntfyToken, ...rest } = delivery;
    return db
      .insert(schema.users)
      .values({
        email: `${name}@x.io`,
        displayName: name,
        roleId: BUILT_IN_ROLE_IDS[role],
        passwordHash: "x",
        delivery: { ...rest, ...(ntfyToken && { ntfyToken: encrypt(key, { token: ntfyToken }) }) },
        ...more,
      })
      .returning()
      .get();
  };
  const event = (kind: "update_available" | "hub_conflict", id: string) =>
    raise(db, {
      kind,
      severity: "warning",
      module: kind === "hub_conflict" ? "hub" : "system",
      task: `t:${id}`,
      entityType: "x",
      entityId: id,
      context: { version: id, file: id, device: "d", copy: "c" },
    });
  /** The ntfy topics called, in order. */
  const topics = () =>
    (fetchMock.mock.calls as unknown as [string][]).map(([url]) => url.split("/").pop());
  const mailedTo = () => (sendMail.mock.calls as unknown as [{ to: string }][]).map(([m]) => m.to);

  beforeEach(() => sendMail.mockClear());

  it("each user gets only their own notify kinds, on their own destinations", async () => {
    channelsOn();
    user("admin", "admin", { ntfyTopic: "a" });
    // A viewer gets hub conflicts (projects read) but can't get update_available (settings.server).
    user(
      "viewer",
      "viewer",
      { email: true, emailTo: "me@y.io", ntfyTopic: "v" },
      { alertKinds: { hub_conflict: "notify", update_available: "notify" } },
    );
    user("editor", "editor", { email: true, ntfyTopic: "e" }); // in app only: nothing sent
    user(
      "gone",
      "viewer",
      { ntfyTopic: "d" },
      { disabled: true, alertKinds: { hub_conflict: "notify" } },
    );
    event("update_available", "u1");
    event("hub_conflict", "h1");
    await run();
    expect(topics().sort()).toEqual(["a", "a", "v"]);
    expect(mailedTo()).toEqual(["me@y.io"]);
    // Once per user and channel.
    await run(later(60));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("a failed channel retries after a wait, without re-sending the one that went through", async () => {
    channelsOn();
    user("admin", "admin", { email: true, ntfyTopic: "a" });
    event("update_available", "u1");
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    await run();
    expect([topics(), mailedTo()]).toEqual([["a"], ["admin@x.io"]]);
    await run(later(5)); // still waiting
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await run(later(16));
    await run(later(30));
    expect(topics()).toEqual(["a", "a"]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.not.objectContaining({ topic: expect.anything() }),
      "notification failed",
    );
  });

  it("a user's snooze holds their delivery and re-arms it when it ends; the others aren't told again", async () => {
    channelsOn();
    const admin = user("admin", "admin", { ntfyTopic: "a" });
    user("viewer", "viewer", { ntfyTopic: "v" }, { alertKinds: { hub_conflict: "notify" } });
    event("hub_conflict", "h1");
    const alertId = db.select().from(schema.alerts).get()?.id ?? "";
    db.insert(schema.alertStates)
      .values({ alertId, userId: admin.id, snoozedUntil: later(60).toISOString() })
      .run();
    await run();
    expect(topics()).toEqual(["v"]);
    await run(later(61));
    expect(topics()).toEqual(["v", "a"]);
  });

  it("the global topic and recipient aren't used once there are users", async () => {
    writeChannel(db, key, "ntfy", {
      enabled: true,
      config: { server: "https://ntfy.example", topic: "global" },
      secrets: {},
    });
    user("admin", "admin");
    event("update_available", "u1");
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the API never returns the token; a manager can't change an admin's; the test sends with it", async () => {
    await ntfyOn();
    const hash = await hashPassword("password123");
    const admin = user("admin", "admin", {}, { passwordHash: hash });
    user("boss", "editor", {}, { passwordHash: hash, permissions: { "users.manage": true } });
    const cookie = async (email: string) =>
      String(
        (await send("POST", "/api/auth/login", { email, password: "password123" })).headers[
          "set-cookie"
        ],
      ).split(";")[0] ?? "";
    const as = (c: string) => (method: "GET" | "PATCH" | "POST", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { cookie: c } });
    const me = as(await cookie("admin@x.io"));

    const put = await me("PATCH", "/api/auth/me/delivery", {
      ntfyTopic: "mine",
      ntfyToken: "tk_secret",
    });
    expect(put.json()).toEqual({
      email: false,
      emailTo: null,
      ntfyTopic: "mine",
      ntfyTokenSet: true,
    });
    for (const url of ["/api/auth/me", "/api/auth/me/delivery", `/api/users/${admin.id}/delivery`])
      expect((await me("GET", url)).body).not.toMatch(/tk_secret|ntfyToken"/);

    fetchMock.mockClear();
    expect((await me("POST", "/api/auth/me/delivery/test")).json()).toEqual([
      { channel: "ntfy", ok: true },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.example/mine");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tk_secret");

    // Empty keeps the token, null removes it.
    await me("PATCH", "/api/auth/me/delivery", { ntfyToken: "" });
    expect((await me("GET", "/api/auth/me/delivery")).json().ntfyTokenSet).toBe(true);
    await me("PATCH", "/api/auth/me/delivery", { ntfyToken: null });
    expect((await me("GET", "/api/auth/me/delivery")).json().ntfyTokenSet).toBe(false);

    const boss = as(await cookie("boss@x.io"));
    expect(
      (await boss("PATCH", `/api/users/${admin.id}/delivery`, { email: true })).statusCode,
    ).toBe(403);
  });
});
