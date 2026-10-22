import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ImportEntity, type ImportPreview, NO_PROJECT } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { printImport } from "./import/prints.ts";
import { filamentProfileIdFor } from "./lib/catalog.ts";
import { linkPrints } from "./projects/linkPrints.ts";

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
/** The project a person picks for a print the file names none for. */
const someProject = () =>
  db.select().from(schema.projects).get()?.id ??
  db.insert(schema.projects).values({ number: 999, name: "misc" }).returning().get().id;
/**
 * Applies the suggested action of every row that isn't skipped or invalid, with the suggested
 * picks; a print that needs a project gets one, as a person would pick it.
 */
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
          refs:
            r.action === "create" && r.refs
              ? Object.fromEntries(
                  Object.entries(r.refs)
                    .map(([k, v]) => [k, k === "project" ? (v ?? someProject()) : v])
                    .filter(([, v]) => v),
                )
              : undefined,
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

/** A spool entered before the prints of the tests (2026-03), so they take from it. */
const backdate = (spool: { id: string }) => {
  db.update(schema.spools)
    .set({ createdAt: "2026-01-01T00:00:00.000Z" })
    .where(eq(schema.spools.id, spool.id))
    .run();
  return spool;
};

describe("print import", () => {
  const setup = async (entered = true) => {
    await applySuggested("printers", await preview("printers", PRINTERS));
    const profileId = filamentProfileIdFor(db, { brand: "Acme", material: "PLA", name: "Basic" });
    const spool = (
      await app.inject({
        method: "POST",
        url: "/api/filament/spools",
        payload: { profileId, colorHex: "#000000", initialGrams: 1000 },
      })
    ).json() as { id: string };
    return entered ? backdate(spool) : spool;
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

  it("takes the grams from a spool entered after the print", async () => {
    const spool = await setup(false);
    await applySuggested("prints", await preview("prints", FILE));
    expect(db.select().from(schema.printFilamentUsages).get()).toMatchObject({
      spoolId: spool.id,
      grams: 12.5,
    });
    expect(remaining(spool.id)).toBe(987.5);
  });

  it("numbers prints, and a row with a number is that print", async () => {
    await setup();
    await applySuggested("prints", await preview("prints", FILE));
    expect(db.select().from(schema.prints).get()?.number).toBe(1);
    const renamed = `number,${PRINT_HEAD}\n1,box,Renamed,2026-03-04 10:00,3600,success,001-Basic #000000,12.5`;
    const p = await preview("prints", renamed);
    expect(p.rows[0]).toMatchObject({ status: "changed", action: "update" });
  });

  it("numbers and books a file listed newest first in date order", async () => {
    const spool = await setup();
    const row = (title: string, at: string) =>
      `box,${title},${at},3600,success,001-Basic #000000,10`;
    const file = [
      PRINT_HEAD,
      row("Third", "2026-03-06 10:00"),
      row("Second", "2026-03-05 10:00"),
      row("First", "2026-03-04 10:00"),
    ].join("\n");
    await applySuggested("prints", await preview("prints", file));
    const byNumber = db.select().from(schema.prints).orderBy(schema.prints.number).all();
    expect(byNumber.map((p) => [p.number, p.title])).toEqual([
      [1, "First"],
      [2, "Second"],
      [3, "Third"],
    ]);
    const ledger = db
      .select()
      .from(schema.spoolWeightEntries)
      .where(eq(schema.spoolWeightEntries.spoolId, spool.id))
      .all()
      .filter((e) => e.kind === "print");
    expect(ledger.map((e) => [e.note, e.remainingAfter])).toEqual([
      ["First", 990],
      ["Second", 980],
      ["Third", 970],
    ]);
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
    // A leading number is the identity, padded or not, however the rest is spelled.
    for (const cell of ["005-bucket", "5", "05", "BUCKET", "5-Bucket Big", "005 whatever"])
      expect((await preview("prints", proj(cell))).missing).toEqual({});
    expect(printImport.refs(db).projects).toEqual(["005-bucket"]);
  });

  it("announces and creates a new numbered project once, however the rows spell it", async () => {
    await setup();
    const csv = [
      `project,${PRINT_HEAD}`,
      "135-Boat Test,box,A,2026-03-04 10:00,,success,,",
      "135 boat,box,B,2026-03-05 10:00,,success,,",
    ].join("\n");
    const p = await preview("prints", csv);
    expect(p.missing).toEqual({ projects: ["135-Boat Test"] });
    await applySuggested("prints", p);
    expect(db.select().from(schema.projects).all()).toMatchObject([
      { number: 135, name: "Boat Test", folderPath: null },
    ]);
  });

  it("sees a print as identical however its printer and spool are spelled", async () => {
    await setup();
    await applySuggested("prints", await preview("prints", FILE));
    for (const [printer, spool] of [
      ["1-Box", "1-Whatever"],
      ["01", "001"],
      ["BOX", "1"],
    ])
      expect(
        statuses(
          await preview(
            "prints",
            FILE.replace("box,", `${printer},`).replace("001-Basic #000000", spool ?? ""),
          ),
        ),
      ).toEqual(["identical"]);
  });

  it("finds a spool by a leading number with any text after it", async () => {
    const spool = await setup();
    await applySuggested(
      "prints",
      await preview("prints", FILE.replace("001-Basic #000000", "1-Jade White")),
    );
    expect(remaining(spool.id)).toBe(987.5);
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

  it("estimates a missing duration from the grams, costs it, and a real duration clears it", async () => {
    await setup();
    const file = `${PRINT_HEAD}
box,Benchy,2026-03-04 10:00,,success,001-Basic #000000,15`;
    expect((await applySuggested("prints", await preview("prints", file))).json()).toMatchObject({
      created: 1,
    });
    // No prints with both values yet: the 15 g/h preference, so 15 g is an hour on 150 W.
    const row = () => db.select().from(schema.prints).get();
    expect(row()).toMatchObject({
      durationSec: 3600,
      durationEstimated: true,
      energyWh: 150,
      energySource: "estimated",
    });
    const url = `/api/prints/${row()?.id}`;
    const get = async () => (await app.inject({ method: "GET", url })).json();
    expect((await get()).cost.energy).toBeGreaterThan(0);
    // The form's estimate button, and a manual print saved with its result.
    const printerId = row()?.printerId;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/prints/estimate-duration?printerId=${printerId}&grams=30`,
        })
      ).json(),
    ).toEqual({ durationSec: 7200 });
    // Saving the estimate unchanged keeps the flag.
    await app.inject({ method: "PATCH", url, payload: { durationSec: 3600 } });
    expect(row()?.durationEstimated).toBe(true);
    await app.inject({ method: "PATCH", url, payload: { durationSec: 7200 } });
    expect(row()).toMatchObject({ durationSec: 7200, durationEstimated: false, energyWh: 300 });
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

  it("offers spool picks for a file: the spool it names, its filament's spools first", async () => {
    const spool = await setup();
    const p = await preview(
      "prints",
      `${PRINT_HEAD},filament\nbox,A,2026-03-04 10:00,,success,001-Basic #000000,5,\nbox,B,2026-03-05 10:00,,success,,5,Basic`,
    );
    expect(p.refsOptional).toContain("spool");
    expect(p.refOptions?.spool?.map((o) => o.id)).toEqual([spool.id]);
    // No project cell and no project file named "A": a person picks one.
    expect(p.rows.map((r) => [r.refs, r.refsFirst])).toEqual([
      [{ project: null, spool: spool.id }, { spool: [spool.id] }],
      [{ project: null, spool: null }, { spool: [spool.id] }],
    ]);
  });

  it("needs a project for every print: the file's, the one its title names, or a pick", async () => {
    await setup();
    const benchy = db
      .insert(schema.projects)
      .values({
        number: 7,
        name: "boat",
        meta: { files: [{ path: "Benchy.3mf", kind: "model", size: 1 }] },
      })
      .returning()
      .get();
    const p = await preview(
      "prints",
      `project,${PRINT_HEAD}\n,box,Benchy_plate_1,2026-03-04 10:00,,success,,\n,box,Cube,2026-03-05 10:00,,success,,\n9-new,box,Ball,2026-03-06 10:00,,success,,`,
    );
    expect(p.refsOptional).not.toContain("project");
    expect(p.refOptions?.project?.map((o) => o.id)).toEqual([NO_PROJECT, benchy.id]);
    // A cell that names a project (even one to create) is the row's project: nothing to pick.
    expect(p.rows.map((r) => r.refs)).toEqual([{ project: benchy.id }, { project: null }, {}]);
    const [a, b, c] = p.rows.map((r) => r.row);
    const apply = (cube?: string) =>
      app.inject({
        method: "POST",
        url: "/api/import/prints/apply",
        payload: {
          uploadId: p.uploadId,
          policy: "overwrite",
          decisions: [
            { row: a, action: "create", refs: { project: benchy.id } },
            { row: b, action: "create", refs: cube ? { project: cube } : {} },
            { row: c, action: "create" },
          ],
        },
      });
    expect((await apply()).json().error.code).toBe("ref_not_found");
    expect((await apply(benchy.id)).json()).toMatchObject({ created: 3 });
    const projectOf = Object.fromEntries(
      db
        .select({ title: schema.prints.title, project: schema.projects.name })
        .from(schema.prints)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.prints.projectId))
        .all()
        .map((r) => [r.title, r.project]),
    );
    expect(projectOf).toEqual({ Benchy_plate_1: "boat", Cube: "boat", Ball: "new" });
  });

  it("a print can have no project on purpose: a title match never links it later", async () => {
    await setup();
    const p = await preview(
      "prints",
      `project,${PRINT_HEAD}\n,box,Calibration,2026-03-04 10:00,,success,,`,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/import/prints/apply",
      payload: {
        uploadId: p.uploadId,
        policy: "overwrite",
        decisions: [{ row: p.rows[0]?.row, action: "create", refs: { project: NO_PROJECT } }],
      },
    });
    expect(res.json()).toMatchObject({ created: 1 });
    const print = () => db.select().from(schema.prints).get();
    expect(print()).toMatchObject({ projectId: null, noProject: true });

    // As an integration's print: a project whose file is named like its title shows up.
    db.update(schema.prints).set({ origin: "integration" }).run();
    const cal = db
      .insert(schema.projects)
      .values({
        number: 5,
        name: "cal",
        meta: { files: [{ path: "Calibration.3mf", kind: "model", size: 1 }] },
      })
      .returning()
      .get();
    expect(linkPrints(db)).toBe(0);

    // Picking a project by hand ends it; taking the project off again is on purpose again.
    const patch = (projectId: string | null) =>
      app.inject({ method: "PATCH", url: `/api/prints/${print()?.id}`, payload: { projectId } });
    expect((await patch(cal.id)).statusCode).toBe(200);
    expect(print()).toMatchObject({ projectId: cal.id, noProject: false });
    await patch(null);
    expect(print()).toMatchObject({ projectId: null, noProject: true });
  });

  it("rejects a spool opened after the print started", async () => {
    const spool = await setup();
    db.update(schema.spools)
      .set({ openedAt: "2026-03-05T12:00:00.000Z" })
      .where(eq(schema.spools.id, spool.id))
      .run();
    const p = await preview("prints", FILE);
    expect(p.rows[0]?.errors).toEqual([{ column: "spool", code: "not_opened" }]);
  });

  describe("multicolor", () => {
    const HEAD = `${PRINT_HEAD},spool2,grams2,spool3,grams3,trackUsage`;
    const second = async () => {
      const profileId = filamentProfileIdFor(db, {
        brand: "Acme",
        material: "PETG",
        name: "Tough",
      });
      return backdate(
        (
          await app.inject({
            method: "POST",
            url: "/api/filament/spools",
            payload: { profileId, colorHex: "#ffffff", initialGrams: 500 },
          })
        ).json() as { id: string },
      );
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
