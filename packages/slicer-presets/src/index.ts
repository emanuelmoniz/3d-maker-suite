import { access, readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";
import type {
  CatalogMachine,
  CatalogModel,
  CatalogProcess,
  FilamentLibrary,
  LibraryPreset,
} from "@3d-maker-suite/core";

// Bambu Studio and its fork OrcaSlicer keep presets as JSON under the same config folder layout
// (checked on Windows against Bambu Studio 2.x and OrcaSlicer 2.4; this package is the shared reader):
//   user/<account id | default>/filament/**/<name>.json   your own presets
//   system/<vendor>/filament/**/<name>.json             shipped ones (BBL, ...); Orca nests them by brand
//   user/<account | default>/machine/**/<name>.json      your machine presets
//   system/<vendor>/machine/<name>.json                  shipped ones; `type: machine_model` files are models
//   user/<account | default>/process/**/<name>.json      your process (print) presets; system/<vendor>/process too
//   system/<vendor>.json                                 vendor index: name, machine_model_list
//   system/<vendor>/<model name>_cover.png               a model's thumbnail
// Every value is a one-element array of strings. A preset only holds what differs from its
// `inherits` parent, so values are resolved up the chain; parents are found by name.

export { cliSlicer } from "./slice.ts";

type Preset = Record<string, unknown>;

export const jsonFiles = async (dir: string, deep: boolean): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (e) =>
      e.isDirectory()
        ? deep
          ? jsonFiles(join(dir, e.name), deep)
          : []
        : e.name.endsWith(".json")
          ? [join(dir, e.name)]
          : [],
    ),
  );
  return nested.flat();
};

export const dirs = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

export const readJson = async (file: string): Promise<Preset | undefined> => {
  try {
    const j: unknown = JSON.parse(await readFile(file, "utf8"));
    return j && typeof j === "object" ? (j as Preset) : undefined;
  } catch {
    return undefined; // ponytail: broken files are skipped silently; surface them if users report missing presets
  }
};

/** First usable string of a setting (`["220", "220"]` or `"220"`); "nil" means unset. */
const first = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x !== "" && x !== "nil" ? x : undefined;
};

const num = (v: string | undefined) =>
  v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v);

/** "Bambu PLA Basic @BBL X1C" and "... @BBL A1" are one filament for different printers. */
export const baseName = (n: string) => n.split(" @")[0]?.trim() || n;

// The vendor index names it "Bambulab", which would be a second brand next to the "Bambu Lab" the
// cloud adapter already creates. ponytail: one entry; add the others as they show up.
const BRAND_NAMES: Record<string, string> = { BBL: "Bambu Lab" };

const DEFAULT_DENSITY = 1.24; // ponytail: PLA's density when a preset gives none; per-material table if it matters

export function toProfile(
  name: string,
  scope: LibraryPreset["scope"],
  get: (key: string) => string | undefined,
): Omit<LibraryPreset, "presetId"> | undefined {
  const material = get("filament_type");
  if (!material) return;
  const density = num(get("filament_density"));
  const cost = num(get("filament_cost"));
  const nozzle = num(get("nozzle_temperature"));
  const bed = num(get("hot_plate_temp"));
  return {
    scope,
    brand: get("filament_vendor") ?? "",
    material,
    name: baseName(name),
    diameterMm: num(get("filament_diameter")) || 1.75,
    densityGcm3: density && density > 0 ? density : DEFAULT_DENSITY,
    pricePerKg: cost && cost > 0 ? Math.round(cost * 100) : null, // cost is per kg, in major units
    nozzleTempC: nozzle && nozzle > 0 ? Math.round(nozzle) : null,
    bedTempC: bed !== undefined && bed >= 0 ? Math.round(bed) : null,
  };
}

/** System presets of one kind in a Studio folder, loaded lazily, and setting lookup through `inherits`. */
export async function systemPresets(dir: string, kind: "filament" | "machine" | "process") {
  // name -> file for every system preset (the first vendor's), and every vendor's file per name:
  // bases like `fdm_machine_common` exist once per vendor, with different values.
  const systemFiles = new Map<string, string>();
  const allFiles = new Map<string, string[]>();
  const vendorOf = new Map<string, string>();
  for (const vendor of await dirs(join(dir, "system")))
    for (const f of await jsonFiles(join(dir, "system", vendor, kind), true)) {
      const name = parse(f).name;
      if (!systemFiles.has(name)) systemFiles.set(name, f);
      allFiles.set(name, [...(allFiles.get(name) ?? []), f]);
      vendorOf.set(f, vendor);
    }
  /** A preset by name, from the vendor of `near` when it has one. */
  const find = (name: unknown, near?: string) => {
    if (typeof name !== "string") return;
    const files = allFiles.get(name) ?? [];
    const vendor = near && vendorOf.get(near);
    return files.find((f) => vendorOf.get(f) === vendor) ?? files[0];
  };

  const cache = new Map<string, Preset | undefined>();
  const load = async (file: string) => {
    if (!cache.has(file)) cache.set(file, await readJson(file));
    return cache.get(file);
  };
  /** The preset and its `inherits` parents with their files, nearest first. */
  const chainOf = async (start: Preset, startFile?: string) => {
    const chain = [{ preset: start, file: startFile }];
    while (chain.length < 10) {
      const last = chain[chain.length - 1];
      const file = find(last?.preset.inherits, last?.file);
      const next = file && (await load(file));
      if (!next || chain.some((c) => c.preset === next)) break;
      chain.push({ preset: next, file });
    }
    return chain;
  };
  /**
   * Every setting filled in, as one preset that stands on its own: parents (`inherits`) first,
   * then each one's `include`d templates (e.g. a printer's start and filament change G-code), then
   * its own values. The slicer CLI follows neither for a preset file it is given.
   */
  const flatten = async (start: Preset, startFile?: string): Promise<Preset> => {
    const out: Preset = {};
    for (const { preset, file } of (await chainOf(start, startFile)).reverse()) {
      const includes = Array.isArray(preset.include) ? preset.include : [];
      for (const name of includes) {
        const f = find(name, file);
        const { name: _n, instantiation: _i, ...values } = (f && (await load(f))) || {};
        Object.assign(out, values);
      }
      Object.assign(out, preset);
    }
    const { inherits: _, include: __, ...flat } = out;
    return flat;
  };
  /** Setting lookup through the `inherits` chain, nearest first. */
  const resolver = async (start: Preset, startFile?: string) => {
    const chain = (await chainOf(start, startFile)).map((c) => c.preset);
    const get = (key: string) => chain.map((c) => first(c[key])).find((v) => v !== undefined);
    /** The nearest non-empty list setting (`compatible_printers`). */
    const list = (key: string): string[] =>
      (chain.map((c) => c[key]).find((v) => Array.isArray(v) && v.length) as string[]) ?? [];
    return Object.assign(get, { list });
  };
  return { systemFiles, load, resolver, flatten };
}

export function slicerPresetLibrary(id: string, defaultDirs: () => string[]): FilamentLibrary {
  return {
    id,
    defaultDirs,
    async read(dir, { includeSystem }) {
      const { systemFiles, load, resolver } = await systemPresets(dir, "filament");

      const out = new Map<string, LibraryPreset>();
      const add = (presetId: string, p: Omit<LibraryPreset, "presetId"> | undefined) => {
        if (p && !out.has(presetId)) out.set(presetId, { ...p, presetId });
      };

      // User presets. Signed-in accounts and "default" can hold the same name; the first wins.
      for (const account of await dirs(join(dir, "user")))
        for (const f of await jsonFiles(join(dir, "user", account, "filament"), true)) {
          const p = await readJson(f);
          if (!p) continue;
          const name = typeof p.name === "string" ? p.name : parse(f).name;
          add(`user/${name}`, toProfile(name, "user", await resolver(p)));
        }

      if (includeSystem)
        for (const [name, f] of [...systemFiles].sort(([a], [b]) => a.localeCompare(b))) {
          const p = await load(f);
          // Only presets you can pick in the slicer (not the abstract `fdm_*` / `@base` ones).
          if (p?.instantiation !== "true") continue;
          add(`system/${baseName(name)}`, toProfile(name, "system", await resolver(p, f)));
        }
      return [...out.values()];
    },

    async readCatalog(dir) {
      const models = new Map<string, CatalogModel>(); // by lowercase model name
      const machines = new Map<string, CatalogMachine>();
      const { load, resolver, systemFiles } = await systemPresets(dir, "machine");
      const vendorOf = new Map<string, string>(); // system machine file -> brand

      for (const vendor of await dirs(join(dir, "system"))) {
        const index = await readJson(join(dir, "system", `${vendor}.json`));
        const brand = BRAND_NAMES[vendor] ?? first(index?.name) ?? vendor;
        const list: unknown = index?.machine_model_list;
        for (const m of Array.isArray(list) ? list : []) {
          const model = first((m as Preset)?.name);
          if (!model) continue;
          const cover = join(dir, "system", vendor, `${model}_cover.png`);
          const image = await access(cover).then(
            () => cover,
            () => null,
          );
          models.set(model.toLowerCase(), { brand, model, image });
        }
        for (const f of await jsonFiles(join(dir, "system", vendor, "machine"), true))
          vendorOf.set(f, brand);
      }

      const add = (
        presetId: string,
        scope: CatalogMachine["scope"],
        name: string,
        brand: string,
        get: (k: string) => string | undefined,
      ) => {
        const model = get("printer_model");
        const nozzle = num(get("nozzle_diameter"));
        if (!model || !nozzle || nozzle <= 0 || machines.has(presetId)) return;
        if (!models.has(model.toLowerCase()))
          models.set(model.toLowerCase(), { brand, model, image: null });
        machines.set(presetId, { presetId, scope, brand, model, name, nozzleDiameterMm: nozzle });
      };

      // User presets first, like filament ones: the first account that has a name wins.
      for (const account of await dirs(join(dir, "user")))
        for (const f of await jsonFiles(join(dir, "user", account, "machine"), true)) {
          const p = await readJson(f);
          if (!p) continue;
          const name = typeof p.name === "string" ? p.name : parse(f).name;
          const get = await resolver(p);
          const brand = models.get((get("printer_model") ?? "").toLowerCase())?.brand;
          if (brand) add(`user/${name}`, "user", name, brand, get);
        }

      for (const [name, f] of [...systemFiles].sort(([a], [b]) => a.localeCompare(b))) {
        const p = await load(f);
        // Only presets you can pick in the slicer (not `fdm_*` bases, models or gcode templates).
        if (p?.instantiation !== "true" || p.type !== "machine") continue;
        add(`system/${name}`, "system", name, vendorOf.get(f) ?? "", await resolver(p, f));
      }

      // Process presets. Model and nozzle come from the first compatible machine we read.
      // ponytail: first machine only; a process for several models lands on the first one's.
      const machineByName = new Map([...machines.values()].map((m) => [m.name, m]));
      const proc = await systemPresets(dir, "process");
      const processes = new Map<string, CatalogProcess>();
      const addProcess = (
        presetId: string,
        scope: CatalogProcess["scope"],
        name: string,
        get: Awaited<ReturnType<typeof proc.resolver>>,
      ) => {
        if (processes.has(presetId)) return;
        const m = get
          .list("compatible_printers")
          .map((n) => machineByName.get(n))
          .find(Boolean);
        const layer = num(get("layer_height"));
        processes.set(presetId, {
          presetId,
          scope,
          name,
          brand: m?.brand ?? null,
          model: m?.model ?? null,
          nozzleDiameterMm: m?.nozzleDiameterMm ?? null,
          layerHeightMm: layer && layer > 0 ? layer : null,
        });
      };
      for (const account of await dirs(join(dir, "user")))
        for (const f of await jsonFiles(join(dir, "user", account, "process"), true)) {
          const p = await readJson(f);
          if (!p) continue;
          const name = typeof p.name === "string" ? p.name : parse(f).name;
          addProcess(`user/${name}`, "user", name, await proc.resolver(p));
        }
      for (const [name, f] of [...proc.systemFiles].sort(([a], [b]) => a.localeCompare(b))) {
        const p = await proc.load(f);
        if (p?.instantiation !== "true") continue;
        addProcess(`system/${name}`, "system", name, await proc.resolver(p, f));
      }
      return {
        models: [...models.values()],
        machines: [...machines.values()],
        processes: [...processes.values()],
      };
    },
  };
}
