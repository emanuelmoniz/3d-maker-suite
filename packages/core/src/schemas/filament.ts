import { z } from "zod";
import { sourceFilter, useFilter } from "./catalog.ts";
import {
  filamentBrandSchema,
  filamentMaterialSchema,
  filamentProfileSchema,
  spoolSchema,
} from "./entities.ts";
import { SPOOL_STATUSES } from "./enums.ts";
import type { ColumnFilter } from "./list.ts";

// Filament brands and materials. Fields the user edits; `PATCH` takes any subset, plus `archived`.
export const filamentBrandInputSchema = filamentBrandSchema
  .pick({ name: true, url: true })
  .partial({ url: true });
export const filamentBrandPatchSchema = filamentBrandInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();
export const filamentMaterialInputSchema = filamentMaterialSchema
  .pick({ name: true, nozzleTempC: true, bedTempC: true, densityGcm3: true, pricePerKg: true })
  .partial({ nozzleTempC: true, bedTempC: true, densityGcm3: true, pricePerKg: true });
export const filamentMaterialPatchSchema = filamentMaterialInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();
export const filamentBrandSortFields = ["name", "source", "createdAt"] as const;
export const filamentMaterialSortFields = ["name", "source", "createdAt"] as const;
export const filamentCatalogFilters = {
  name: { kind: "text" },
  source: sourceFilter,
} as const satisfies Record<string, ColumnFilter>;

/**
 * `remainingGrams` defaults to `initialGrams` (a new spool). Afterwards only `adjust` changes it.
 * No `initialGrams` = weight not known yet. `number` defaults to the next free one.
 */
export const spoolInputSchema = spoolSchema
  .pick({
    brandId: true,
    materialId: true,
    name: true,
    number: true,
    colorHex: true,
    colorName: true,
    initialGrams: true,
    remainingGrams: true,
    emptyWeightGrams: true,
    pricePaid: true,
    purchasedAt: true,
    openedAt: true,
    location: true,
    status: true,
    lowGrams: true,
    lowAlert: true,
  })
  .partial({
    brandId: true,
    name: true,
    number: true,
    colorHex: true,
    colorName: true,
    initialGrams: true,
    remainingGrams: true,
    emptyWeightGrams: true,
    pricePaid: true,
    purchasedAt: true,
    openedAt: true,
    location: true,
    status: true,
    lowGrams: true,
    lowAlert: true,
  });
export const spoolPatchSchema = spoolInputSchema
  .omit({ remainingGrams: true })
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/** Set the remaining weight (e.g. after weighing); the API stores the difference as a ledger entry. */
export const spoolAdjustSchema = z.object({
  kind: z.enum(["manual", "correction"]),
  remainingGrams: spoolSchema.shape.remainingGrams.unwrap(),
  note: z.string().min(1).nullable().optional(),
});

export const filamentProfileSortFields = [
  "brand",
  "material",
  "source",
  "use",
  "createdAt",
  "filament",
] as const;
export const spoolSortFields = [
  "createdAt",
  "remainingGrams",
  "purchasedAt",
  "filament",
  "status",
] as const;

/** `filament` is the profile label ("brand material name"). */
export const filamentProfileFilters = {
  filament: { kind: "text" },
  brandId: { kind: "select" },
  materialId: { kind: "select" },
  source: sourceFilter,
  use: useFilter,
} as const satisfies Record<string, ColumnFilter>;

export const spoolFilters = {
  filament: { kind: "text" },
  remainingGrams: { kind: "number" },
  status: { kind: "select", options: SPOOL_STATUSES },
  tagId: { kind: "select" },
} as const satisfies Record<string, ColumnFilter>;

export type FilamentBrandInput = z.infer<typeof filamentBrandInputSchema>;
export type FilamentBrandPatch = z.infer<typeof filamentBrandPatchSchema>;
export type FilamentMaterialInput = z.infer<typeof filamentMaterialInputSchema>;
export type FilamentMaterialPatch = z.infer<typeof filamentMaterialPatchSchema>;
export type SpoolInput = z.infer<typeof spoolInputSchema>;
export type SpoolPatch = z.infer<typeof spoolPatchSchema>;
export type SpoolAdjust = z.infer<typeof spoolAdjustSchema>;

/** A filament preset read from a slicer's local library (Bambu Studio, ...). */
export const libraryPresetSchema = filamentProfileSchema
  .pick({
    brand: true,
    material: true,
    name: true,
    diameterMm: true,
    densityGcm3: true,
    nozzleTempC: true,
    bedTempC: true,
  })
  .extend({
    /** Stable within one library, e.g. `user/My PLA`. */
    presetId: z.string().min(1),
    scope: z.enum(["user", "system"]),
  });

export const librarySourceSchema = z.object({
  id: z.string(),
  /** First default folder that exists on this PC, if any (ignoring the override). */
  detectedDir: z.string().nullable(),
});

/** A spool from an integration's inventory, with the filament it describes. */
export const librarySpoolSchema = spoolSchema
  .pick({
    colorHex: true,
    colorName: true,
    initialGrams: true,
    remainingGrams: true,
    emptyWeightGrams: true,
    status: true,
  })
  .partial({ colorName: true })
  .extend({
    /** The vendor's id; the server prefixes it with the adapter id (`bambu-cloud:123`). */
    spoolId: z.string().min(1),
    filament: filamentProfileSchema.pick({ brand: true, material: true, name: true }),
  });

export type LibraryPreset = z.infer<typeof libraryPresetSchema>;
export type LibrarySpool = z.infer<typeof librarySpoolSchema>;
export type LibrarySource = z.infer<typeof librarySourceSchema>;
