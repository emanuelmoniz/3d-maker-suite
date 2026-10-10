import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orcaSlicerAdapter } from "@3d-maker-suite/adapter-orca";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { buildApp } from "./app.ts";

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

beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db, false, mkdtempSync(join(tmpdir(), "zip-")), {
    adapters: [orcaSlicerAdapter()],
  });
});

const upload = (body: Buffer, source = "orca-slicer") =>
  app.inject({
    method: "POST",
    url: `/api/slicer-zip/${source}`,
    headers: { "content-type": "application/zip" },
    payload: body,
  });
const preview = async (id: string, type: string) =>
  (await app.inject(`/api/slicer-zip/${id}/${type}`)).json().items as {
    key: string;
    status: string;
  }[];
const importAll = async (id: string, type: string) => {
  const keys = (await preview(id, type)).filter((i) => i.status !== "imported").map((i) => i.key);
  return (
    await app.inject({
      method: "POST",
      url: `/api/slicer-zip/${id}/${type}/import`,
      payload: { keys },
    })
  ).json();
};

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

      for (const type of ["brands", "printerModels", "machineProfiles", "filamentBrands"])
        expect((await importAll(id, type)).created).toBeGreaterThan(0);
      expect((await importAll(id, "filamentProfiles")).created).toBe(2);

      // A second upload of the same folder finds everything already there.
      const again = (await upload(await folder(prefix))).json().uploadId;
      for (const type of [
        "brands",
        "printerModels",
        "machineProfiles",
        "filamentBrands",
        "filamentProfiles",
      ])
        expect((await preview(again, type)).every((i) => i.status === "imported")).toBe(true);
      expect(db.select().from(schema.machineProfiles).all()).toHaveLength(1);
      expect(db.select().from(schema.filamentProfiles).all()).toHaveLength(2);
      expect(db.select().from(schema.machineProfiles).get()?.sourcePreset).toBe(
        "orca-slicer:system/Acme X 0.4",
      );
    },
  );

  it("rejects a file that isn't a zip, a zip that isn't a slicer folder, and an unknown slicer", async () => {
    expect((await upload(Buffer.from("not a zip"))).json().error.code).toBe("invalid_zip");
    const other = await zipOf({ "photos/a.json": "{}", "notes.txt": "hi" });
    expect((await upload(other)).json().error.code).toBe("not_slicer_folder");
    expect((await upload(await folder(), "nope")).statusCode).toBe(404);
    expect((await app.inject(`/api/slicer-zip/${crypto.randomUUID()}/brands`)).statusCode).toBe(
      404,
    );
  });
});
