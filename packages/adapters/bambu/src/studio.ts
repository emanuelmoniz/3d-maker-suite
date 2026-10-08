import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";
import type { FilamentLibrary, LibraryPreset } from "@3d-maker-suite/core";

// Bambu Studio keeps presets as JSON under its config folder (checked on Windows against an
// installed Bambu Studio 2.x; macOS and Linux paths are from Bambu's docs, not tested here):
//   user/<account id | default>/filament/**/<name>.json   your own presets
//   system/<vendor>/filament/<name>.json                 shipped ones (BBL, ...)
// Every value is a one-element array of strings. A preset only holds what differs from its
// `inherits` parent, so values are resolved up the chain; parents are found by name.

type Preset = Record<string, unknown>;

export function studioDefaultDirs(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string[] {
  if (platform === "win32")
    return [join(env.APPDATA ?? join(home, "AppData", "Roaming"), "BambuStudio")];
  if (platform === "darwin") return [join(home, "Library", "Application Support", "BambuStudio")];
  return [
    join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "BambuStudio"),
    join(home, ".var", "app", "com.bambulab.BambuStudio", "config", "BambuStudio"), // Flatpak
  ];
}

const jsonFiles = async (dir: string, deep: boolean): Promise<string[]> => {
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

const dirs = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const readJson = async (file: string): Promise<Preset | undefined> => {
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
const baseName = (n: string) => n.split(" @")[0]?.trim() || n;

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

/** System presets of a Studio folder, loaded lazily, and setting lookup through `inherits`. */
async function systemPresets(dir: string) {
  // name -> file for every system preset, for `inherits` lookups.
  const systemFiles = new Map<string, string>();
  for (const vendor of await dirs(join(dir, "system")))
    for (const f of await jsonFiles(join(dir, "system", vendor, "filament"), false))
      if (!systemFiles.has(parse(f).name)) systemFiles.set(parse(f).name, f);

  const cache = new Map<string, Preset | undefined>();
  const load = async (file: string) => {
    if (!cache.has(file)) cache.set(file, await readJson(file));
    return cache.get(file);
  };
  /** Setting lookup through the `inherits` chain, nearest first. */
  const resolver = async (start: Preset) => {
    const chain: Preset[] = [start];
    while (chain.length < 10) {
      const inherits = chain[chain.length - 1]?.inherits;
      const file = typeof inherits === "string" ? systemFiles.get(inherits) : undefined;
      const next = file && (await load(file));
      if (!next || chain.includes(next)) break;
      chain.push(next);
    }
    return (key: string) => chain.map((c) => first(c[key])).find((v) => v !== undefined);
  };
  return { systemFiles, load, resolver };
}

export function bambuStudioLibrary(
  defaultDirs: () => string[] = studioDefaultDirs,
): FilamentLibrary {
  return {
    id: "bambu-studio",
    defaultDirs,
    async read(dir, { includeSystem }) {
      const { systemFiles, load, resolver } = await systemPresets(dir);

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
          add(`system/${baseName(name)}`, toProfile(name, "system", await resolver(p)));
        }
      return [...out.values()];
    },
  };
}
