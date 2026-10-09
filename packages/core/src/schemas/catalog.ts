import type { z } from "zod";
import { brandSchema, machineProfileSchema, printerModelSchema } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

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

export const brandSortFields = ["name", "createdAt"] as const;
export const brandFilters = { name: { kind: "text" } } as const satisfies Record<
  string,
  ColumnFilter
>;
/** `model` sorts and filters on "Brand Model". */
export const printerModelSortFields = ["model", "createdAt", "powerW"] as const;
export const printerModelFilters = {
  model: { kind: "text" },
  brandId: { kind: "select" },
  powerW: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;
export const machineProfileSortFields = ["name", "createdAt", "nozzleDiameterMm"] as const;
export const machineProfileFilters = {
  name: { kind: "text" },
  printerModelId: { kind: "select" },
  nozzleDiameterMm: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;

export type BrandInput = z.infer<typeof brandInputSchema>;
export type BrandPatch = z.infer<typeof brandPatchSchema>;
export type PrinterModelInput = z.infer<typeof printerModelInputSchema>;
export type PrinterModelPatch = z.infer<typeof printerModelPatchSchema>;
export type MachineProfileInput = z.infer<typeof machineProfileInputSchema>;
export type MachineProfilePatch = z.infer<typeof machineProfilePatchSchema>;
