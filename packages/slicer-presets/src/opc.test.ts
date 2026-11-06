import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliSlicer, slicerPresetLibrary, systemPresets } from "./index.ts";
import { opcStamp, parseOpc } from "./opc.ts";

// A small cache built by hand, as Orca lays one out, so no vendor's file is in the repo.
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const f64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return b;
};
const str = (s: string) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
const list = (items: Buffer[]) => Buffer.concat([u64(items.length), ...items]);

const VECTOR = 0x4000;
const KEYS = {
  filament_type: 3 + VECTOR,
  filament_vendor: 3 + VECTOR,
  nozzle_temperature: 2 + VECTOR,
  filament_density: 1 + VECTOR,
  filament_cost: 1 + VECTOR,
  printer_model: 3,
  nozzle_diameter: 1 + VECTOR,
  layer_height: 1,
  compatible_printers: 3 + VECTOR,
  enable_arc_fitting: 8,
  top_shell: 4,
  brim: 5,
  bed: 6 + VECTOR,
  gcode_flavor: 9,
} as const;
const KEY_NAMES = Object.keys(KEYS);

type Value = Buffer;
const opt = (key: keyof typeof KEYS, v: Value) => Buffer.concat([u16(KEY_NAMES.indexOf(key)), v]);
const texts = (...s: string[]) => list(s.map(str));

const entry = (
  name: string,
  subPath: string,
  options: Buffer[],
  { inherits = "", instantiation = "true" } = {},
) =>
  Buffer.concat([
    str(name),
    str(subPath),
    u32(options.length),
    ...options,
    str(inherits),
    list([]),
    str(""),
    str(instantiation),
    str("id1"),
    str(""),
    list([]),
  ]);
const model = (name: string) =>
  Buffer.concat([
    str("id"),
    str(name),
    str(""),
    Buffer.from([0]),
    str("family"),
    list([str("0.4")]),
    list([]),
    list([]),
    ...Array.from({ length: 9 }, () => str("")),
  ]);

function build({
  vendor = "Acme",
  version = "1.2.3",
  fileVersion = 2,
  bodyVersion = 2,
  models = ["Acme X"],
  process = [] as Buffer[],
  filament = [] as Buffer[],
  machine = [] as Buffer[],
} = {}) {
  const body = Buffer.concat([
    u32(bodyVersion),
    str(vendor),
    str(version),
    list(KEY_NAMES.map(str)),
    list(Object.values(KEYS).map(u16)),
    list([str(""), str("marlin")]),
    u64(1),
    str(vendor),
    str(`${vendor} Inc`),
    str("id"),
    str(version),
    str(""),
    str(""),
    list(models.map(model)),
    list([]),
    list([]),
    u32(process.length),
    ...process,
    u32(filament.length),
    ...filament,
    u32(machine.length),
    ...machine,
    u64(0),
  ]);
  return Buffer.concat([
    Buffer.from("ZCRO"),
    u32(fileVersion),
    u64(body.length),
    u32(crc32(body)),
    body,
  ]);
}

const acme = () =>
  build({
    filament: [
      entry(
        "Acme PLA @base",
        "filament/Acme PLA @base.json",
        [
          opt("filament_type", texts("PLA")),
          opt("filament_vendor", texts("Acme")),
          opt("nozzle_temperature", list([Buffer.from(u32(215))])),
          opt("filament_density", list([f64(1.3)])),
          opt("filament_cost", list([f64(25)])),
        ],
        { instantiation: "false" },
      ),
      entry(
        "Acme PLA @Acme X",
        "filament/Acme PLA @Acme X.json",
        [opt("compatible_printers", texts("Acme X 0.4 nozzle"))],
        { inherits: "Acme PLA @base" },
      ),
    ],
    machine: [
      entry("Acme X 0.4 nozzle", "machine/Acme X 0.4 nozzle.json", [
        opt("printer_model", str("Acme X")),
        opt("nozzle_diameter", list([f64(0.4)])),
        opt("enable_arc_fitting", Buffer.from([1])),
        opt("top_shell", f64(15)),
        opt("brim", Buffer.concat([f64(50), Buffer.from([1])])),
        opt("bed", list([Buffer.concat([f64(0), f64(0)]), Buffer.concat([f64(256), f64(0)])])),
        opt("gcode_flavor", Buffer.concat([u32(1), u16(1)])),
      ]),
    ],
    process: [
      entry("0.20mm @Acme X", "process/0.20mm @Acme X.json", [
        opt("layer_height", f64(0.2)),
        opt("compatible_printers", texts("Acme X 0.4 nozzle")),
      ]),
    ],
  });

let dir: string;
const put = (name: string, data: Buffer | string) => {
  mkdirSync(join(dir, "system"), { recursive: true });
  writeFileSync(join(dir, "system", name), data);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opc-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const library = () => slicerPresetLibrary("orca-slicer", () => []);

describe("parseOpc", () => {
  it("gives each preset's values as a JSON preset spells them", () => {
    const { vendor, version, name, models, presets } = parseOpc(acme());
    expect([vendor, version, name, models]).toEqual(["Acme", "1.2.3", "Acme Inc", ["Acme X"]]);
    const machine = presets.find((p) => p.kind === "machine");
    expect(machine?.subPath).toBe("machine/Acme X 0.4 nozzle.json");
    expect(machine?.preset).toMatchObject({
      type: "machine",
      from: "system",
      name: "Acme X 0.4 nozzle",
      instantiation: "true",
      setting_id: "id1",
      printer_model: "Acme X",
      nozzle_diameter: ["0.4"],
      enable_arc_fitting: "1",
      top_shell: "15%",
      brim: "50%",
      bed: ["0x0", "256x0"],
      gcode_flavor: "marlin",
    });
  });

  it("refuses what it can't be sure of, without guessing", () => {
    const good = acme();
    expect(() => parseOpc(Buffer.from("ZCRO"))).toThrow("not a cache");
    expect(() => parseOpc(Buffer.alloc(40))).toThrow("not a cache");
    expect(() => parseOpc(build({ fileVersion: 3 }))).toThrow("format 3");
    expect(() => parseOpc(build({ bodyVersion: 3 }))).toThrow("body format");
    expect(() => parseOpc(good.subarray(0, good.length - 1))).toThrow("cut short");

    const flipped = Buffer.from(good);
    flipped[flipped.length - 20] = (flipped[flipped.length - 20] ?? 0) ^ 0xff;
    expect(() => parseOpc(flipped)).toThrow("checksum");
  });

  it("a length the file can't hold allocates nothing and fails", () => {
    const body = Buffer.concat([u32(2), u64(2 ** 40)]);
    const file = Buffer.concat([
      Buffer.from("ZCRO"),
      u32(2),
      u64(body.length),
      u32(crc32(body)),
      body,
    ]);
    expect(() => parseOpc(file)).toThrow("size");
  });

  it("reads the stamp from the front alone", () => {
    expect(opcStamp(acme().subarray(0, 60))).toEqual({ vendor: "Acme", version: "1.2.3" });
    expect(() => opcStamp(build({ fileVersion: 3 }).subarray(0, 60))).toThrow("format 3");
  });
});

describe("a config folder with caches", () => {
  it("offers its brands, models and system presets, values found through `inherits`", async () => {
    put("Acme.opc", acme());
    const { models, machines, processes } = (await library().readCatalog?.(dir)) ?? {};
    expect(models).toEqual([{ brand: "Acme Inc", model: "Acme X", image: null }]);
    expect(machines).toMatchObject([
      {
        presetId: "system/Acme X 0.4 nozzle",
        brand: "Acme Inc",
        model: "Acme X",
        nozzleDiameterMm: 0.4,
      },
    ]);
    expect(processes).toMatchObject([
      { presetId: "system/0.20mm @Acme X", brand: "Acme Inc", model: "Acme X", layerHeightMm: 0.2 },
    ]);
    expect(await library().read(dir, { includeSystem: true })).toMatchObject([
      {
        presetId: "system/Acme PLA",
        scope: "system",
        brand: "Acme",
        material: "PLA",
        name: "Acme PLA",
        densityGcm3: 1.3,
        nozzleTempC: 215,
      },
    ]);
  });

  it("a user preset finds its parent there, so it has its brand and material", async () => {
    put("Acme.opc", acme());
    const file = join(dir, "user", "default", "filament", "Mine.json");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ name: "Mine", inherits: "Acme PLA @Acme X" }));
    expect(await library().read(dir, { includeSystem: false })).toMatchObject([
      { presetId: "user/Mine", brand: "Acme", material: "PLA", nozzleTempC: 215 },
    ]);
  });

  it("fingerprints each cache's version: a recopy changes nothing, a new version does", async () => {
    put("Acme.opc", acme());
    const before = await library().catalogFingerprint?.(dir);
    expect(before).toBe("Acme=1.2.3");
    put("Acme.opc", acme());
    expect(await library().catalogFingerprint?.(dir)).toBe(before);
    put("Acme.opc", build({ version: "1.2.4" }));
    expect(await library().catalogFingerprint?.(dir)).toBe("Acme=1.2.4");
  });

  it("a format it doesn't know gives no system rows and no fingerprint, and says why once", async () => {
    put("Acme.opc", build({ fileVersion: 3 }));
    expect(await library().readCatalog?.(dir)).toEqual({ models: [], machines: [], processes: [] });
    expect(await library().read(dir, { includeSystem: true })).toEqual([]);
    expect(await library().catalogFingerprint?.(dir)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("a vendor with a JSON index is read as JSON (Orca ≤ 2.4)", async () => {
    put("Acme.opc", acme());
    put("Acme.json", JSON.stringify({ name: "Json Acme", version: "9" }));
    const { models } = (await library().readCatalog?.(dir)) ?? {};
    expect(models).toEqual([]);
    expect(await library().catalogFingerprint?.(dir)).toBe("Acme=9");
  });

  it("flattens a preset for the slicer CLI, and a slice takes it", async () => {
    put("Acme.opc", acme());
    const machines = await systemPresets(dir, "machine");
    const file = machines.systemFiles.get("Acme X 0.4 nozzle") ?? "";
    const preset = await machines.load(file);
    expect(preset && (await machines.flatten(preset, file))).toMatchObject({
      printer_model: "Acme X",
      type: "machine",
    });

    const seen: string[][] = [];
    const slicer = cliSlicer({ flavor: "orca" });
    const refused = await slicer
      .slice(
        "orca",
        dir,
        {
          file: join(import.meta.dirname, "../../3mf/fixtures/single_color.3mf"),
          plate: 1,
          machine: "system/Acme X 0.4 nozzle",
          process: "system/0.20mm @Acme X",
          filaments: Array.from({ length: 8 }, () => "system/Acme PLA"),
        },
        new AbortController().signal,
        async (_program, args) => {
          seen.push(args);
          return 1;
        },
      )
      .catch((e: Error) => e.message);
    // The fake program writes no output, so it fails there: after the presets were all found.
    expect(seen, String(refused)).toHaveLength(1);
    expect(seen[0]).toContain("--load-settings");
    expect(seen[0]).toContain("--load-filaments");
  });
});

// The check for each Orca release (CONTRIBUTING): the real files of this machine, when it has them.
const real = join(process.env.APPDATA ?? "", "OrcaSlicer");
describe.skipIf(!existsSync(join(real, "system")))("this machine's OrcaSlicer", () => {
  it("reads every cache, and every filament finds its material and brand", async () => {
    const warn = vi.mocked(console.warn);
    const { models, machines, processes } = (await library().readCatalog?.(real)) ?? {};
    expect(models?.length).toBeGreaterThan(50);
    expect(machines?.length).toBeGreaterThan(50);
    expect(processes?.length).toBeGreaterThan(50);
    const filaments = await library().read(real, { includeSystem: true });
    const system = filaments.filter((f) => f.scope === "system");
    expect(system.length).toBeGreaterThan(50);
    expect(system.filter((f) => !f.material)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(await library().catalogFingerprint?.(real)).toContain("BBL=");
  }, 60_000);
});
