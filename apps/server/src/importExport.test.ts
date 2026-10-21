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

/** Previews a CSV, applies what the review suggests and returns the preview. */
async function load(entity: string, csv: string) {
  const p = (await post(`/api/import/${entity}/preview`, csv, "text/csv")).json() as ImportPreview;
  const rows = p.rows.filter((r) => r.action !== "skip");
  if (rows.length)
    expect(
      (
        await post(`/api/import/${entity}/apply`, {
          uploadId: p.uploadId,
          policy: "overwrite",
          decisions: rows.map((r) => ({
            row: r.row,
            action: r.action,
            ...(r.targetId && { targetId: r.targetId }),
          })),
        })
      ).statusCode,
    ).toBe(200);
  return p;
}
const get = async (url: string) => (await app.inject({ url })).json();
/** The export of an entity, read back as the CSV a person would save from it. */
const exported = async (entity: string) => {
  const rows = await readXlsx((await post(`/api/import/${entity}/export`, labels)).rawPayload);
  return rows.map((r) => r.cells.join(",")).join("\n");
};

it("imports clients by mobile, email or VAT, and the export comes back identical", async () => {
  await load("clients", "name,mobile,email,vat\nAna,911,ana@x.pt,1\nBruno,922,,2\n");
  expect((await get("/api/clients?sort=name")).items).toMatchObject([
    { name: "Ana", mobile: "911", email: "ana@x.pt" },
    { name: "Bruno", mobile: "922", email: null },
  ]);
  const again = await load("clients", await exported("clients"));
  expect(again.rows.map((r) => r.status)).toEqual(["identical", "identical"]);

  // The same mobile with a new name is that client, renamed; a bad email is an invalid row.
  const p = await load("clients", "name,mobile\nAna Silva,911\n");
  expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
  expect((await get("/api/clients?sort=name")).items[0]).toMatchObject({ name: "Ana Silva" });
  const bad = await load("clients", "name,mobile,email\nCarla,933,nope\n");
  expect(bad.rows[0]).toMatchObject({ status: "invalid", errors: [{ column: "email" }] });
});

it("imports quotes and orders, refusing references that don't exist, and round-trips", async () => {
  await load("clients", "name,mobile\nAna,911\n");
  const [box, lid] = await Promise.all(
    ["Box", "Lid"].map(async (name) => (await post("/api/projects", { name })).json()),
  );
  expect([box.number, lid.number]).toEqual([1, 2]);

  // A quote is a typed-in print: unit cost 10.00, 2 prints, 10% markup → 11.00 each.
  const q = await load(
    "quotes",
    "number,name,client,project,unitCost,quantity,failureMarginPct,markupPct\n7,Vase,Ana,1-Box,10,2,0,10\n" +
      "8,Ghost,Nobody,,5,1,0,0\n",
  );
  expect(q.rows[1]).toMatchObject({ status: "invalid", errors: [{ column: "client" }] });
  const quotes = (await get("/api/costs/quotes")).items;
  expect(quotes).toHaveLength(1);
  expect(quotes[0]).toMatchObject({
    number: 7,
    name: "Vase",
    projectId: box.id,
    quote: { unitCost: 1000, unitPrice: 1100, quantity: 2, total: 2200 },
    form: { quantity: 2, markupPct: 10, filaments: [{ grams: 1000, price: 10 }] },
  });
  expect((await load("quotes", await exported("quotes"))).rows[0]?.status).toBe("identical");

  // A changed price is worked out again; the quote keeps its number.
  await load("quotes", "number,name,unitCost\n7,Vase,20\n");
  expect((await get("/api/costs/quotes")).items[0]).toMatchObject({
    number: 7,
    quote: { unitCost: 2000, unitPrice: 2200, total: 4400 },
  });

  // An order names its client, quote and projects (several, `;` apart); unknown ones are invalid.
  const o = await load(
    "orders",
    "number,client,quote,project,price,status\n" +
      "3,Ana,7,1-Box; 2-Lid,50,done\n" +
      "4,Ana,99,Box,10,\n" +
      "5,Ana,,Box,10,lost\n" +
      "6,Ana,,Nope,10,\n",
  );
  expect(o.rows.map((r) => r.status)).toEqual(["new", "invalid", "invalid", "invalid"]);
  expect(o.rows.slice(1).map((r) => r.errors[0]?.column)).toEqual(["quote", "status", "project"]);
  const orders = (await get("/api/orders")).items;
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({
    number: 3,
    clientId: (await get("/api/clients")).items[0].id,
    quoteId: quotes[0].id,
    price: 5000,
    status: "done",
  });
  expect([...orders[0].projectIds].sort()).toEqual([box.id, lid.id].sort());
  expect((await load("orders", await exported("orders"))).rows[0]?.status).toBe("identical");

  // The order moves to another project.
  await load("orders", "number,project,price\n3,2-Lid,50\n");
  expect((await get("/api/orders")).items[0].projectIds).toEqual([lid.id]);
});

it("imports accessory installs: round trip, bad references and overlaps are invalid rows", async () => {
  await load("printers", "name,brand,model\nA,Bambu Lab,X1C\nB,Bambu Lab,X1C\n");
  await load("accessories", "name,type\nAMS,AMS\n");
  const head = "accessory,printer,installedAt,removedAt\n";
  const first = await load(
    "accessoryInstalls",
    `${head}1-AMS,1-A,2026-01-01,2026-02-01\nams,B,2026-03-01,\n`,
  );
  expect(first.rows.map((r) => r.status)).toEqual(["new", "new"]);
  const accessory = (await get("/api/accessories")).items[0];
  const installs = await get(`/api/accessories/${accessory.id}/installs`);
  expect(installs).toMatchObject([
    { printerLabel: "02-B", removedAt: null },
    { printerLabel: "01-A", removedAt: "2026-02-01T12:00:00.000Z" },
  ]);

  // What the export writes comes back identical (the open install overlaps nothing but itself).
  const again = await load("accessoryInstalls", await exported("accessoryInstalls"));
  expect(again.rows.map((r) => r.status)).toEqual(["identical", "identical"]);

  const bad = await load(
    "accessoryInstalls",
    `${head}Nobody,A,2026-05-01,\nAMS,Nobody,2026-05-01,\nAMS,A,2026-01-15,2026-01-20\nAMS,A,2026-04-01,2026-03-01\nAMS,A,2026-06-01,\n`,
  );
  expect(bad.rows.map((r) => r.errors)).toEqual([
    [{ column: "accessory", code: "unresolved" }],
    [{ column: "printer", code: "unresolved" }],
    [{ column: "installedAt", code: "overlap" }],
    [{ column: "removedAt", code: "before_install" }],
    [{ column: "installedAt", code: "overlap" }],
  ]);

  // The open install gets its removal day: an update, matched on accessory, printer and day.
  const closed = await load("accessoryInstalls", `${head}AMS,B,2026-03-01,2026-04-01\n`);
  expect(closed.rows[0]).toMatchObject({ status: "changed", action: "update" });
  expect((await get(`/api/accessories/${accessory.id}/installs`))[0]).toMatchObject({
    removedAt: "2026-04-01T12:00:00.000Z",
  });
});
