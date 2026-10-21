import { z } from "zod";
import { maintenanceDueSchema } from "../services/maintenanceDue.ts";
import { id, isoDate, maintenanceTaskSchema, maintenanceTypeSchema } from "./entities.ts";
import { MAINTENANCE_TARGETS } from "./enums.ts";
import type { ColumnFilter } from "./list.ts";

/** Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore. */
export const maintenanceTypeInputSchema = maintenanceTypeSchema
  .pick({
    name: true,
    description: true,
    docUrl: true,
    intervalSec: true,
    intervalPrints: true,
    intervalDays: true,
    warnLeadDays: true,
    warnLeadHours: true,
    warnLeadPrints: true,
    warnEnabled: true,
    errorEnabled: true,
    target: true,
    appliesToModelIds: true,
    appliesToPrinterIds: true,
    appliesToAccessoryTypes: true,
    appliesToAccessoryIds: true,
  })
  .partial({
    description: true,
    docUrl: true,
    intervalSec: true,
    intervalPrints: true,
    intervalDays: true,
    warnLeadDays: true,
    warnLeadHours: true,
    warnLeadPrints: true,
    warnEnabled: true,
    errorEnabled: true,
    target: true,
    appliesToModelIds: true,
    appliesToPrinterIds: true,
    appliesToAccessoryTypes: true,
    appliesToAccessoryIds: true,
  });
export const maintenanceTypePatchSchema = maintenanceTypeInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/**
 * "Log maintenance done" on a printer or an accessory (one of the two, the type's target).
 * `doneAt` defaults to now; usage counters are snapshotted by the API.
 */
export const maintenanceLogSchema = maintenanceTaskSchema
  .pick({ typeId: true, notes: true, cost: true })
  .partial({ notes: true, cost: true })
  .extend({ printerId: id.optional(), accessoryId: id.optional(), doneAt: isoDate.optional() })
  .refine((b) => !b.printerId !== !b.accessoryId, {
    message: "Give either printerId or accessoryId",
  });

/** One printer (or accessory) x type pair with its next-due calculation. */
export const maintenanceDueItemSchema = maintenanceDueSchema.extend({
  target: z.enum(MAINTENANCE_TARGETS),
  /** The printer's or accessory's id and display name. */
  targetId: id,
  targetName: z.string(),
  typeId: id,
  typeName: z.string(),
  lastDoneAt: isoDate.nullable(),
});

export const maintenanceTypeSortFields = ["name", "createdAt", "appliesToModels"] as const;
export const maintenanceTypeFilters = {
  name: { kind: "text" },
  appliesToModels: { kind: "text" },
} as const satisfies Record<string, ColumnFilter>;
export const maintenanceTaskSortFields = ["doneAt", "createdAt"] as const;

export type MaintenanceTypeInput = z.infer<typeof maintenanceTypeInputSchema>;
export type MaintenanceTypePatch = z.infer<typeof maintenanceTypePatchSchema>;
export type MaintenanceLog = z.infer<typeof maintenanceLogSchema>;
export type MaintenanceDueItem = z.infer<typeof maintenanceDueItemSchema>;
