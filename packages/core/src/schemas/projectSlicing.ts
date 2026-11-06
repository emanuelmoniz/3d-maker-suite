import { z } from "zod";
import { modelLabel } from "./catalog.ts";
import { id, isoDate } from "./entities.ts";
import { PRINT_MAX_SLOTS } from "./import.ts";

// What a project prints: the plates picked per 3MF file, and per plate the printer, the print
// profile and per slot the filament preset and the spool. Slicing turns this into time and grams.

/** `outdated`: the file changed on disk since the setup was saved. `missing`: file or plate is gone. */
export const PLATE_STATES = ["ok", "outdated", "missing"] as const;
/** A plate's slice job. */
export const SLICE_JOB_STATES = ["queued", "running", "waiting"] as const;

export const plateSetupInputSchema = z.object({
  /** A 3MF of the project, relative to its folder (one of `meta.files`). */
  file: z.string().min(1),
  /** 1-based, as `projectPlateSchema.index`. */
  plate: z.number().int().positive(),
  /** The printer it slices for: its machine preset and cost rates. Null = `defaultSlicePrinter`. */
  printerId: id.nullable().default(null),
  /**
   * The print profile. Null with `useDefaultPrintProfile` = the printer's default profile; null
   * without = the one saved in the 3MF (only when the printer fits the file, see `printerFitsFile`).
   */
  printProfileId: id.nullable(),
  useDefaultPrintProfile: z.boolean().default(false),
  /** Filament profile per slot (index 0 = slot 1); null = the one saved in the 3MF. */
  filaments: z.array(id.nullable()).max(PRINT_MAX_SLOTS),
  /** Spool per slot, for its price; it never sets the slot's preset (ADR-0020). */
  spools: z.array(id.nullable()).max(PRINT_MAX_SLOTS).default([]),
  /** The slicer integration; null = the project's, then the default slicer (see `pickSlicer`). */
  slicerIntegrationId: id.nullable().default(null),
});

export const projectSlicingInputSchema = z.object({
  plates: z
    .array(plateSetupInputSchema)
    .refine(
      (plates) => new Set(plates.map((p) => `${p.file}#${p.plate}`)).size === plates.length,
      "A plate can only be listed once",
    ),
});

/** The last slice of a plate. Grams per slot; `material` is the 3MF's type for the slot. */
export const sliceResultSchema = z.object({
  printTimeSeconds: z.number().int().nonnegative(),
  weightGrams: z.number().nonnegative(),
  filaments: z.array(
    z.object({ slot: z.number().int(), grams: z.number(), material: z.string().nullable() }),
  ),
  slicedAt: isoDate,
});

export const plateSetupSchema = plateSetupInputSchema.extend({
  state: z.enum(PLATE_STATES),
  /** Kept when outdated, so the estimate still shows; `needsSlicing` says it is stale. */
  result: sliceResultSchema.nullable(),
  /** Why the last slice failed, in the slicer's words (not translated). */
  error: z.string().nullable(),
  /** Never sliced, the file, the profiles (incl. the default printer's) or the slicer changed. */
  needsSlicing: z.boolean(),
  /** In the slice queue right now; `waiting`: for its slice worker's device to come online. */
  job: z.enum(SLICE_JOB_STATES).nullable(),
});
export const projectSlicingSchema = z.object({
  plates: z.array(plateSetupSchema),
  /** A slicer is set up (an integration with `slice` switched on). */
  canSlice: z.boolean(),
  /** A slicer of the server itself can slice: waiting plates may fall back to it. */
  canFallback: z.boolean(),
});
/** `POST /api/projects/:id/slicing/run`; `fallback`: the plates waiting for a worker slice here. */
export const projectSliceRunSchema = z.object({ fallback: z.boolean().default(false) });

type SlicePrinter = { id: string; model: string; brand?: string | null; nozzleDiameterMm: number };
type SliceFile = { printerModel: string | null; nozzleDiameter: number | null };

/** The printer is the 3MF's: same model (and nozzle, when the file says), so its own settings fit. */
export function printerFitsFile(printer: SlicePrinter, file: SliceFile): boolean {
  const want = file.printerModel?.trim().toLowerCase();
  if (!want) return false;
  const names = [printer.model, modelLabel(printer.brand, printer.model)];
  return (
    names.some((n) => n.trim().toLowerCase() === want) &&
    (file.nozzleDiameter == null || Math.abs(printer.nozzleDiameterMm - file.nozzleDiameter) < 1e-3)
  );
}

/** A new plate's printer: one that fits the file (the default printer first), else the default. */
export function defaultSlicePrinter<P extends SlicePrinter>(
  printers: P[],
  defaultPrinterId: string | null | undefined,
  file: SliceFile,
): P | undefined {
  const fits = printers.filter((p) => printerFitsFile(p, file));
  const preferred = (list: P[]) => list.find((p) => p.id === defaultPrinterId) ?? list[0];
  return preferred(fits) ?? preferred(printers);
}

/**
 * The slicer a plate slices with: the first of `picks` (plate, project, default slicer) that can
 * slice now, else the first one that can. A removed or switched-off pick is skipped, not cleared.
 */
export const pickSlicer = (capable: string[], picks: (string | null | undefined)[]) =>
  picks.find((p): p is string => !!p && capable.includes(p)) ?? capable[0];

type Preset = { name: string; sourcePreset: string | null };

/**
 * The first of a plate's profiles a slicer of `library` can't slice with, as the slice queue
 * checks them (presets are `<library>:<preset>`, so Bambu Studio's mean nothing to OrcaSlicer):
 * the print profile (a hand-made one fits no slicer) and a machine preset for the printer when it
 * isn't the file's (`machines`: its model's and nozzle's; unset when the file's printer slices).
 * Undefined when both fit. Filaments never block: see `foreignFilaments`.
 */
export function presetMisfit(
  library: string,
  p: { print?: Preset; machines?: Preset[]; printer?: string },
): string | undefined {
  const own = (x: Preset) => x.sourcePreset?.startsWith(`${library}:`);
  if (p.print && !own(p.print)) return p.print.name;
  if (p.machines && !p.machines.some(own)) return p.printer ?? "";
}

/** Filaments of another slicer's presets: a slicer of `library` slices them with the 3MF's own. */
export const foreignFilaments = (library: string, filaments: Preset[]) =>
  filaments.filter((f) => f.sourcePreset && !f.sourcePreset.startsWith(`${library}:`));

type SlotPreset = Preset & { id: string; brand: string; material: string };
type SlotSpool = { brand: string; material: string; name: string | null };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A preset's name without its brand, or the brand's first word, as migration 0104 named spools. */
function bareName(name: string, brand: string) {
  const lower = name.toLowerCase();
  for (const prefix of new Set([brand, brand.split(" ")[0] ?? ""]))
    if (prefix && lower.startsWith(`${prefix.toLowerCase()} `))
      return name.slice(prefix.length + 1).trim();
  return name.trim();
}
const userPreset = (p: Preset) => /^[^:]+:user\//.test(p.sourcePreset ?? "");

/**
 * The presets for a spool (ADR-0020): its brand, material and name, else its brand and material,
 * else Generic of its material; the first level with any wins, user presets first. `best` only
 * when one leads (the only user preset, else the only one): several head the picker, nothing is
 * guessed. A spool without a name is its material alone ("Bambu PLA").
 */
export function spoolPresets<P extends SlotPreset>(
  spool: SlotSpool,
  presets: P[],
): { level: "name" | "brand" | "generic"; presets: P[]; best?: P } | undefined {
  const ofMaterial = presets.filter((p) => same(p.material, spool.material));
  const ofBrand = spool.brand ? ofMaterial.filter((p) => same(p.brand, spool.brand)) : [];
  const name = spool.name ?? spool.material;
  const levels = [
    ["name", ofBrand.filter((p) => same(bareName(p.name, p.brand), name))],
    ["brand", ofBrand],
    ["generic", ofMaterial.filter((p) => same(p.brand, "Generic"))],
  ] as const;
  for (const [level, found] of levels) {
    if (!found.length) continue;
    const user = found.filter(userPreset);
    const lead = user.length ? user : found;
    return {
      level,
      presets: [...user, ...found.filter((p) => !userPreset(p))],
      best: lead.length === 1 ? lead[0] : undefined,
    };
  }
}

export type SlotAdvice<P> =
  | { kind: "suggest"; preset: P }
  | { kind: "mismatch"; preset?: P; presets: P[] };

/**
 * What a slot with a spool says about its preset (ADR-0020's table); it never changes one.
 * `current`: the slot's preset, or for "From the file" the 3MF's preset name and type. Nothing
 * when the preset already is the spool's brand and material, or no brand match exists; a quiet
 * suggestion when one does; a warning with the best match when the materials differ.
 */
export function slotAdvice<P extends SlotPreset>(
  spool: SlotSpool,
  current: { id: string | null; name: string | null; material: string | null },
  presets: P[],
): SlotAdvice<P> | undefined {
  // The 3MF names its preset for its printer ("Bambu PLA Basic @BBL A1"); the catalog doesn't.
  const fileName = current.name?.split(" @")[0];
  const preset = current.id
    ? presets.find((p) => p.id === current.id)
    : fileName
      ? presets.find((p) => same(p.name, fileName))
      : undefined;
  const material = preset?.material ?? current.material;
  const found = spoolPresets(spool, presets);
  if (material && !same(material, spool.material))
    return { kind: "mismatch", preset: found?.best, presets: found?.presets ?? [] };
  // A preset we can't name (a tuned one saved with the file, another slicer's) may be on purpose.
  if (!preset || (spool.brand && same(preset.brand, spool.brand))) return;
  if (found && found.level !== "generic" && found.best)
    return { kind: "suggest", preset: found.best };
}

/** A project in the list: no plates picked, some need slicing, or all sliced and current. */
export const PROJECT_SLICING = ["none", "needed", "done"] as const;

export type PlateState = (typeof PLATE_STATES)[number];
export type SliceResultInfo = z.infer<typeof sliceResultSchema>;
export type PlateSetupInput = z.infer<typeof plateSetupInputSchema>;
export type PlateSetup = z.infer<typeof plateSetupSchema>;
export type ProjectSlicingInput = z.infer<typeof projectSlicingInputSchema>;
export type ProjectSlicing = z.infer<typeof projectSlicingSchema>;
export type ProjectSliceRun = z.input<typeof projectSliceRunSchema>;
