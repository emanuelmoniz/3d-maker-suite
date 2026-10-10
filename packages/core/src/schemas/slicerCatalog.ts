import { z } from "zod";

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
  brand: z.string().min(1),
  model: z.string().min(1),
  name: z.string().min(1),
  nozzleDiameterMm: z.number().positive(),
});

export const SLICER_CATALOG_TYPES = [
  "brands",
  "printerModels",
  "machineProfiles",
  "filamentBrands",
] as const;

/** What a zip of a slicer folder can offer: the catalog types plus the filament profiles. */
export const SLICER_ZIP_TYPES = [...SLICER_CATALOG_TYPES, "filamentProfiles"] as const;

/** A slicer whose config folder can be uploaded as a zip, and where that folder is per OS. */
export const slicerZipSourceSchema = z.object({
  id: z.string(),
  folders: z.object({ windows: z.string(), mac: z.string(), linux: z.string() }),
});
export const slicerZipUploadSchema = z.object({ uploadId: z.uuid() });

export type SlicerZipSource = z.infer<typeof slicerZipSourceSchema>;
export type CatalogModel = z.infer<typeof catalogModelSchema>;
export type CatalogMachine = z.infer<typeof catalogMachineSchema>;
export type SlicerCatalog = { models: CatalogModel[]; machines: CatalogMachine[] };
