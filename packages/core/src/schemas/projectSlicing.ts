import { z } from "zod";
import { id } from "./entities.ts";
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

export const plateSetupSchema = plateSetupInputSchema.extend({ state: z.enum(PLATE_STATES) });
export const projectSlicingSchema = z.object({ plates: z.array(plateSetupSchema) });

export type PlateState = (typeof PLATE_STATES)[number];
export type PlateSetupInput = z.infer<typeof plateSetupInputSchema>;
export type PlateSetup = z.infer<typeof plateSetupSchema>;
export type ProjectSlicingInput = z.infer<typeof projectSlicingInputSchema>;
export type ProjectSlicing = z.infer<typeof projectSlicingSchema>;
