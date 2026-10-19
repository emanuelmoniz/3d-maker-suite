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
  /**
   * The plate was sliced when the file was saved. Bambu Studio's project save keeps this mark
   * (`Metadata/plate_N.json`) but drops the results, so this can be true while `sliced` is false.
   */
  slicedOnSave: boolean;
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
  /** The print (process) preset the file was saved with, e.g. "0.20mm Standard @BBL A1". */
  printProfile: string | null;
  nozzleDiameter: number | null;
  sliced: boolean;
  multicolor: boolean;
  plates: ThreeMfPlate[];
  /**
   * Part colors for the viewer, in the order three's 3MFLoader builds the scene: one list per
   * `<build>` item, one entry per component of that item. `#RRGGBB`, or null when the part has no
   * extruder (or is a modifier). Empty if the file has no Bambu `model_settings`.
   */
  partColors: (string | null)[][];
  /**
   * The MakerWorld model the file was downloaded from (its `Title` metadata), as the cloud names
   * a print of it (`designTitle`). Null for a file of your own.
   */
  designTitle: string | null;
}

type Node = Record<string, unknown>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    [
      "plate",
      "metadata",
      "object",
      "part",
      "filament",
      "model_instance",
      "component",
      "item",
    ].includes(name),
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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** XML text to plain text. MakerWorld escapes some titles twice (`&amp;quot;`), so until stable. */
function xmlText(s: string) {
  let out = s;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(
            Number.parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10),
          )
        : (ENTITIES[e.toLowerCase()] ?? m),
    );
  }
  return out;
}

/** `<metadata name="Title">â€¦</metadata>` of the model head. */
function headMeta(head: string | null, name: string) {
  const v = head?.match(new RegExp(`<metadata\\s+name="${name}"[^>]*>([^<]*)<`))?.[1];
  return v ? xmlText(v).trim() || null : null;
}

interface BuildItem {
  /** Root `<object>` id, which is also the object id in model_settings. */
  object: string;
  components: { id: string; path: string }[];
}

/**
 * Build items and their components, in the order three's 3MFLoader builds the scene. The root
 * model is small for Bambu files (meshes live in 3D/Objects); callers skip non-Bambu files.
 */
async function readBuild(zip: Zip): Promise<BuildItem[]> {
  const text = await readText(zip, "3D/3dmodel.model");
  let model: Node = {};
  try {
    model = text ? (((xml.parse(text) as Node).model as Node) ?? {}) : {};
  } catch {}
  const components = new Map<string, BuildItem["components"]>();
  for (const o of arr((model.resources as Node | undefined)?.object)) {
    components.set(
      String(o["@_id"]),
      arr((o.components as Node | undefined)?.component).map((c) => ({
        id: String(c["@_objectid"]),
        path: String(c["@_p:path"] ?? "3D/3dmodel.model").replace(/^\/+/, ""),
      })),
    );
  }
  return arr((model.build as Node | undefined)?.item).map((item) => ({
    object: String(item["@_objectid"]),
    components: components.get(String(item["@_objectid"])) ?? [],
  }));
}

/** See `ThreeMfInfo.partColors`. `partSlot` is keyed `objectId/partId`. */
function partColors(build: BuildItem[], partSlot: Map<string, number | null>, filaments: string[]) {
  if (!partSlot.size) return [];
  return build.map((item) =>
    item.components.map((c) => {
      const slot = partSlot.get(`${item.object}/${c.id}`);
      return (slot && str(filaments[slot - 1])?.slice(0, 7)) || null;
    }),
  );
}

export interface ThreeMfPaint {
  /** Filament colors, slot 1 first (`#RRGGBB`). */
  palette: string[];
  /**
   * Same shape as `partColors` (build item, then component). A part whose mesh has painted
   * triangles holds run-length pairs `[state, count, state, count, ...]` over the mesh's triangles
   * in file order; state 0 = not painted, n = filament slot n. Null when nothing is painted.
   */
  parts: (number[] | null)[][];
}

/**
 * Bambu `paint_color` is a nibble stream (last hex char first). Node nibble: low 2 bits = number
 * of split sides, 0 for a leaf; a leaf's high 2 bits are its state, with 3 meaning "3 + next
 * nibble". A split node (high 2 bits = special side) is followed by its sides+1 children.
 * ponytail: a subdivided triangle (about 0.2% of painted ones) gets its dominant state by area
 * share instead of exact sub-triangles; paint-heavy meshes would need the real subdivision.
 */
export function paintState(code: string): number {
  const nibbles = [...code].reverse().map((c) => Number.parseInt(c, 16));
  let pos = 0;
  const next = () => nibbles[pos++] ?? 0;
  const area = new Map<number, number>();
  const walk = (share: number) => {
    const n = next();
    const sides = n & 3;
    if (!sides) {
      const state = n >> 2 === 3 ? 3 + next() : n >> 2;
      area.set(state, (area.get(state) ?? 0) + share);
      return;
    }
    // 1 side: halves; 2 sides: quarter, quarter, half; 3 sides: quarters.
    const shares =
      [
        [0.5, 0.5],
        [0.25, 0.25, 0.5],
        [0.25, 0.25, 0.25, 0.25],
      ][sides - 1] ?? [];
    for (const f of shares) walk(share * f);
  };
  walk(1);
  return [...area].reduce((best, e) => (e[1] > best[1] ? e : best), [0, -1])[0];
}

/** Every state in a `paint_color` code, however small its share (see `paintState`). */
function paintStates(code: string, into: Set<number>) {
  const nibbles = [...code].reverse().map((c) => Number.parseInt(c, 16));
  let pos = 0;
  const next = () => nibbles[pos++] ?? 0;
  const walk = () => {
    const n = next();
    const sides = n & 3;
    if (!sides) into.add(n >> 2 === 3 ? 3 + next() : n >> 2);
    else for (let i = 0; i <= sides; i++) walk();
  };
  walk();
}

/**
 * Filament slots painted on each part (`path#id`). Reads the mesh files, but decodes each distinct
 * code once. State 0 (not painted) is left out: those triangles print in the part's filament.
 */
async function paintedSlots(zip: Zip, build: BuildItem[]) {
  const out = new Map<string, Set<number>>();
  for (const path of new Set(build.flatMap((i) => i.components.map((c) => c.path)))) {
    const text = await readText(zip, path);
    if (!text?.includes("paint_color=")) continue;
    for (const obj of text.matchAll(/<object id="([^"]+)"[\s\S]*?<\/object>/g)) {
      const codes = new Set<string>();
      for (const m of obj[0].matchAll(/paint_color="([0-9A-Fa-f]+)"/g)) codes.add(m[1] as string);
      const slots = new Set<number>();
      for (const c of codes) paintStates(c, slots);
      slots.delete(0);
      if (slots.size) out.set(`${path}#${obj[1]}`, slots);
    }
  }
  return out;
}

/** Painted triangles of every part, for the viewer. Reads the mesh files, so call on demand. */
export async function read3mfPaint(source: ThreeMfSource): Promise<ThreeMfPaint> {
  const zip = await openZip(source);
  try {
    const project = await readJson(zip, "Metadata/project_settings.config");
    const palette = ((project.filament_colour as string[] | undefined) ?? []).map((c) =>
      c.slice(0, 7),
    );
    const build = await readBuild(zip);
    const runs = new Map<string, number[] | null>(); // "path#id" -> runs
    const files = new Map<string, string | null>();
    for (const c of build.flatMap((i) => i.components)) {
      if (!files.has(c.path)) files.set(c.path, await readText(zip, c.path));
      const key = `${c.path}#${c.id}`;
      if (runs.has(key)) continue;
      const text = files.get(c.path) ?? "";
      const start = text.indexOf(`<object id="${c.id}"`);
      const mesh = start < 0 ? "" : text.slice(start, text.indexOf("</object>", start));
      let out: number[] | null = null;
      if (mesh.includes("paint_color=")) {
        out = [];
        for (const t of mesh.matchAll(/<triangle [^>]*>/g)) {
          const code = t[0].match(/paint_color="([0-9A-Fa-f]+)"/)?.[1];
          const state = code ? paintState(code) : 0;
          const n = out.length;
          if (n && out[n - 2] === state) out[n - 1] = (out[n - 1] ?? 0) + 1;
          else out.push(state, 1);
        }
      }
      runs.set(key, out);
    }
    return {
      palette,
      parts: build.map((i) => i.components.map((c) => runs.get(`${c.path}#${c.id}`) ?? null)),
    };
  } finally {
    zip.close();
  }
}

/**
 * Parse a 3MF (Bambu Studio / Orca style metadata). Reads the metadata entries, and the mesh
 * files only when they hold painted colours (their slots count for the plate). Missing or malformed parts yield nulls/empty lists, not errors.
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
    const partSlot = new Map<string, number | null>(); // `objectId/partId` (part id = component objectid) -> slot
    for (const o of arr(settings.object)) {
      const om = meta(o);
      const slots = new Set<number>();
      const objExtruder = num(om.extruder);
      for (const p of arr(o.part)) {
        const sub = p["@_subtype"];
        const e = num(meta(p).extruder);
        partSlot.set(
          `${o["@_id"]}/${p["@_id"]}`,
          sub && sub !== "normal_part" ? null : (e ?? objExtruder),
        );
        // A modifier with its own filament prints what it overlaps in that colour (e.g. embossed
        // text); negative parts and support blockers/enforcers print nothing.
        if (sub === "modifier_part" && e) slots.add(e);
        if (sub && sub !== "normal_part") continue;
        // A part without its own filament prints in the object's (as `partSlot` above).
        const slot = e ?? objExtruder;
        if (slot) slots.add(slot);
      }
      if (!slots.size && objExtruder) slots.add(objExtruder);
      objects.set(String(o["@_id"]), { name: str(om.name), slots });
    }

    // Painted triangles print in their own filaments (on printed parts; modifiers aren't printed).
    const build = await readBuild(zip);
    const painted = await paintedSlots(zip, build);
    for (const item of build)
      for (const c of item.components) {
        const slots = painted.get(`${c.path}#${c.id}`);
        if (!slots || partSlot.get(`${item.object}/${c.id}`) === null) continue;
        for (const s of slots) objects.get(item.object)?.slots.add(s);
      }

    const plates = new Map<number, ThreeMfPlate>();
    const plateFor = (index: number) => {
      let p = plates.get(index);
      if (!p) {
        p = {
          index,
          name: null,
          sliced: false,
          slicedOnSave: false,
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
    for (const p of list) {
      p.multicolor = p.filaments.length > 1;
      p.slicedOnSave = p.sliced || zip.has(`Metadata/plate_${p.index}.json`);
    }

    return {
      partColors: partColors(build, partSlot, colors),
      slicer: parseSlicer(head),
      printerModel: str(project.printer_model),
      printProfile: str(project.print_settings_id),
      nozzleDiameter: num((project.nozzle_diameter as unknown[] | undefined)?.[0]),
      sliced: list.some((p) => p.sliced),
      multicolor: list.some((p) => p.multicolor),
      plates: list,
      designTitle: headMeta(head, "Title"),
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
