import { z } from "zod";
import { modelLabel } from "./catalog.ts";
import { id, isoDate } from "./entities.ts";
import { PRINT_MAX_SLOTS } from "./import.ts";

// What a project prints: the plates picked per 3MF file, and per plate the printer, the print
// profile and the filament (spool or profile) per slot. Slicing turns this into time and grams.

/** `outdated`: the file changed on disk since the setup was saved. `missing`: file or plate is gone. */
export const PLATE_STATES = ["ok", "outdated", "missing"] as const;

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
  /** Spool per slot, for its price; the server fills `filaments` with its profile. */
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
  /** In the slice queue right now. */
  job: z.enum(["queued", "running"]).nullable(),
});
export const projectSlicingSchema = z.object({
  plates: z.array(plateSetupSchema),
  /** A slicer is set up (an integration with `slice` switched on). */
  canSlice: z.boolean(),
});

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
 * the print profile (a hand-made one fits no slicer), a machine preset for the printer when it
 * isn't the file's (`machines`: its model's and nozzle's; unset when the file's printer slices),
 * and the filaments (a hand-made one keeps the 3MF's). Undefined when all fit.
 */
export function presetMisfit(
  library: string,
  p: { print?: Preset; machines?: Preset[]; printer?: string; filaments: Preset[] },
): string | undefined {
  const own = (x: Preset) => x.sourcePreset?.startsWith(`${library}:`);
  if (p.print && !own(p.print)) return p.print.name;
  if (p.machines && !p.machines.some(own)) return p.printer ?? "";
  return p.filaments.find((f) => f.sourcePreset && !own(f))?.name;
}

/** A project in the list: no plates picked, some need slicing, or all sliced and current. */
export const PROJECT_SLICING = ["none", "needed", "done"] as const;

export type PlateState = (typeof PLATE_STATES)[number];
export type SliceResultInfo = z.infer<typeof sliceResultSchema>;
export type PlateSetupInput = z.infer<typeof plateSetupInputSchema>;
export type PlateSetup = z.infer<typeof plateSetupSchema>;
export type ProjectSlicingInput = z.infer<typeof projectSlicingInputSchema>;
export type ProjectSlicing = z.infer<typeof projectSlicingSchema>;
