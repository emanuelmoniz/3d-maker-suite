import { z } from "zod";
import { id, isoDate } from "./entities.ts";

// The hub's slicer preset library (ADR-0017): per slicer library (`bambu-studio`, `orca-slicer`)
// and kind, the preset's json as received, its versions and who saved them.

export const SLICER_PRESET_KINDS = ["machine", "process", "filament"] as const;
export const slicerPresetKindSchema = z.enum(SLICER_PRESET_KINDS);

/** A conflict copy's name, as hub files are named (`<name> (conflict <who> <when>)`). */
export const isPresetConflict = (name: string) => / \(conflict [^)]+\)$/.test(name);

const saved = {
  /** Who saved it and from which device (names as they were); null = on the hub, or unknown. */
  savedUser: z.string().nullable(),
  savedDevice: z.string().nullable(),
  savedAt: isoDate,
};

/** A live preset in `GET /api/presets`, without its json. */
export const slicerPresetSchema = z.object({
  id,
  library: z.string(),
  kind: slicerPresetKindSchema,
  name: z.string(),
  /** Its `inherits` parent (a system preset, usually); null = stands on its own. */
  inherits: z.string().nullable(),
  version: z.number().int(),
  sha256: z.string(),
  conflict: z.boolean(),
  ...saved,
});

export const slicerPresetVersionSchema = z.object({
  version: z.number().int(),
  sha256: z.string(),
  ...saved,
});

/** `GET /api/presets/:id`: the preset and its earlier versions, newest first. */
export const slicerPresetDetailSchema = slicerPresetSchema.extend({
  versions: z.array(slicerPresetVersionSchema),
});

export type SlicerPresetKind = z.infer<typeof slicerPresetKindSchema>;
export type SlicerPreset = z.infer<typeof slicerPresetSchema>;
export type SlicerPresetVersion = z.infer<typeof slicerPresetVersionSchema>;
export type SlicerPresetDetail = z.infer<typeof slicerPresetDetailSchema>;
