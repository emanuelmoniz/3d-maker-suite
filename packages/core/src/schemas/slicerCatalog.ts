import { z } from "zod";
import { isCatalogType, type SYNC_MERGES, USER_PRESET_TYPES } from "./enums.ts";

// What a slicer ships besides filament: vendors (brands), printer models with a thumbnail, and
// machine presets. Read from its config folder; the server turns them into the catalog.

/** A printer model of the slicer's vendor index. `image` is a file on the server, never sent to the web. */
export const catalogModelSchema = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  image: z.string().nullable(),
});

/** A machine preset (a printer model with a nozzle). `presetId` is stable within one library. */
export const catalogMachineSchema = z.object({
  presetId: z.string().min(1),
  scope: z.enum(["user", "system"]),
  // Empty or null on a user preset with no readable parent: it waits for a person (ADR-0019).
  brand: z.string(),
  model: z.string(),
  name: z.string().min(1),
  nozzleDiameterMm: z.number().positive().nullable(),
  /** Its `default_print_profile`, as a process `presetId`; null when it names none we read. */
  defaultPrintPreset: z.string().nullable(),
});

/**
 * A process preset ("0.20mm Standard @BBL X1C"). `machines`: every machine of its
 * `compatible_printers` we read, as `presetId`s. `model` and nozzle come from the first of them;
 * null when it lists none the reader knows.
 */
export const catalogProcessSchema = z.object({
  presetId: z.string().min(1),
  scope: z.enum(["user", "system"]),
  name: z.string().min(1),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  nozzleDiameterMm: z.number().positive().nullable(),
  layerHeightMm: z.number().positive().nullable(),
  machines: z.array(z.string()),
});

export const SLICER_CATALOG_TYPES = [
  "brands",
  "printerModels",
  "machineProfiles",
  "printProfiles",
  "filamentBrands",
  "filamentMaterials",
] as const;

/** What a zip of a slicer folder can offer: the catalog types plus the filament profiles. */
export const SLICER_ZIP_TYPES = [...SLICER_CATALOG_TYPES, "filamentProfiles"] as const;

/** A slicer card's sections: the catalog's rows, and the system presets that point at them. */
export const SLICER_CATALOG_ROW_TYPES = [
  "brands",
  "printerModels",
  "filamentBrands",
  "filamentMaterials",
] as const;
export const SLICER_PRESET_TYPES = [
  "machineProfiles",
  "printProfiles",
  "filamentProfiles",
] as const;
/**
 * How a run writes a change to a row you have. "How to sync" (`merge`) is only for printers and
 * spools (ADR-0020): a profile follows its file, the four catalog types only fill empty fields.
 */
export const mergeOf = (
  type: string,
  merge: (typeof SYNC_MERGES)[number],
): (typeof SYNC_MERGES)[number] | "fill" =>
  !isCatalogType(type)
    ? merge
    : (SLICER_CATALOG_ROW_TYPES as readonly string[]).includes(type)
      ? "fill"
      : "overwrite";
/** The rows a user preset type writes. */
export const USER_PRESET_ENTITY = {
  userMachineProfiles: "machineProfiles",
  userPrintProfiles: "printProfiles",
  userFilamentProfiles: "filamentProfiles",
} as const;
/** What a slicer's files feed: these have no schedule, a change in the files runs them (ADR-0019). */
export const SLICER_FILE_TYPES = [...SLICER_ZIP_TYPES, ...USER_PRESET_TYPES] as const;

/** A slicer whose config folder can be uploaded as a zip, and where that folder is per OS. */
export const slicerZipSourceSchema = z.object({
  id: z.string(),
  folders: z.object({ windows: z.string(), mac: z.string(), linux: z.string() }),
});
export const slicerZipUploadSchema = z.object({ uploadId: z.uuid() });

export type SlicerZipSource = z.infer<typeof slicerZipSourceSchema>;
export type CatalogModel = z.infer<typeof catalogModelSchema>;
export type CatalogMachine = z.infer<typeof catalogMachineSchema>;
export type CatalogProcess = z.infer<typeof catalogProcessSchema>;
export type SlicerCatalog = {
  models: CatalogModel[];
  machines: CatalogMachine[];
  processes: CatalogProcess[];
};
