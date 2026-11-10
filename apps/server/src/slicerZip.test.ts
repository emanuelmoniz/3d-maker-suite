import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  orcaSlicerAdapter,
  orcaSlicerServerAdapter,
  orcaSlicerWorkerAdapter,
} from "@3d-maker-suite/adapter-orca";
import type { ImportPreview } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { buildApp } from "./app.ts";
import { reviewer } from "./testReview.ts";

// A tiny OrcaSlicer folder, read by the real shared reader.
const FILES: Record<string, unknown> = {
  "system/Acme.json": { name: "Acme", machine_model_list: [{ name: ["Acme X"] }] },
  "system/Acme/machine/Acme X 0.4.json": {
    name: "Acme X 0.4",
    type: "machine",
    instantiation: "true",
    printer_model: "Acme X",
    nozzle_diameter: ["0.4"],
  },
  "system/Acme/filament/Acme PLA.json": {
    name: "Acme PLA",
    instantiation: "true",
    filament_type: ["PLA"],
    filament_vendor: ["Acme"],
  },
  "user/default/filament/Mine.json": {
    name: "Mine",
    filament_type: ["PETG"],
    filament_vendor: ["Acme"],
  },
};

const zipOf = (files: Record<string, string | Buffer>, prefix = "") =>
  new Promise<Buffer>((resolve) => {
    const z = new yazl.ZipFile();
    for (const [name, data] of Object.entries(files)) z.addBuffer(Buffer.from(data), prefix + name);
    const chunks: Buffer[] = [];
    z.outputStream.on("data", (c) => chunks.push(c));
    z.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    z.end();
  });
const folder = (prefix = "") =>
  zipOf(Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, JSON.stringify(v)])), prefix);

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;

beforeEach(async () => {
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "zip-"));
  app = await buildApp(db, false, dataDir, {
    adapters: [orcaSlicerAdapter(), orcaSlicerServerAdapter(), orcaSlicerWorkerAdapter()],
  });
});

const upload = (body: Buffer, source = "orca-slicer") =>
  app.inject({
    method: "POST",
    url: `/api/slicer-zip/${source}`,
    headers: { "content-type": "application/zip" },
    payload: body,
  });
const review = reviewer(() => app);
const preview = async (id: string, type: string) =>
  (await review.open(`/api/slicer-zip/${id}/${type}`)).json() as ImportPreview;
const importAll = async (id: string, type: string) =>
  (await review.confirm(await preview(id, type))).json();

describe("slicer zip import", () => {
  it("lists the slicers that can be read from a zip, with their folders", async () => {
    const [source] = (await app.inject("/api/slicer-zip/sources")).json();
    expect(source).toMatchObject({
      id: "orca-slicer",
      folders: { mac: "~/Library/Application Support/OrcaSlicer" },
    });
  });

  it.each(["", "OrcaSlicer/"])(
    "imports every type from a zip (wrapper %j), once",
    async (prefix) => {
      const res = await upload(await folder(prefix));
      expect(res.statusCode).toBe(200);
      const id = res.json().uploadId;

      for (const type of [
        "brands",
        "printerModels",
        "machinePresets",
        "filamentBrands",
        "filamentMaterials",
      ])
        expect((await importAll(id, type)).created).toBeGreaterThan(0);
      expect((await importAll(id, "filamentPresets")).created).toBe(2);

      // A second upload of the same folder finds everything already there.
      const again = (await upload(await folder(prefix))).json().uploadId;
      for (const type of [
        "brands",
        "printerModels",
        "machinePresets",
        "filamentBrands",
        "filamentMaterials",
        "filamentPresets",
      ])
        expect((await preview(again, type)).rows.every((r) => r.status === "identical")).toBe(true);
      // Each confirmed review is in the import history.
      const logged = db.select().from(schema.importRuns).all();
      expect(logged).toHaveLength(6);
      expect(logged.every((r) => r.source === "zip" && r.backup)).toBe(true);
      expect(db.select().from(schema.machinePresets).all()).toHaveLength(1);
      expect(db.select().from(schema.filamentPresets).all()).toHaveLength(2);
      expect(db.select().from(schema.machinePresets).get()?.sourcePreset).toBe(
        "orca-slicer:system/Acme X 0.4",
      );
    },
  );

  it("never matches or updates another slicer's presets of the same name", async () => {
    const id = (await upload(await folder())).json().uploadId;
    for (const type of ["brands", "printerModels", "filamentBrands", "filamentMaterials"])
      await importAll(id, type);
    await importAll(id, "machinePresets");
    await importAll(id, "filamentPresets");
    // As if Bambu Studio had imported them: same names, its keys, and a hand-edited name.
    const relabel = (table: typeof schema.machinePresets | typeof schema.filamentPresets) =>
      db
        .update(table)
        .set({ sourcePreset: sql`replace(${table.sourcePreset}, 'orca-slicer:', 'bambu-studio:')` })
        .run();
    relabel(schema.machinePresets);
    relabel(schema.filamentPresets);
    const bambu = db.select().from(schema.filamentPresets).all();

    const again = (await upload(await folder())).json().uploadId;
    for (const type of ["machinePresets", "filamentPresets"]) {
      const rows = (await preview(again, type)).rows;
      expect(rows.every((r) => r.status === "new" && !r.targetId)).toBe(true);
    }
    expect((await importAll(again, "machinePresets")).created).toBe(1);
    expect((await importAll(again, "filamentPresets")).created).toBe(2);
    const sources = (table: typeof schema.machinePresets | typeof schema.filamentPresets) =>
      db
        .select({ s: table.sourcePreset })
        .from(table)
        .all()
        .map((r) => r.s?.split(":")[0])
        .sort();
    expect(sources(schema.machinePresets)).toEqual(["bambu-studio", "orca-slicer"]);
    expect(sources(schema.filamentPresets)).toEqual([
      "bambu-studio",
      "bambu-studio",
      "orca-slicer",
      "orca-slicer",
    ]);
    // Bambu Studio's are as they were.
    for (const b of bambu)
      expect(
        db.select().from(schema.filamentPresets).where(eq(schema.filamentPresets.id, b.id)).get(),
      ).toEqual(b);
  });

  it("rejects a file that isn't a zip, a zip that isn't a slicer folder, and an unknown slicer", async () => {
    expect((await upload(Buffer.from("not a zip"))).json().error.code).toBe("invalid_zip");
    const other = await zipOf({ "photos/a.json": "{}", "notes.txt": "hi" });
    expect((await upload(other)).json().error.code).toBe("not_slicer_folder");
    expect((await upload(await folder(), "nope")).statusCode).toBe(404);
    expect((await review.open(`/api/slicer-zip/${crypto.randomUUID()}/brands`)).statusCode).toBe(
      404,
    );
  });

  it("keeps a zip's user presets in the server slicer's config folder, replacing older ones", async () => {
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: { adapterId: "orca-slicer-server" },
      })
    ).json();
    const user = join(dataDir, "slicers", id, "config", "user");
    expect((await upload(await folder())).statusCode).toBe(200);
    expect(readdirSync(join(user, "default", "filament"))).toEqual(["Mine.json"]);
    // The system presets are the download's (Step 13), never the zip's.
    expect(existsSync(join(dataDir, "slicers", id, "config", "system"))).toBe(false);

    const other = await zipOf({
      "user/default/process/Fast.json": JSON.stringify({ name: "Fast" }),
    });
    expect((await upload(other)).statusCode).toBe(200);
    expect(readdirSync(join(user, "default"))).toEqual(["process"]);
  });

  describe("a preset missing from a newer zip", () => {
    const TYPES = ["brands", "filamentBrands", "filamentMaterials", "filamentPresets"];
    const mine = JSON.stringify({
      name: "Mine",
      filament_type: ["PETG"],
      filament_vendor: ["Acme"],
    });
    const other = JSON.stringify({
      name: "Other",
      filament_type: ["PETG"],
      filament_vendor: ["Acme"],
    });
    const first = () =>
      zipOf({ "system/Acme.json": FILES_ACME, "user/default/filament/Mine.json": mine });
    const FILES_ACME = JSON.stringify(FILES["system/Acme.json"]);
    const newer = () =>
      zipOf({ "system/Acme.json": FILES_ACME, "user/default/filament/Other.json": other });
    const firstImport = async () => {
      const id = (await upload(await first())).json().uploadId;
      for (const type of TYPES) await importAll(id, type);
    };
    const snapshots = () => db.select().from(schema.importSnapshots).all();

    it("raises the removal alert for the server slicer, and Delete works as in Step 7", async () => {
      const { id } = (
        await app.inject({
          method: "POST",
          url: "/api/integrations",
          payload: { adapterId: "orca-slicer-server" },
        })
      ).json();
      await firstImport();
      // As after the slicer's download: its config folder is where its presets are read.
      db.update(schema.integrations)
        .set({ slicerConfigDir: join(dataDir, "slicers", id, "config") })
        .where(eq(schema.integrations.id, id))
        .run();
      expect(snapshots().map((s) => s.integrationId)).toEqual([id]);

      expect((await upload(await newer())).statusCode).toBe(200);
      const url = `/api/import/integration/${id}/userFilamentPresets`;
      const [gone] =
        ((await app.inject({ method: "POST", url })).json() as ImportPreview).gone ?? [];
      expect(gone).toMatchObject({ label: expect.stringContaining("Mine"), dependents: [] });
      const del = await app.inject({ method: "DELETE", url: `${url}/gone/${gone?.id}` });
      expect(del.statusCode).toBe(200);
      expect(
        db
          .select()
          .from(schema.filamentPresets)
          .all()
          .map((p) => p.name),
      ).not.toContain("Mine");
    });

    it("with no server row, a zip removes nothing", async () => {
      await firstImport();
      expect(snapshots()).toEqual([]);
    });
  });

  it("gives a worker slicer the whole zip, system and user: the hub slices its presets", async () => {
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/integrations",
        payload: {
          adapterId: "orca-slicer-worker",
          config: { deviceId: crypto.randomUUID(), source: "installed" },
        },
      })
    ).json();
    expect((await upload(await folder())).statusCode).toBe(200);
    const config = join(dataDir, "slicers", id, "config");
    expect(readdirSync(config).sort()).toEqual(["system", "user"]);
    const row = db.select().from(schema.integrations).where(eq(schema.integrations.id, id)).get();
    expect(row?.slicerConfigDir).toBe(config);
  });
});
