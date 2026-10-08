import { z } from "zod";
import { filamentProfileSchema, spoolSchema } from "./entities.ts";

/** Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore. */
export const filamentProfileInputSchema = filamentProfileSchema
  .pick({
    brand: true,
    material: true,
    name: true,
    colorHex: true,
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
