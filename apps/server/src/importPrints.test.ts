import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportEntity, ImportPreview } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { printImport } from "./import/prints.ts";
import { filamentProfileIdFor } from "./lib/catalog.ts";

let dataDir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "import-prints-"));
  db = openDb(join(dataDir, "app.sqlite"));
  app = await buildApp(db, false, dataDir);
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// Headers are the column keys, which a file may use in any language.
const preview = async (entity: ImportEntity, csv: string) =>
  (
    await app.inject({
      method: "POST",
      url: `/api/import/${entity}/preview`,
      headers: { "content-type": "text/csv" },
      payload: csv,
    })
  ).json() as ImportPreview;
/** Applies the suggested action of every row that isn't skipped or invalid. */
const applySuggested = async (entity: ImportEntity, p: ImportPreview) =>
  app.inject({
    method: "POST",
    url: `/api/import/${entity}/apply`,
    payload: {
      uploadId: p.uploadId,
      policy: "overwrite",
      decisions: p.rows
        .filter((r) => r.action !== "skip")
        .map((r) => ({
          row: r.row,
          action: r.action,
          targetId: r.action === "update" ? (r.targetId ?? undefined) : undefined,
        })),
    },
  });
const statuses = (p: ImportPreview) => p.rows.map((r) => r.status);

const PRINTERS = "name,brand,model,serial,powerW\nBox,Bambu Lab,A1,SN1,150\nShelf,Bambu Lab,P1S,,";
const PRINT_HEAD = "printer,title,startedAt,durationSec,outcome,spool,grams";

describe("printer import", () => {
  it("creates printers with their brand and model, then sees them as identical", async () => {
    const first = await preview("printers", PRINTERS);
    expect(statuses(first)).toEqual(["new", "new"]);
    expect(first.missing).toEqual({
      brands: ["Bambu Lab"],
      printerModels: ["Bambu Lab A1", "Bambu Lab P1S"],
    });
    expect((await applySuggested("printers", first)).json()).toMatchObject({ created: 2 });
    expect(db.select().from(schema.brands).all()).toHaveLength(1);

    expect(statuses(await preview("printers", PRINTERS))).toEqual(["identical", "identical"]);
  });

  it("matches on serial before name, so a renamed printer is an update", async () => {
    await applySuggested("printers", await preview("printers", PRINTERS));
    const p = await preview("printers", "name,brand,model,serial\nOffice,Bambu Lab,A1,sn1");
    expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
    await applySuggested("printers", p);
    const names = db
      .select()
      .from(schema.printers)
      .all()
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(["Office", "Shelf"]);
  });

  it("numbers printers, and a row with a number is that printer", async () => {
    await applySuggested("printers", await preview("printers", PRINTERS));
    const numbers = () =>
      db
        .select()
        .from(schema.printers)
        .all()
        .map((r) => [r.number, r.name]);
    expect(numbers()).toEqual([
      [1, "Box"],
      [2, "Shelf"],
    ]);
    const p = await preview("printers", "number,name,brand,model\n2,Desk,Bambu Lab,P1S");
    expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
    await applySuggested("printers", p);
    expect(numbers()).toEqual([
      [1, "Box"],
      [2, "Desk"],
    ]);
  });

  it("doesn't take a printer with another serial for the same name", async () => {
    await applySuggested("printers", await preview("printers", PRINTERS));
    const p = await preview("printers", "name,brand,model,serial\nBox,Bambu Lab,A1,SN2");
    expect(p.rows[0]).toMatchObject({ status: "new", candidates: [] });
  });
});

describe("print import", () => {
  const setup = async () => {
    await applySuggested("printers", await preview("printers", PRINTERS));
    const profileId = filamentProfileIdFor(db, { brand: "Acme", material: "PLA", name: "Basic" });
    const spool = (
      await app.inject({
        method: "POST",
        url: "/api/filament/spools",
        payload: { profileId, colorHex: "#000000", initialGrams: 1000 },
      })
    ).json();
    return spool as { id: string };
  };
  const remaining = (id: string) =>
    db
      .select()
      .from(schema.spools)
      .all()
      .find((s) => s.id === id)?.remainingGrams;
  const FILE = `${PRINT_HEAD}\nbox,Benchy,2026-03-04 10:00,3600,success,001-Basic #000000,12.5`;

  it("books the print and its filament, and a second import changes nothing", async () => {
    const spool = await setup();
    const first = await preview("prints", FILE);
    expect(first.rows[0]).toMatchObject({
      status: "new",
      values: { startedAt: "2026-03-04T10:00:00Z" },
    });
    expect((await applySuggested("prints", first)).json()).toMatchObject({ created: 1 });
    expect(remaining(spool.id)).toBe(987.5);
    // Estimated from the printer's 150 W.
    expect(db.select().from(schema.prints).get()).toMatchObject({
      energyWh: 150,
      energySource: "estimated",
    });

    expect(statuses(await preview("prints", FILE))).toEqual(["identical"]);
  });

  it("numbers prints, and a row with a number is that print", async () => {
    await setup();
    await applySuggested("prints", await preview("prints", FILE));
    expect(db.select().from(schema.prints).get()?.number).toBe(1);
    const renamed = `number,${PRINT_HEAD}\n1,box,Renamed,2026-03-04 10:00,3600,success,001-Basic #000000,12.5`;
    const p = await preview("prints", renamed);
    expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
  });

  it("creates a project it doesn't know, without a folder, once per name", async () => {
    await setup();
    const row = (cell: string, title = "Benchy") =>
      `${cell},box,${title},2026-03-04 10:00,3600,success,001-Basic #000000,12.5`;
    const proj = (cell: string) => `project,${PRINT_HEAD}\n${row(cell)}`;
    const p = await preview("prints", `${proj("5-bucket")}\n${row("5-bucket", "Other")}`);
    expect(p.missing).toEqual({ projects: ["5-bucket"] });
    expect(statuses(p)).toEqual(["new", "new"]);
    await applySuggested("prints", p);
    const projects = db.select().from(schema.projects).all();
    expect(projects).toMatchObject([{ number: 5, name: "bucket", folderPath: null }]);
    const linked = db
      .select()
      .from(schema.prints)
      .all()
      .map((r) => r.projectId);
    expect(linked).toEqual([projects[0]?.id, projects[0]?.id]);
    // Known now: by display name, number or name, and nothing is announced.
    for (const cell of ["005-bucket", "5", "BUCKET"])
      expect((await preview("prints", proj(cell))).missing).toEqual({});
    expect(printImport.refs(db).projects).toEqual(["005-bucket"]);
  });

  it("finds a printer by its display name, its number or its name", async () => {
    await setup();
    for (const printer of ["01-Box", "1", "01", "box"])
      expect(statuses(await preview("prints", FILE.replace("box,", `${printer},`)))).toEqual([
        "new",
      ]);
    expect(statuses(await preview("prints", FILE.replace("box,", "9,")))).toEqual(["invalid"]);
    expect(printImport.refs(db).printers).toEqual(["01-Box", "02-Shelf"]);
  });

  it("finds a spool by its number alone, and the template lists spools by display name", async () => {
    const spool = await setup();
    await applySuggested("prints", await preview("prints", FILE.replace("001-Basic #000000", "1")));
    expect(remaining(spool.id)).toBe(987.5);
    expect(printImport.refs(db).spools).toEqual(["001-Basic #000000"]);
  });

  it("a changed duration updates the print and leaves the spool alone", async () => {
    const spool = await setup();
    await applySuggested("prints", await preview("prints", FILE));
    const p = await preview("prints", FILE.replace(",3600,", ",7200,"));
    expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
    await applySuggested("prints", p);
    expect(db.select().from(schema.prints).get()?.durationSec).toBe(7200);
    expect(remaining(spool.id)).toBe(987.5);
  });

  it("rejects an unknown printer and sends an unknown spool to the filament review queue", async () => {
    await setup();
    const p = await preview(
      "prints",
      `${PRINT_HEAD}\nNope,A,2026-03-04 10:00,,success,,\nbox,B,2026-03-05 10:00,,failed,Mystery spool,5\nbox,C,2026-03-06 10:00,,success,001-Basic #000000,`,
    );
    expect(statuses(p)).toEqual(["invalid", "new", "invalid"]);
    expect(p.rows[0]?.errors).toEqual([{ column: "printer", code: "unresolved" }]);
    expect(p.rows[2]?.errors).toEqual([{ column: "grams", code: "required" }]);

    await applySuggested("prints", p);
    expect(db.select().from(schema.printFilamentUsages).all()).toMatchObject([
      { spoolId: null, grams: 5, material: "Mystery spool", dismissed: false },
    ]);
  });

  describe("multicolor", () => {
    const HEAD = `${PRINT_HEAD},spool2,grams2,spool3,grams3,trackUsage`;
    const second = async () => {
      const profileId = filamentProfileIdFor(db, {
        brand: "Acme",
        material: "PETG",
        name: "Tough",
      });
      return (
        await app.inject({
          method: "POST",
          url: "/api/filament/spools",
          payload: { profileId, colorHex: "#ffffff", initialGrams: 500 },
        })
      ).json() as { id: string };
    };
    const row = (extra: string, track = "") =>
      `${HEAD}\nbox,Multi,2026-03-04 10:00,3600,success,001-Basic #000000,10,002-Tough #ffffff,5,${extra},${track}`;

    it("books one usage per color and takes each from its own spool", async () => {
      const a = await setup();
      const b = await second();
      const p = await preview("prints", row(","));
      expect(p.rows[0]).toMatchObject({ status: "new" });
      await applySuggested("prints", p);
      expect(db.select().from(schema.printFilamentUsages).all()).toHaveLength(2);
      expect(remaining(a.id)).toBe(990);
      expect(remaining(b.id)).toBe(495);
      expect(statuses(await preview("prints", row(",")))).toEqual(["identical"]);
    });

    it("saves the usages but leaves the spools alone when track usage is no", async () => {
      const a = await setup();
      const b = await second();
      const p = await preview("prints", row(",", "no"));
      await applySuggested("prints", p);
      expect(db.select().from(schema.printFilamentUsages).all()).toHaveLength(2);
      expect(remaining(a.id)).toBe(1000);
      expect(remaining(b.id)).toBe(500);
      // The flag is an instruction, not data: the same file is still identical.
      expect(statuses(await preview("prints", row(",", "no")))).toEqual(["identical"]);
    });

    it("updates a print's colors and nets the ledger", async () => {
      const a = await setup();
      const b = await second();
      await applySuggested("prints", await preview("prints", row(",")));
      const p = await preview("prints", row(",").replace(",5,", ",8,"));
      expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
      await applySuggested("prints", p);
      expect(remaining(a.id)).toBe(990);
      expect(remaining(b.id)).toBe(492);
    });

    it("sends an unknown color to the review queue and flags a missing weight", async () => {
      const a = await setup();
      const p = await preview(
        "prints",
        `${HEAD}\nbox,A,2026-03-04 10:00,,success,001-Basic #000000,10,Mystery,5,,,\nbox,B,2026-03-05 10:00,,success,,,,,001-Basic #000000,,`,
      );
      expect(statuses(p)).toEqual(["new", "invalid"]);
      expect(p.rows[1]?.errors).toEqual([{ column: "grams3", code: "required" }]);
      await applySuggested("prints", p);
      expect(remaining(a.id)).toBe(990);
      expect(
        db
          .select()
          .from(schema.printFilamentUsages)
          .all()
          .filter((u) => !u.spoolId),
      ).toMatchObject([{ grams: 5, material: "Mystery" }]);
    });

    it("takes up to 16 colors", async () => {
      await setup();
      const slots = Array.from({ length: 16 }, (_, i) => {
        const n = i + 1;
        return [n === 1 ? "spool" : `spool${n}`, n === 1 ? "grams" : `grams${n}`];
      });
      const csv = `printer,title,startedAt,outcome,${slots.flat().join(",")},spool17\nbox,Rainbow,2026-03-04 10:00,success,${slots.map(() => "001-Basic #000000,1").join(",")},x`;
      const p = await preview("prints", csv);
      expect(p.ignoredHeaders).toEqual(["spool17"]);
      await applySuggested("prints", p);
      expect(db.select().from(schema.printFilamentUsages).all()).toHaveLength(16);
    });
  });

  it("previews 10,000 rows in one go", async () => {
    await setup();
    const rows = Array.from({ length: 10_000 }, (_, i) => {
      const at = new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString().slice(0, 16);
      return `box,Print ${i},${at},600,success,,`;
    });
    const started = Date.now();
    const p = await preview("prints", `${PRINT_HEAD}\n${rows.join("\n")}`);
    expect(p.rows).toHaveLength(10_000);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
