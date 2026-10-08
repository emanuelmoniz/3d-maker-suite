import { XMLParser } from "fast-xml-parser";
import { openZip, type ThreeMfSource, type Zip } from "./zip.ts";

export interface ThreeMfFilament {
  /** 1-based filament slot in the project. */
  slot: number;
  type: string | null;
  /** `#RRGGBB` (Bambu may append alpha, kept as-is). */
  color: string | null;
  /** Slicer filament profile name, e.g. "Bambu PLA Matte @BBL A1". */
  profile: string | null;
  /** Only present when the file was sliced. */
  grams: number | null;
  meters: number | null;
}

export interface ThreeMfPlate {
  index: number;
  name: string | null;
  /** Has slice results (time and filament usage) for this plate. */
  sliced: boolean;
  printTimeSeconds: number | null;
  weightGrams: number | null;
  /** Filaments used on this plate. Unsliced: derived from the objects' extruder assignments. */
  filaments: ThreeMfFilament[];
  multicolor: boolean;
  objects: string[];
  /** Zip entry path of the plate preview PNG; read it with `read3mfEntry`. */
  thumbnail: string | null;
}

export interface ThreeMfInfo {
  slicer: { name: string; version: string | null } | null;
  printerModel: string | null;
  nozzleDiameter: number | null;
  sliced: boolean;
  multicolor: boolean;
  plates: ThreeMfPlate[];
}

type Node = Record<string, unknown>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["plate", "metadata", "object", "part", "filament", "model_instance"].includes(name),
});

const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

/** `<metadata key="k" value="v"/>` children as a plain record. */
function meta(node: Node): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of arr(node.metadata)) {
    if (m["@_key"] != null) out[String(m["@_key"])] = String(m["@_value"] ?? "");
  }
  return out;
}

async function readText(zip: Zip, name: string) {
  return (await zip.read(name))?.toString("utf8") ?? null;
}

async function readJson(zip: Zip, name: string): Promise<Node> {
  const text = await readText(zip, name);
  try {
    return text ? (JSON.parse(text) as Node) : {};
  } catch {
    return {};
  }
}

async function readXml(zip: Zip, name: string): Promise<Node> {
  const text = await readText(zip, name);
  try {
    return text ? (((xml.parse(text) as Node).config as Node) ?? {}) : {};
  } catch {
    return {};
  }
}

/** "BambuStudio-02.08.02.60" -> { name: "BambuStudio", version: "02.08.02.60" } */
function parseSlicer(head: string | null): ThreeMfInfo["slicer"] {
  const app = head?.match(/<metadata\s+name="Application"[^>]*>([^<]*)</)?.[1]?.trim();
  if (!app) return null;
  const i = app.indexOf("-");
  return i < 0
    ? { name: app, version: null }
    : { name: app.slice(0, i), version: app.slice(i + 1) };
}

/**
 * Parse a 3MF (Bambu Studio / Orca style metadata). Only small metadata entries are read;
 * mesh files are never loaded. Missing or malformed parts yield nulls/empty lists, not errors.
 * Throws only if the source is not a readable zip.
 */
export async function parse3mf(source: ThreeMfSource): Promise<ThreeMfInfo> {
  const zip = await openZip(source);
  try {
    const [head, project, settings, slice] = await Promise.all([
      zip.readHead("3D/3dmodel.model", "<resources"),
      readJson(zip, "Metadata/project_settings.config"),
      readXml(zip, "Metadata/model_settings.config"),
      readXml(zip, "Metadata/slice_info.config"),
    ]);

    const types = (project.filament_type as string[] | undefined) ?? [];
    const colors = (project.filament_colour as string[] | undefined) ?? [];
    const profiles = (project.filament_settings_id as string[] | undefined) ?? [];
    const filament = (slot: number, over?: Node): ThreeMfFilament => ({
      slot,
      type: str(over?.["@_type"]) ?? str(types[slot - 1]),
      color: str(over?.["@_color"]) ?? str(colors[slot - 1]),
      profile: str(profiles[slot - 1]),
      grams: num(over?.["@_used_g"]),
      meters: num(over?.["@_used_m"]),
    });

    // object id -> name + filament slots used
    const objects = new Map<string, { name: string | null; slots: Set<number> }>();
    for (const o of arr(settings.object)) {
      const om = meta(o);
      const slots = new Set<number>();
      for (const p of arr(o.part)) {
        const sub = p["@_subtype"];
        if (sub && sub !== "normal_part") continue;
        const e = num(meta(p).extruder);
        if (e) slots.add(e);
      }
      const objExtruder = num(om.extruder);
      if (!slots.size && objExtruder) slots.add(objExtruder);
      objects.set(String(o["@_id"]), { name: str(om.name), slots });
    }

    const plates = new Map<number, ThreeMfPlate>();
    const plateFor = (index: number) => {
      let p = plates.get(index);
      if (!p) {
        p = {
          index,
          name: null,
          sliced: false,
          printTimeSeconds: null,
          weightGrams: null,
          filaments: [],
          multicolor: false,
          objects: [],
          thumbnail: null,
        };
        plates.set(index, p);
      }
      return p;
    };

    for (const pl of arr(settings.plate)) {
      const m = meta(pl);
      const p = plateFor(num(m.plater_id) ?? plates.size + 1);
      p.name = str(m.plater_name);
      const thumb = (str(m.thumbnail_file) ?? `Metadata/plate_${p.index}.png`).replace(/^\/+/, "");
      p.thumbnail = zip.has(thumb) ? thumb : null;
      const slots = new Set<number>();
      for (const inst of arr(pl.model_instance)) {
        const o = objects.get(String(meta(inst).object_id));
        if (!o) continue;
        if (o.name) p.objects.push(o.name);
        for (const s of o.slots) slots.add(s);
      }
      p.filaments = [...slots].sort((a, b) => a - b).map((s) => filament(s));
    }

    // Slice results override the derived data.
    for (const sp of arr(slice.plate)) {
      const m = meta(sp);
      const p = plateFor(num(m.index) ?? plates.size + 1);
      p.sliced = true;
      p.printTimeSeconds = num(m.prediction);
      p.weightGrams = num(m.weight);
      const used = arr(sp.filament).map((f) => filament(num(f["@_id"]) ?? 0, f));
      if (used.length) p.filaments = used;
    }

    const list = [...plates.values()].sort((a, b) => a.index - b.index);
    for (const p of list) p.multicolor = p.filaments.length > 1;

    return {
      slicer: parseSlicer(head),
      printerModel: str(project.printer_model),
      nozzleDiameter: num((project.nozzle_diameter as unknown[] | undefined)?.[0]),
      sliced: list.some((p) => p.sliced),
      multicolor: list.some((p) => p.multicolor),
      plates: list,
    };
  } finally {
    zip.close();
  }
}

/** Read one entry (e.g. a plate thumbnail) without parsing the rest. Null if missing. */
export async function read3mfEntry(
  source: ThreeMfSource,
  name: string,
): Promise<Uint8Array | null> {
  const zip = await openZip(source);
  try {
    return await zip.read(name);
  } finally {
    zip.close();
  }
}
