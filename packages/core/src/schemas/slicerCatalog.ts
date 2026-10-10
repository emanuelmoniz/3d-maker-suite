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

/** `imported` = already in the catalog and the same; `changed` = would be updated (or archived and re-added). */
export const CATALOG_STATUSES = ["new", "imported", "changed"] as const;
export const CATALOG_KINDS = ["brand", "model", "machine", "filamentBrand", "material"] as const;

export const catalogItemSchema = z.object({
  /** Stable within one library and type; what the confirmed preview sends back. */
  key: z.string().min(1),
  kind: z.enum(CATALOG_KINDS),
  label: z.string(),
  status: z.enum(CATALOG_STATUSES),
});

export const catalogPreviewSchema = z.object({
  dir: z.string(),
  items: z.array(catalogItemSchema),
});

export const catalogImportSchema = z.object({ keys: z.array(z.string().min(1)).min(1) });

export type CatalogModel = z.infer<typeof catalogModelSchema>;
export type CatalogMachine = z.infer<typeof catalogMachineSchema>;
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type CatalogPreview = z.infer<typeof catalogPreviewSchema>;
export type CatalogImport = z.infer<typeof catalogImportSchema>;
export type SlicerCatalog = { models: CatalogModel[]; machines: CatalogMachine[] };
