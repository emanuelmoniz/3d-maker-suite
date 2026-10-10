import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportEntity, ImportPreview } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
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
  const FILE = `${PRINT_HEAD}\nbox,Benchy,2026-03-04 10:00,3600,success,Acme PLA Basic,12.5`;

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
      `${PRINT_HEAD}\nNope,A,2026-03-04 10:00,,success,,\nbox,B,2026-03-05 10:00,,failed,Mystery spool,5\nbox,C,2026-03-06 10:00,,success,Acme PLA Basic,`,
    );
    expect(statuses(p)).toEqual(["invalid", "new", "invalid"]);
    expect(p.rows[0]?.errors).toEqual([{ column: "printer", code: "unresolved" }]);
    expect(p.rows[2]?.errors).toEqual([{ column: "grams", code: "required" }]);

    await applySuggested("prints", p);
    expect(db.select().from(schema.printFilamentUsages).all()).toMatchObject([
      { spoolId: null, grams: 5, material: "Mystery spool", dismissed: false },
    ]);
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
