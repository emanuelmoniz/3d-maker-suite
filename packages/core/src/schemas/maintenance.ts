import { z } from "zod";
import { maintenanceDueSchema } from "../services/maintenanceDue.ts";
import { id, isoDate, maintenanceTaskSchema, maintenanceTypeSchema } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

/** Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore. */
export const maintenanceTypeInputSchema = maintenanceTypeSchema
  .pick({
    name: true,
    description: true,
    intervalSec: true,
    intervalPrints: true,
    intervalDays: true,
    appliesToModel: true,
  })
  .partial({
    description: true,
    intervalSec: true,
    intervalPrints: true,
    intervalDays: true,
    appliesToModel: true,
  });
export const maintenanceTypePatchSchema = maintenanceTypeInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/** "Log maintenance done". `doneAt` defaults to now; usage counters are snapshotted by the API. */
export const maintenanceLogSchema = maintenanceTaskSchema
  .pick({ printerId: true, typeId: true, notes: true, cost: true })
  .partial({ notes: true, cost: true })
  .extend({ doneAt: isoDate.optional() });

/** One printer x type pair with its next-due calculation. */
export const maintenanceDueItemSchema = maintenanceDueSchema.extend({
  printerId: id,
  printerName: z.string(),
  typeId: id,
  typeName: z.string(),
  lastDoneAt: isoDate.nullable(),
});

export const maintenanceTypeSortFields = ["name", "createdAt", "appliesToModel"] as const;
export const maintenanceTypeFilters = {
  name: { kind: "text" },
  appliesToModel: { kind: "text" },
} as const satisfies Record<string, ColumnFilter>;
export const maintenanceTaskSortFields = ["doneAt", "createdAt"] as const;

export type MaintenanceTypeInput = z.infer<typeof maintenanceTypeInputSchema>;
export type MaintenanceTypePatch = z.infer<typeof maintenanceTypePatchSchema>;
export type MaintenanceLog = z.infer<typeof maintenanceLogSchema>;
export type MaintenanceDueItem = z.infer<typeof maintenanceDueItemSchema>;
