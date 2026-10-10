import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMPORT_COLUMNS, type ImportPreview } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { listBackups } from "./backup/backup.ts";
import { filamentProfileIdFor } from "./lib/catalog.ts";
import { XLSX_TYPE } from "./lib/sheet.ts";

let dataDir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "import-"));
  db = openDb(join(dataDir, "app.sqlite"));
  app = await buildApp(db, false, dataDir);
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// Headers as a translated UI would send them.
const labels = Object.fromEntries(IMPORT_COLUMNS.spools.map((c) => [c.key, `${c.key} label`]));
const query = `?labels=${encodeURIComponent(JSON.stringify(labels))}`;

const spool = async (colorHex: string, over: Record<string, unknown> = {}) =>
  (
    await app.inject({
      method: "POST",
      url: "/api/filament/spools",
      payload: {
        profileId: filamentProfileIdFor(db, { brand: "Acme", material: "PLA", name: "Basic" }),
        colorHex,
        initialGrams: 1000,
        ...over,
      },
    })
  ).json();
const getSpool = async (id: string) => (await app.inject(`/api/filament/spools/${id}`)).json();
const spoolCount = () => db.select().from(schema.spools).all().length;

const template = async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/import/spools/template",
    payload: {
      labels,
      sheets: { data: "Spools", lists: "Lists", instructions: "Instructions" },
      instructions: [["How to fill this in"], ["material label", "Required"]],
    },
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
  return { res, wb };
};
const previewOf = async (payload: Buffer | string, type = XLSX_TYPE) =>
  app.inject({
    method: "POST",
    url: `/api/import/spools/preview${query}`,
    headers: { "content-type": type },
    payload,
  });
const csv = async (text: string) => (await previewOf(text, "text/csv")).json() as ImportPreview;
const apply = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/import/spools/apply", payload });

describe("import", () => {
  it("the template has the columns, the dropdowns and the instructions", async () => {
    await spool("#000000");
    const { res, wb } = await template();
    expect(res.headers["content-type"]).toBe(XLSX_TYPE);
    type Sheet = ExcelJS.Worksheet;
    const [data, help, lists] = wb.worksheets as [Sheet, Sheet, Sheet];
    expect((data.getRow(1).values as string[]).slice(1, 4)).toEqual([
      "brand label",
      "material label *",
      "profile label",
    ]);
    const column = (key: string) => IMPORT_COLUMNS.spools.findIndex((c) => c.key === key) + 1;
    expect(data.getCell(2, column("status")).dataValidation).toMatchObject({
      type: "list",
      showErrorMessage: true,
      formulae: ['"new,in_use,empty"'],
    });
    // Names you have are offered, and a new one can still be typed.
    const brand = data.getCell(2, column("brand")).dataValidation;
    expect(brand.formulae).toEqual(["'Lists'!$A$2:$A$2"]);
    expect(brand.showErrorMessage).toBeFalsy();
    expect(lists.getColumn(1).values).toEqual([undefined, "brand label", "Acme"]);
    expect(help.getCell("A1").value).toBe("How to fill this in");
  });

  it("a filled template previews, a matched row merges into the picked spool", async () => {
    const black = await spool("#000000", { location: "Shelf" });
    const green = await spool("#00ff00");
    const white = [await spool("#ffffff"), await spool("#ffffff")];

    const { wb } = await template();
    const sheet = wb.worksheets[0] as ExcelJS.Worksheet;
    const fill = (row: number, cells: Record<string, unknown>) => {
      for (const [i, c] of IMPORT_COLUMNS.spools.entries())
        if (c.key in cells) sheet.getCell(row, i + 1).value = cells[c.key] as ExcelJS.CellValue;
    };
    const acme = { brand: "acme", material: "PLA", profile: "Basic", initialGrams: 1000 };
    fill(2, { brand: "Other", material: "PETG", colorHex: "FF0000", initialGrams: 750 });
    fill(3, { ...acme, colorHex: "#000000", location: "Shelf" });
    fill(4, {
      ...acme,
      colorHex: "#00ff00",
      remainingGrams: 400,
      location: "Box",
      purchasedAt: new Date(Date.UTC(2026, 2, 4)),
      pricePaid: 19.99,
    });
    fill(5, { ...acme, colorHex: "#ffffff", initialGrams: 500, location: "Drawer" });
    fill(6, { ...acme, purchasedAt: "04/03/2026", status: "gone" });

    const res = await previewOf(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.statusCode).toBe(200);
    const preview = res.json() as ImportPreview;
    expect(preview.rows.map((r) => [r.row, r.status, r.action, r.targetId])).toEqual([
      [2, "new", "create", null],
      [3, "identical", "skip", black.id],
      [4, "changed", "update", green.id],
      [5, "ambiguous", "skip", null],
      [6, "invalid", "skip", null],
    ]);
    expect(preview.rows[2]?.values).toMatchObject({ purchasedAt: "2026-03-04", pricePaid: 1999 });
    expect(preview.rows[3]?.candidates.sort()).toEqual(white.map((w) => w.id).sort());
    expect(preview.rows[4]?.errors).toEqual([
      { column: "purchasedAt", code: "not_a_date" },
      { column: "status", code: "not_an_option" },
    ]);
    expect(preview.missing).toEqual({
      filamentBrands: ["Other"],
      filamentMaterials: ["PETG"],
      filamentProfiles: ["Other PETG"],
    });
    expect(preview.targets).toHaveLength(4);
    expect(spoolCount()).toBe(4); // a preview writes nothing

    const done = await apply({
      uploadId: preview.uploadId,
      policy: "overwrite",
      decisions: [
        { row: 2, action: "create" },
        { row: 4, action: "update", targetId: green.id },
        // Picked by hand; only the fields that spool lacks are filled.
        { row: 5, action: "update", targetId: white[1].id, policy: "fill" },
      ],
    });
    expect(done.json()).toMatchObject({ created: 1, updated: 2 });
    expect(listBackups(dataDir).map((b) => b.name)).toEqual([done.json().backup]);
    expect(spoolCount()).toBe(5);

    expect(await getSpool(green.id)).toMatchObject({
      remainingGrams: 400,
      location: "Box",
      pricePaid: 1999,
      purchasedAt: "2026-03-04T12:00:00.000Z",
    });
    const history = (await app.inject(`/api/filament/spools/${green.id}/history`)).json();
    expect(history[0]).toMatchObject({ kind: "correction", deltaGrams: -600 });
    expect(await getSpool(white[1].id)).toMatchObject({ location: "Drawer", initialGrams: 1000 });
    expect(await getSpool(white[0].id)).toMatchObject({ location: null });

    const created = db
      .select()
      .from(schema.spools)
      .all()
      .find((s) => s.colorHex === "#ff0000");
    expect(created).toMatchObject({ initialGrams: 750, remainingGrams: 750, status: "new" });
    const profiles = (await app.inject("/api/filament/profiles")).json();
    expect(profiles.items.map((p: { brand: string }) => p.brand).sort()).toEqual(["Acme", "Other"]);
    // The upload is gone once applied.
    expect(
      (
        await apply({
          uploadId: preview.uploadId,
          policy: "fill",
          decisions: [{ row: 2, action: "create" }],
        })
      ).statusCode,
    ).toBe(404);
  });

  it("reads a ; CSV with translated headers and decimal commas", async () => {
    const preview = await csv(
      "material label *;initialGrams;pricePaid label;Notes\r\nPLA;750,5;19,99;x\r\n;;;\r\n",
    );
    expect(preview.ignoredHeaders).toEqual(["Notes"]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      row: 2,
      status: "new",
      values: { material: "PLA", initialGrams: 750.5, pricePaid: 1999 },
    });
  });

  it("rejects a file it can't read or without a known column", async () => {
    expect((await previewOf(Buffer.from("not a workbook"))).json().error.code).toBe("invalid_file");
    expect((await previewOf("foo,bar\n1,2\n", "text/csv")).json().error.code).toBe("no_columns");
  });

  it("apply is all-or-nothing", async () => {
    const black = await spool("#000000");
    const preview = await csv(
      "brand,material,initialGrams,location\nNew,PLA,500,ok\nNew,PLA,500,boom\nNew,PLA,x,bad\n",
    );
    const body = (decisions: unknown[]) =>
      apply({ uploadId: preview.uploadId, policy: "overwrite", decisions });

    // A decision that can't stand rejects the request before anything happens.
    for (const [code, decisions] of [
      [
        "invalid_row",
        [
          { row: 2, action: "create" },
          { row: 4, action: "create" },
        ],
      ],
      ["target_not_found", [{ row: 2, action: "update" }]],
      [
        "duplicate_decision",
        [
          { row: 2, action: "update", targetId: black.id },
          { row: 3, action: "update", targetId: black.id },
        ],
      ],
    ] as const)
      expect((await body([...decisions])).json().error.code).toBe(code);
    expect(listBackups(dataDir)).toEqual([]);

    // A write that fails halfway takes the earlier rows (and the new brand) with it.
    db.$client.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON spools WHEN NEW.location = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const failed = await body([
      { row: 2, action: "create" },
      { row: 3, action: "create" },
    ]);
    expect(failed.statusCode).toBe(500);
    expect(spoolCount()).toBe(1);
    expect(
      db
        .select()
        .from(schema.filamentBrands)
        .all()
        .map((b) => b.name),
    ).toEqual(["Acme"]);
    expect(listBackups(dataDir)).toHaveLength(1);

    db.$client.exec("DROP TRIGGER boom");
    expect((await body([{ row: 2, action: "create" }])).json()).toMatchObject({ created: 1 });
  });
});
