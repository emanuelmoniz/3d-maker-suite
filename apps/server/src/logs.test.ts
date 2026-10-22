import { openDb, schema } from "@3d-maker-suite/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { moduleOf, pruneLogs } from "./lib/logSink.ts";

const setup = async () => {
  const db = openDb(":memory:");
  const out: string[] = [];
  const app = await buildApp(db, { stream: { write: (l: string) => out.push(l) } });
  const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload });
  const rows = () => db.select().from(schema.logs).all();
  return { db, app, out, req, rows };
};

describe("logs", () => {
  it("inactive (the default outside pnpm dev) writes no rows", async () => {
    const { req, rows, out } = await setup();
    await req("POST", "/api/clients", { name: "Ana", mobile: "911" });
    expect(rows()).toEqual([]);
    expect(out.some((l) => l.includes("POST /api/clients 201"))).toBe(true); // console as before
  });

  it("keeps lines by level and module, tagged from the URL", async () => {
    const { req, rows } = await setup();
    await req("PATCH", "/api/preferences", { logActive: true });
    await req("POST", "/api/clients", { name: "Ana", mobile: "911" });
    await req("GET", "/api/clients");
    await req("POST", "/api/clients", { name: "" }); // 400 -> warn
    expect(rows().map((r) => [r.level, r.module, r.message])).toEqual([
      ["info", "settings", "PATCH /api/preferences 200"],
      ["info", "clients", "POST /api/clients 201"],
      ["warn", "clients", "POST /api/clients 400"],
    ]);
    expect(rows()[1]?.detail).toMatchObject({ ms: expect.any(Number), reqId: expect.any(String) });

    await req("PATCH", "/api/preferences", { logLevels: ["debug"], logModules: ["printers"] });
    await req("GET", "/api/clients");
    await req("GET", "/api/printers");
    expect(rows().at(-1)).toMatchObject({ level: "debug", module: "printers" });
    expect(rows()).toHaveLength(4);

    await req("PATCH", "/api/preferences", { logActive: false });
    await req("GET", "/api/printers");
    expect(rows()).toHaveLength(4);
  });

  it("never stores secrets", async () => {
    const { app, req, rows } = await setup();
    await req("PATCH", "/api/preferences", { logActive: true });
    app.log.warn({ cfg: { token: "s3cret", password: "pw" } }, "x");
    expect(JSON.stringify(rows())).not.toContain("s3cret");
    expect(JSON.stringify(rows())).not.toContain('"pw"');
  });

  it("lists with filters and sort, and clears", async () => {
    const { req } = await setup();
    await req("PATCH", "/api/preferences", { logActive: true });
    await req("POST", "/api/clients", { name: "Ana", mobile: "911" });
    await req("POST", "/api/clients", { name: "" });
    const warn = (await req("GET", "/api/logs?level=warn")).json();
    expect(warn.items.map((r: { message: string }) => r.message)).toEqual([
      "POST /api/clients 400",
    ]);
    const bySeverity = (await req("GET", "/api/logs?sort=-level")).json();
    expect(bySeverity.items[0].level).toBe("warn");
    expect((await req("GET", "/api/logs?message=201")).json().total).toBe(1);
    expect((await req("DELETE", "/api/logs")).statusCode).toBe(204);
    expect((await req("GET", "/api/logs")).json().total).toBe(0);
  });

  it("prunes by age, then by count", async () => {
    const { db, rows } = await setup();
    const day = 86_400_000;
    const at = (ago: number) => new Date(Date.now() - ago).toISOString();
    db.insert(schema.logs)
      .values([
        { time: at(20 * day), level: "info", module: "system", message: "old" },
        ...Array.from({ length: 5 }, (_, i) => ({
          time: at(5 - i),
          level: "info" as const,
          module: "system",
          message: `m${i}`,
        })),
      ])
      .run();
    pruneLogs(db, { logRetentionDays: 14, logMaxEntries: 1000 });
    expect(rows().map((r) => r.message)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    pruneLogs(db, { logRetentionDays: 14, logMaxEntries: 2 });
    expect(rows().map((r) => r.message)).toEqual(["m3", "m4"]);
  });

  it("maps API prefixes to modules", () => {
    expect(moduleOf("/api/printer-models/x")).toBe("printers");
    expect(moduleOf("/api/costs?x=1")).toBe("quotes");
    expect(moduleOf("/api/preferences")).toBe("settings");
    expect(moduleOf("/anything")).toBe("system");
  });
});
