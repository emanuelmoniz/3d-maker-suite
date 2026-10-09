import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { paintState, parse3mf, read3mfEntry, read3mfPaint } from "./index.ts";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}.3mf`, import.meta.url));

/** Minimal "stored" (uncompressed) zip so we can test slice data without a real sliced fixture. */
function zipOf(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc32(data), 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    parts.push(h, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

describe("parse3mf fixtures (saved without slicing)", () => {
  it("multi-color project", async () => {
    const info = await parse3mf(fixture("multi_color"));
    expect(info.slicer).toEqual({ name: "BambuStudio", version: "02.08.02.60" });
    expect(info.printerModel).toBe("Bambu Lab A1");
    expect(info.nozzleDiameter).toBe(0.4);
    expect(info.sliced).toBe(false);
    expect(info.multicolor).toBe(true);
    const [plate] = info.plates;
    expect(info.plates).toHaveLength(1);
    expect(plate?.objects).toEqual(["design_05", "design_06", "design_07", "design_08"]);
    expect(plate?.filaments.map((f) => [f.slot, f.type, f.color])).toEqual([
      [1, "PLA", "#FFFFFF"],
      [2, "PLA", "#0078BF"],
      [3, "PLA", "#A3D8E1"],
      [4, "PLA", "#F99963"],
    ]);
    expect(plate?.filaments[1]?.profile).toBe("Bambu PLA Matte @BBL A1");
    expect(plate?.printTimeSeconds).toBeNull();
    expect(plate?.filaments[0]?.grams).toBeNull();
  });

  it("maps each part's extruder to its filament color, in loader order", async () => {
    const { partColors } = await parse3mf(fixture("multi_color"));
    expect(partColors).toHaveLength(4);
    for (const parts of partColors) {
      expect(parts).toEqual(["#FFFFFF", "#0078BF", "#A3D8E1", "#F99963"]);
    }
    expect((await parse3mf(fixture("single_color"))).partColors).toEqual([["#FFFFFF"]]);
  });

  it("single-color project uses only the assigned slot", async () => {
    const info = await parse3mf(fixture("single_color"));
    expect(info.slicer?.version).toBe("02.05.00.66");
    expect(info.multicolor).toBe(false);
    expect(info.plates[0]?.filaments.map((f) => f.slot)).toEqual([4]);
    expect(info.plates[0]?.objects).toEqual(["091_filipe-lid.stl"]);
  });

  it("returns plate thumbnails as readable PNG entries", async () => {
    const info = await parse3mf(fixture("single_color"));
    expect(info.plates[0]?.thumbnail).toBe("Metadata/plate_1.png");
    const png = await read3mfEntry(fixture("single_color"), "Metadata/plate_1.png");
    expect(
      Buffer.from(png ?? [])
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    expect(await read3mfEntry(fixture("single_color"), "nope")).toBeNull();
  });

  it("unsliced 3MF gives partial data without plate thumbnails or printer", async () => {
    const info = await parse3mf(fixture("unsliced"));
    expect(info.slicer).toEqual({ name: "BambuStudio", version: "02.00.00.00" });
    expect(info.printerModel).toBeNull();
    expect(info.plates).toHaveLength(1);
    expect(info.plates[0]?.thumbnail).toBeNull();
    expect(info.plates[0]?.filaments.map((f) => f.color)).toEqual([
      "#FFFFFF",
      "#0078BF",
      "#A3D8E1",
      "#F7D959",
    ]);
  });

  it("accepts a Uint8Array", async () => {
    const { readFile } = await import("node:fs/promises");
    const info = await parse3mf(await readFile(fixture("single_color")));
    expect(info.plates).toHaveLength(1);
  });
});

describe("parse3mf sliced data", () => {
  // Format per Bambu Studio's slice_info.config; no real sliced fixture yet.
  const sliced = zipOf({
    "3D/3dmodel.model": `<model><metadata name="Application">BambuStudio-01.10.01.50</metadata><resources/></model>`,
    "Metadata/project_settings.config": JSON.stringify({
      printer_model: "Bambu Lab X1 Carbon",
      nozzle_diameter: ["0.4"],
      filament_type: ["PLA", "PETG"],
      filament_colour: ["#FFFFFF", "#000000"],
      filament_settings_id: ["Bambu PLA Basic", "Bambu PETG HF"],
    }),
    "Metadata/slice_info.config": `<config><header/>
      <plate>
        <metadata key="index" value="1"/>
        <metadata key="prediction" value="3600"/>
        <metadata key="weight" value="12.5"/>
        <filament id="1" type="PLA" color="#FFFFFF" used_m="3.5" used_g="10.5"/>
        <filament id="2" type="PETG" color="#000000" used_m="0.7" used_g="2"/>
      </plate>
      <plate>
        <metadata key="index" value="2"/>
        <metadata key="prediction" value="600"/>
        <metadata key="weight" value="1"/>
        <filament id="2" type="PETG" color="#000000" used_m="0.3" used_g="1"/>
      </plate>
    </config>`,
  });

  it("reads time and per-slot filament usage per plate", async () => {
    const info = await parse3mf(sliced);
    expect(info.sliced).toBe(true);
    expect(info.printerModel).toBe("Bambu Lab X1 Carbon");
    expect(
      info.plates.map((p) => [p.index, p.printTimeSeconds, p.weightGrams, p.multicolor]),
    ).toEqual([
      [1, 3600, 12.5, true],
      [2, 600, 1, false],
    ]);
    expect(info.plates[0]?.filaments).toEqual([
      {
        slot: 1,
        type: "PLA",
        color: "#FFFFFF",
        profile: "Bambu PLA Basic",
        grams: 10.5,
        meters: 3.5,
      },
      { slot: 2, type: "PETG", color: "#000000", profile: "Bambu PETG HF", grams: 2, meters: 0.7 },
    ]);
  });

  it("rejects non-zip input", async () => {
    await expect(parse3mf(Buffer.from("not a zip"))).rejects.toThrow();
  });
});

describe("painted colors", () => {
  it("decodes Bambu paint_color nibble streams", () => {
    expect(paintState("4")).toBe(1);
    expect(paintState("8")).toBe(2);
    expect(paintState("0C")).toBe(3);
    expect(paintState("1C")).toBe(4);
    // Split in two halves (1 side): leaves "4" then "8" -> stream nibbles 1, 4, 8 -> reversed string.
    expect(paintState("841")).toBe(1); // equal area: first wins
    // Split in 3 sides: three quarters of state 2 beat one quarter of state 1.
    expect(paintState("88843")).toBe(2);
  });

  it("returns run-length painted triangles per part, null for unpainted parts", async () => {
    const tri = (c?: string) => `<triangle v1="0" v2="1" v3="2"${c ? ` paint_color="${c}"` : ""}/>`;
    const mesh = (id: number, tris: string) =>
      `<object id="${id}"><mesh><vertices/><triangles>${tris}</triangles></mesh></object>`;
    const zip = zipOf({
      "3D/3dmodel.model": `<model><resources>
        <object id="3"><components>
          <component p:path="/3D/Objects/o.model" objectid="1"/>
          <component p:path="/3D/Objects/o.model" objectid="2"/>
        </components></object></resources><build><item objectid="3"/></build></model>`,
      "3D/Objects/o.model": `<model><resources>${mesh(1, tri("4") + tri("4") + tri() + tri("0C"))}${mesh(2, tri())}</resources></model>`,
      "Metadata/project_settings.config": JSON.stringify({
        filament_colour: ["#111111", "#222222", "#33333380"],
      }),
    });
    expect(await read3mfPaint(zip)).toEqual({
      palette: ["#111111", "#222222", "#333333"],
      parts: [[[1, 2, 0, 1, 3, 1], null]],
    });
  });
});
