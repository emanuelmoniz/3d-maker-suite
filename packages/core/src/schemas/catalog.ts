import { z } from "zod";
import { brandSchema, printerModelSchema } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

/**
 * "Brand Model", or just the model when it already starts with the brand: slicers name their
 * models "Bambu Lab A1", which would read "Bambu Lab Bambu Lab A1". Same rule as `modelName` (SQL).
 */
export function modelLabel(brand: string | null | undefined, model: string): string {
  const b = brand?.trim() ?? "";
  const m = model.trim();
  if (!b) return m;
  const lower = m.toLowerCase();
  return lower === b.toLowerCase() || lower.startsWith(`${b.toLowerCase()} `) ? m : `${b} ${m}`;
}

/**
 * A spool's filament, "Bambu Lab PLA Basic": the brand, then the name with the material in front
 * unless it starts with it (no name = the material). Same rule as `filamentName` (SQL).
 */
export const spoolFilament = (f: {
  brand?: string | null;
  material: string;
  name?: string | null;
}) => modelLabel(f.brand, modelLabel(f.material, f.name?.trim() || f.material));

// Brand -> printer model. Fields the user edits; `PATCH` takes any subset, plus
// `archived` to archive/restore.
export const brandInputSchema = brandSchema.pick({ name: true, url: true }).partial({ url: true });
export const brandPatchSchema = brandInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

export const printerModelInputSchema = printerModelSchema
  .pick({ brandId: true, model: true, powerW: true })
  .partial({ powerW: true });
export const printerModelPatchSchema = printerModelInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/**
 * Machine, print and filament profiles are slicer files (ADR-0020): nothing makes or edits one here,
 * `PATCH` only archives or restores.
 */
export const profilePatchSchema = z.object({ archived: z.boolean() }).strict();

/** "hand", or the adapter that imported the row (`catalogSource`). */
const source = { kind: "select" } as const;
/** "used" / "unused" (`profileUse`). */
const use = { kind: "select", options: ["used", "unused"] } as const;

export const brandSortFields = ["name", "slicer", "source", "createdAt"] as const;
export const brandFilters = {
  name: { kind: "text" },
  source,
  /** Slicer libraries (`bambu-studio`) of the profiles of the brand's models. */
  slicer: { kind: "select" },
} as const satisfies Record<string, ColumnFilter>;
/** `model` sorts and filters on "Brand Model". */
export const printerModelSortFields = [
  "model",
  "brand",
  "slicer",
  "source",
  "createdAt",
  "powerW",
] as const;
export const printerModelFilters = {
  model: { kind: "text" },
  source,
  brandId: { kind: "select" },
  powerW: { kind: "number" },
  /** Slicer libraries (`bambu-studio`) of the model's profiles. */
  slicer: { kind: "select" },
} as const satisfies Record<string, ColumnFilter>;
export const machineProfileSortFields = [
  "name",
  "model",
  "brand",
  "source",
  "use",
  "createdAt",
  "nozzleDiameterMm",
] as const;
export const machineProfileFilters = {
  name: { kind: "text" },
  printerModelId: { kind: "select" },
  /** The brand of the profile's model. */
  brandId: { kind: "select" },
  nozzleDiameterMm: { kind: "number" },
  /** "hand", or `<library>:system` / `<library>:user`. */
  source,
  use,
} as const satisfies Record<string, ColumnFilter>;
export const printProfileSortFields = [
  "name",
  "model",
  "brand",
  "source",
  "use",
  "createdAt",
  "nozzleDiameterMm",
  "layerHeightMm",
] as const;
export const printProfileFilters = {
  name: { kind: "text" },
  printerModelId: { kind: "select" },
  brandId: { kind: "select" },
  nozzleDiameterMm: { kind: "number" },
  layerHeightMm: { kind: "number" },
  source,
  use,
} as const satisfies Record<string, ColumnFilter>;

export type BrandInput = z.infer<typeof brandInputSchema>;
export type BrandPatch = z.infer<typeof brandPatchSchema>;
export type PrinterModelInput = z.infer<typeof printerModelInputSchema>;
export type PrinterModelPatch = z.infer<typeof printerModelPatchSchema>;
export { source as sourceFilter, use as useFilter };
export type ProfilePatch = z.infer<typeof profilePatchSchema>;
