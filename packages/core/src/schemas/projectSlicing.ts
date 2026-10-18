import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { PRINT_MAX_SLOTS } from "./import.ts";

// What a project prints: the plates picked per 3MF file, and per plate the print profile and the
// filament profile per slot. Slicing (Step 14) turns this into time and grams per plate.

/** `outdated`: the file changed on disk since the setup was saved. `missing`: file or plate is gone. */
export const PLATE_STATES = ["ok", "outdated", "missing"] as const;

export const plateSetupInputSchema = z.object({
  /** A 3MF of the project, relative to its folder (one of `meta.files`). */
  file: z.string().min(1),
  /** 1-based, as `projectPlateSchema.index`. */
  plate: z.number().int().positive(),
  /** Null = the default printer's print profile, else the one saved in the 3MF. */
  printProfileId: id.nullable(),
  /** Filament profile per slot (index 0 = slot 1); null = the one saved in the 3MF. */
  filaments: z.array(id.nullable()).max(PRINT_MAX_SLOTS),
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
  /** Never sliced, the file changed, or the profiles (incl. the default printer's) changed. */
  needsSlicing: z.boolean(),
  /** In the slice queue right now. */
  job: z.enum(["queued", "running"]).nullable(),
});
export const projectSlicingSchema = z.object({
  plates: z.array(plateSetupSchema),
  /** A slicer is set up (an integration with `slice` switched on). */
  canSlice: z.boolean(),
});

/** A project in the list: no plates picked, some need slicing, or all sliced and current. */
export const PROJECT_SLICING = ["none", "needed", "done"] as const;

export type PlateState = (typeof PLATE_STATES)[number];
export type SliceResultInfo = z.infer<typeof sliceResultSchema>;
export type PlateSetupInput = z.infer<typeof plateSetupInputSchema>;
export type PlateSetup = z.infer<typeof plateSetupSchema>;
export type ProjectSlicingInput = z.infer<typeof projectSlicingInputSchema>;
export type ProjectSlicing = z.infer<typeof projectSlicingSchema>;
