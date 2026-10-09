import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { applyPendingRestore } from "./backup/backup.ts";
import { modelIdFor } from "./lib/catalog.ts";

let dir: string;
const opened: ReturnType<typeof openDb>[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "backup-"));
});
afterEach(() => {
  for (const d of opened.splice(0)) if (d.$client.open) d.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const mk = async (name: string) => {
  const dataDir = join(dir, name);
  mkdirSync(dataDir);
  const db = openDb(join(dataDir, "app.sqlite"));
  opened.push(db);
  return { dataDir, db, app: await buildApp(db, false, dataDir) };
};

describe("backup", () => {
  it("backup → fresh install → upload → restore gives the same data", async () => {
    const a = await mk("a");
    const printer = (
      await a.app.inject({
        method: "POST",
        url: "/api/printers",
        payload: { name: "P1", modelId: modelIdFor(a.db, "Bambu Lab", "P1S") },
      })
    ).json();
    mkdirSync(join(a.dataDir, "photos"));
    writeFileSync(join(a.dataDir, "photos", "x.png"), "img");
    writeFileSync(join(a.dataDir, "secret.key"), "k".repeat(32));

    const made = (await a.app.inject({ method: "POST", url: "/api/backups" })).json();
    expect(made.name).toMatch(/^backup-\d{14}\.zip$/);
    const zip = (await a.app.inject(`/api/backups/${made.name}`)).rawPayload;
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    await a.app.close();

    // Fresh install: upload the file, confirm, "restart".
    const b = await mk("b");
    const bad = await b.app.inject({
      method: "POST",
      url: "/api/backups/upload",
      headers: { "content-type": "application/zip" },
      payload: Buffer.from("not a zip"),
    });
    expect(bad.statusCode).toBe(400);

    const up = await b.app.inject({
      method: "POST",
      url: "/api/backups/upload",
      headers: { "content-type": "application/zip" },
      payload: zip,
    });
    expect(up.statusCode).toBe(201);
    const url = `/api/backups/${up.json().name}/restore`;
    expect((await b.app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(400);
    expect(
      (await b.app.inject({ method: "POST", url, payload: { confirm: true } })).json(),
    ).toEqual({ restartRequired: true });
    await b.app.close();
    b.db.$client.close();

    expect(applyPendingRestore(b.dataDir)).toBe(true);
    const restored = openDb(join(b.dataDir, "app.sqlite"));
    opened.push(restored);
    const app = await buildApp(restored, false, b.dataDir);
    expect((await app.inject("/api/printers")).json().items).toMatchObject([{ id: printer.id }]);
    expect(readFileSync(join(b.dataDir, "photos", "x.png"), "utf8")).toBe("img");
    expect(existsSync(join(b.dataDir, "restore-pending"))).toBe(false);
    await app.close();
  });

  it("rejects a backup from a newer format", async () => {
    const a = await mk("a");
    const yazl = (await import("yazl")).default;
    const z = new yazl.ZipFile();
    z.addBuffer(
      Buffer.from(JSON.stringify({ format: 99, app: "3d-maker-suite" })),
      "manifest.json",
    );
    z.addBuffer(Buffer.from("x"), "app.sqlite");
    z.end();
    const chunks: Buffer[] = [];
    for await (const c of z.outputStream) chunks.push(c as Buffer);
    const res = await a.app.inject({
      method: "POST",
      url: "/api/backups/upload",
      headers: { "content-type": "application/zip" },
      payload: Buffer.concat(chunks),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/newer version/);
  });

  it("exports CSV and JSON", async () => {
    const a = await mk("a");
    await a.app.inject({
      method: "POST",
      url: "/api/printers",
      payload: { name: 'P "1"', modelId: modelIdFor(a.db, "Bambu Lab", "P1S") },
    });
    await a.app.inject({
      method: "POST",
      url: "/api/printers",
      payload: { name: "=1+1", modelId: modelIdFor(a.db, "Bambu Lab", "P1S") },
    });
    const csv = (await a.app.inject("/api/export/printers")).body;
    expect(csv).toContain('"P ""1"""');
    expect(csv).toContain(",'=1+1,");
    expect((await a.app.inject("/api/export/printers?format=json")).json()).toHaveLength(2);
    expect((await a.app.inject("/api/export/integrations")).statusCode).toBe(400);
  });
});
