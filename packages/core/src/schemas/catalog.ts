import type { z } from "zod";
import {
  brandSchema,
  machineProfileSchema,
  printerModelSchema,
  printProfileSchema,
} from "./entities.ts";
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

// Brand -> printer model -> machine profile. Fields the user edits; `PATCH` takes any subset.
export const brandInputSchema = brandSchema.pick({ name: true, url: true }).partial({ url: true });
export const brandPatchSchema = brandInputSchema.partial().strict();

export const printerModelInputSchema = printerModelSchema
  .pick({ brandId: true, model: true, powerW: true })
  .partial({ powerW: true });
export const printerModelPatchSchema = printerModelInputSchema.partial().strict();

export const machineProfileInputSchema = machineProfileSchema
  .pick({ name: true, printerModelId: true, nozzleDiameterMm: true, sourcePreset: true })
  .partial({ nozzleDiameterMm: true, sourcePreset: true });
export const machineProfilePatchSchema = machineProfileInputSchema.partial().strict();

export const printProfileInputSchema = printProfileSchema
  .pick({
    name: true,
    printerModelId: true,
    nozzleDiameterMm: true,
    layerHeightMm: true,
    sourcePreset: true,
  })
  .partial({
    printerModelId: true,
    nozzleDiameterMm: true,
    layerHeightMm: true,
    sourcePreset: true,
  });
export const printProfilePatchSchema = printProfileInputSchema.partial().strict();

export const brandSortFields = ["name", "createdAt"] as const;
export const brandFilters = { name: { kind: "text" } } as const satisfies Record<
  string,
  ColumnFilter
>;
/** `model` sorts and filters on "Brand Model". */
export const printerModelSortFields = ["model", "brand", "createdAt", "powerW"] as const;
export const printerModelFilters = {
  model: { kind: "text" },
  brandId: { kind: "select" },
  powerW: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;
export const machineProfileSortFields = ["name", "model", "createdAt", "nozzleDiameterMm"] as const;
export const machineProfileFilters = {
  name: { kind: "text" },
  printerModelId: { kind: "select" },
  nozzleDiameterMm: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;
export const printProfileSortFields = [
  "name",
  "createdAt",
  "nozzleDiameterMm",
  "layerHeightMm",
] as const;
export const printProfileFilters = {
  name: { kind: "text" },
  printerModelId: { kind: "select" },
  nozzleDiameterMm: { kind: "number" },
  layerHeightMm: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;

export type BrandInput = z.infer<typeof brandInputSchema>;
export type BrandPatch = z.infer<typeof brandPatchSchema>;
export type PrinterModelInput = z.infer<typeof printerModelInputSchema>;
export type PrinterModelPatch = z.infer<typeof printerModelPatchSchema>;
export type MachineProfileInput = z.infer<typeof machineProfileInputSchema>;
export type MachineProfilePatch = z.infer<typeof machineProfilePatchSchema>;
export type PrintProfileInput = z.infer<typeof printProfileInputSchema>;
export type PrintProfilePatch = z.infer<typeof printProfilePatchSchema>;
