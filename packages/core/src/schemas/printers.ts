import { z } from "zod";
import { printerSchema } from "./entities.ts";
import { COMMENT_STATUSES } from "./enums.ts";
import type { ColumnFilter } from "./list.ts";

/**
 * Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore.
 * `number` defaults to the next free one.
 */
export const printerInputSchema = printerSchema
  .pick({
    number: true,
    name: true,
    modelId: true,
    serial: true,
    nozzleDiameterMm: true,
    purchasedAt: true,
    purchasePrice: true,
    warrantyEndsAt: true,
    warrantyNotes: true,
    state: true,
    powerW: true,
    lifetimeHours: true,
    includeMaintenanceCost: true,
    countInCosts: true,
    printProfileId: true,
  })
  .partial({
    printProfileId: true,
    number: true,
    serial: true,
    nozzleDiameterMm: true,
    purchasedAt: true,
    purchasePrice: true,
    warrantyEndsAt: true,
    warrantyNotes: true,
    state: true,
    powerW: true,
    lifetimeHours: true,
    includeMaintenanceCost: true,
    countInCosts: true,
  });
export const printerPatchSchema = printerInputSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

export const commentInputSchema = z.object({
  body: z.string().trim().min(1),
  pinned: z.boolean().default(false),
});
export const commentPatchSchema = z
  .object({ body: z.string().trim().min(1), pinned: z.boolean(), status: z.enum(COMMENT_STATUSES) })
  .partial()
  .strict();

/** Totals for a set of prints (one printer, one period). Reusable by the Stats module. */
export const printStatsSchema = z.object({
  printCount: z.number().int(),
  successCount: z.number().int(),
  failedCount: z.number().int(),
  cancelledCount: z.number().int(),
  totalSec: z.number().int(),
  energyWh: z.number(),
});

/** A row of the printers list: the printer plus its lifetime usage (offsets + logged prints). */
export const printerRowSchema = printerSchema.extend({
  runtimeSec: z.number().int().nonnegative(),
  prints: z.number().int().nonnegative(),
  successRate: z.number().int().min(0).max(100).nullable(),
});

export const printerSortFields = [
  "name",
  "createdAt",
  "model",
  "state",
  "powerW",
  "runtimeSec",
  "prints",
  "successRate",
] as const;

/** Printers table column filters (see `listQuery`). States are user-defined, so not an enum. */
export const printerFilters = {
  name: { kind: "text" },
  model: { kind: "text" },
  state: { kind: "select" },
  tagId: { kind: "select" },
  powerW: { kind: "number" },
  prints: { kind: "number" },
  runtimeSec: { kind: "number" },
  successRate: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;
export const archivedFilter = z.enum(["true", "false"]).default("false");

export type PrinterRow = z.infer<typeof printerRowSchema>;
export type PrinterInput = z.infer<typeof printerInputSchema>;
export type PrinterPatch = z.infer<typeof printerPatchSchema>;
export type CommentInput = z.infer<typeof commentInputSchema>;
export type CommentPatch = z.infer<typeof commentPatchSchema>;
export type PrintStats = z.infer<typeof printStatsSchema>;
