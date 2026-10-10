import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportPreview, ImportRun } from "@3d-maker-suite/core";
import { openDb } from "@3d-maker-suite/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { readXlsx } from "./lib/sheet.ts";

let dataDir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "import-export-"));
  db = openDb(join(dataDir, "app.sqlite"));
  app = await buildApp(db, false, dataDir);
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const post = (url: string, payload: unknown, type = "application/json") =>
  app.inject({
    method: "POST",
    url,
    headers: { "content-type": type },
    payload: payload as string,
  });
const labels = {
  sheets: { data: "d", lists: "l", instructions: "i" },
  instructions: [["x"]],
  labels: {},
};

it("export → edit → import updates only the edited row and is logged", async () => {
  const csv = "name,brand,model\nA,Bambu Lab,X1C\nB,Bambu Lab,X1C\n";
  const first = (
    await post("/api/import/printers/preview", csv, "text/csv")
  ).json() as ImportPreview;
  await post("/api/import/printers/apply", {
    uploadId: first.uploadId,
    policy: "overwrite",
    decisions: first.rows.map((r) => ({ row: r.row, action: "create" })),
  });

  const ex = await post("/api/import/printers/export", labels);
  expect(ex.statusCode, ex.body).toBe(200);
  const xlsx = ex.rawPayload;
  const [head, ...rows] = await readXlsx(xlsx);
  expect(head?.cells[0]).toBe("id");
  const nameAt = head?.cells.findIndex((c) => String(c).startsWith("name")) ?? -1;
  (rows[0] as { cells: unknown[] }).cells[nameAt] = "Renamed";
  const edited = [head, ...rows].map((r) => r?.cells.join(",")).join("\n");

  const p = (
    await post("/api/import/printers/preview?fileName=p.csv", edited, "text/csv")
  ).json() as ImportPreview;
  expect(p.rows.map((r) => r.status).sort()).toEqual(["changed", "identical"]);
  const res = await post("/api/import/printers/apply", {
    uploadId: p.uploadId,
    policy: "overwrite",
    decisions: p.rows
      .filter((r) => r.action !== "skip")
      .map((r) => ({ row: r.row, action: r.action, targetId: r.targetId })),
  });
  expect(res.json()).toMatchObject({ created: 0, updated: 1 });

  const runs = (await app.inject({ url: "/api/import/runs" })).json() as ImportRun[];
  expect(runs[0]).toMatchObject({ type: "printers", fileName: "p.csv", updated: 1, skipped: 1 });
});
