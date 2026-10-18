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
  const csv =
    "name,brand,model,lifetimeHours,includeMaintenanceCost\nA,Bambu Lab,X1C,1500,no\nB,Bambu Lab,X1C,,\n";
  const first = (
    await post("/api/import/printers/preview", csv, "text/csv")
  ).json() as ImportPreview;
  await post("/api/import/printers/apply", {
    uploadId: first.uploadId,
    policy: "overwrite",
    decisions: first.rows.map((r) => ({ row: r.row, action: "create" })),
  });
  // Cost settings: set on A, empty (= the Costs defaults) on B.
  const made = (await app.inject({ url: "/api/printers?sort=name" })).json().items;
  expect(made).toMatchObject([
    { name: "A", lifetimeHours: 1500, includeMaintenanceCost: false },
    { name: "B", lifetimeHours: null, includeMaintenanceCost: null },
  ]);

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

it("imports accessories: create, export round trip, update by number", async () => {
  const preview = async (csv: string) =>
    (await post("/api/import/accessories/preview", csv, "text/csv")).json() as ImportPreview;
  const apply = (p: ImportPreview) =>
    post("/api/import/accessories/apply", {
      uploadId: p.uploadId,
      policy: "overwrite",
      decisions: p.rows
        .filter((r) => r.action !== "skip")
        .map((r) => ({ row: r.row, action: r.action, targetId: r.targetId ?? undefined })),
    });

  const first = await preview(
    "name,type,purchasePrice,countInCosts,lifetimeHours,includeMaintenanceCost\n" +
      "AMS,AMS,349.00,yes,3000,no\nHotend,Hotend,,,,\n,AMS,,,,\n",
  );
  // The third row has no name: invalid.
  expect(first.rows.map((r) => r.status)).toEqual(["new", "new", "invalid"]);
  expect((await apply(first)).json()).toMatchObject({ created: 2 });
  const list = () => app.inject({ url: "/api/accessories?sort=name" }).then((r) => r.json().items);
  expect(await list()).toMatchObject([
    {
      number: 1,
      name: "AMS",
      purchasePrice: 34900,
      countInCosts: true,
      lifetimeHours: 3000,
      includeMaintenanceCost: false,
    },
    { number: 2, name: "Hotend", countInCosts: null, lifetimeHours: null },
  ]);

  // What the export writes comes back identical.
  const [head, ...rows] = await readXlsx(
    (await post("/api/import/accessories/export", labels)).rawPayload,
  );
  const again = await preview([head, ...rows].map((r) => r?.cells.join(",")).join("\n"));
  expect(again.rows.map((r) => r.status)).toEqual(["identical", "identical"]);

  // A row with a number updates that accessory.
  const p = await preview("number,name,type,countInCosts\n2,Hotend,Hotend,no\n");
  expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
  expect((await apply(p)).json()).toMatchObject({ updated: 1 });
  expect((await list())[1]).toMatchObject({ number: 2, countInCosts: false });
});
