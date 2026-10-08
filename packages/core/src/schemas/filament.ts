import { z } from "zod";
import { filamentProfileSchema, spoolSchema } from "./entities.ts";

/** Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore. */
export const filamentProfileInputSchema = filamentProfileSchema
  .pick({
    brand: true,
    material: true,
    name: true,
    diameterMm: true,
    densityGcm3: true,
    pricePerKg: true,
    nozzleTempC: true,
    bedTempC: true,
  })
  .partial({
    brand: true,
    name: true,
    diameterMm: true,
    pricePerKg: true,
    nozzleTempC: true,
    bedTempC: true,
  });
export const filamentProfilePatchSchema = filamentProfileInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/** `remainingGrams` defaults to `initialGrams` (a new spool). Afterwards only `adjust` changes it. */
export const spoolInputSchema = spoolSchema
  .pick({
    profileId: true,
    colorHex: true,
    initialGrams: true,
    remainingGrams: true,
    emptyWeightGrams: true,
    pricePaid: true,
    purchasedAt: true,
    openedAt: true,
    location: true,
    status: true,
  })
  .partial({
    colorHex: true,
    remainingGrams: true,
    emptyWeightGrams: true,
    pricePaid: true,
    purchasedAt: true,
    openedAt: true,
    location: true,
    status: true,
  });
export const spoolPatchSchema = spoolInputSchema
  .omit({ remainingGrams: true })
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/** Set the remaining weight (e.g. after weighing); the API stores the difference as a ledger entry. */
export const spoolAdjustSchema = z.object({
  kind: z.enum(["manual", "correction"]),
  remainingGrams: spoolSchema.shape.remainingGrams,
  note: z.string().min(1).nullable().optional(),
});

export const filamentProfileSortFields = ["brand", "material", "createdAt"] as const;
export const spoolSortFields = ["createdAt", "remainingGrams", "purchasedAt"] as const;

export type FilamentProfileInput = z.infer<typeof filamentProfileInputSchema>;
export type FilamentProfilePatch = z.infer<typeof filamentProfilePatchSchema>;
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
    pricePerKg: true,
    nozzleTempC: true,
    bedTempC: true,
  })
  .extend({
    /** Stable within one library, e.g. `user/My PLA`. */
    presetId: z.string().min(1),
    scope: z.enum(["user", "system"]),
  });

/** `new` can be imported; `imported` came from this preset before; `duplicate` matches a profile you already have. */
export const LIBRARY_STATUSES = ["new", "imported", "duplicate"] as const;

export const librarySourceSchema = z.object({
  id: z.string(),
  /** First default folder that exists on this PC, if any (ignoring the override). */
  detectedDir: z.string().nullable(),
});

export const libraryQuerySchema = z.object({
  includeSystem: z.enum(["true", "false"]).default("false"),
});

export const libraryPreviewSchema = z.object({
  /** The folder that was read: the override from settings, else the detected one. */
  dir: z.string(),
  items: z.array(libraryPresetSchema.extend({ status: z.enum(LIBRARY_STATUSES) })),
});

export const libraryImportSchema = z.object({
  includeSystem: z.boolean().default(false),
  /** Preset ids picked in the preview; only those still `new` are created. */
  presetIds: z.array(z.string().min(1)).min(1),
});

export const libraryImportResultSchema = z.object({ created: z.number().int().nonnegative() });

/** A spool from an integration's inventory. `profile` names the filament, to find its profile. */
export const librarySpoolSchema = spoolSchema
  .pick({
    colorHex: true,
    initialGrams: true,
    remainingGrams: true,
    emptyWeightGrams: true,
    status: true,
  })
  .extend({
    /** The vendor's id; the server prefixes it with the adapter id (`bambu-cloud:123`). */
    spoolId: z.string().min(1),
    profile: filamentProfileSchema.pick({ brand: true, material: true, name: true }),
  });

export const librarySpoolPreviewSchema = z.object({
  items: z.array(
    librarySpoolSchema.extend({
      /** Imported before, so it can't be picked again. */
      imported: z.boolean(),
      /** Your profile with the same brand, material and name, if there is one. */
      profileId: z.string().nullable(),
    }),
  ),
});

export const librarySpoolImportSchema = z.object({
  /** Picked spools and the profile each goes on; already imported ones are skipped. */
  spools: z.array(z.object({ spoolId: z.string().min(1), profileId: z.uuid() })).min(1),
});

export type LibraryPreset = z.infer<typeof libraryPresetSchema>;
export type LibrarySpool = z.infer<typeof librarySpoolSchema>;
export type LibrarySpoolPreview = z.infer<typeof librarySpoolPreviewSchema>;
export type LibrarySpoolImport = z.infer<typeof librarySpoolImportSchema>;
export type LibraryPreview = z.infer<typeof libraryPreviewSchema>;
export type LibraryImport = z.infer<typeof libraryImportSchema>;
export type LibrarySource = z.infer<typeof librarySourceSchema>;
