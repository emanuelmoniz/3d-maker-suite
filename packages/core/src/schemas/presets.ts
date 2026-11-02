import { z } from "zod";
import { id, isoDate } from "./entities.ts";

// The hub's slicer preset library (ADR-0017): per slicer library (`bambu-studio`, `orca-slicer`)
// and kind, the preset's json as received, its versions and who saved them.

export const SLICER_PRESET_KINDS = ["machine", "process", "filament"] as const;
export const slicerPresetKindSchema = z.enum(SLICER_PRESET_KINDS);

/** A conflict copy's name, as hub files are named (`<name> (conflict <who> <when>)`). */
export const isPresetConflict = (name: string) => / \(conflict .+\)$/.test(name);

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
  /** The devices that deleted their copy (their names now); the hub keeps it. */
  removedOn: z.array(z.string()),
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

/** A device with a slicer in `GET /api/presets/devices`, and its switch. */
export const presetDeviceSchema = z.object({
  id,
  name: z.string(),
  online: z.boolean(),
  sharePresets: z.boolean(),
});
export const presetDeviceUpdateSchema = z.strictObject({ sharePresets: z.boolean() });

const presetRef = {
  library: z.string().max(100),
  kind: slicerPresetKindSchema,
  /** The file's name, for a preset without a `name` inside. */
  name: z.string().min(1).max(255),
};
/**
 * A connector's changed preset (`PUT /api/hub/device/presets`). `text` is the file as it is, since
 * json that doesn't parse is the hub's to report. `base`: the version it started from, 0 = none.
 */
export const presetUploadSchema = z.object({
  ...presetRef,
  base: z.number().int().nonnegative(),
  text: z.string().max(4 * 1024 * 1024),
});
/** The name the hub knows it by, and the hub's version (a conflict leaves that one as it was). */
export const presetUploadResultSchema = z.object({
  result: z.enum(["saved", "same", "conflict", "invalid"]),
  name: z.string(),
  version: z.number().int(),
});
/** A connector's preset file is gone (`POST /api/hub/device/presets/removed`). */
export const presetRemovedSchema = z.object(presetRef);

export type PresetDevice = z.infer<typeof presetDeviceSchema>;
export type PresetUpload = z.infer<typeof presetUploadSchema>;
export type PresetUploadResult = z.infer<typeof presetUploadResultSchema>;
export type PresetRemoved = z.infer<typeof presetRemovedSchema>;
export type SlicerPresetKind = z.infer<typeof slicerPresetKindSchema>;
export type SlicerPreset = z.infer<typeof slicerPresetSchema>;
export type SlicerPresetVersion = z.infer<typeof slicerPresetVersionSchema>;
export type SlicerPresetDetail = z.infer<typeof slicerPresetDetailSchema>;
