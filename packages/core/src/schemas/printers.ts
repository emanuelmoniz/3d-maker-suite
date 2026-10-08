import { z } from "zod";
import { printerSchema } from "./entities.ts";
import { COMMENT_STATUSES } from "./enums.ts";

/** Fields the user edits. `PATCH` takes any subset, plus `archived` to archive/restore. */
export const printerInputSchema = printerSchema
  .pick({
    name: true,
    brand: true,
    model: true,
    serial: true,
    nozzleDiameterMm: true,
    purchasedAt: true,
    purchasePrice: true,
    warrantyEndsAt: true,
    warrantyNotes: true,
    state: true,
    powerW: true,
  })
  .partial({
    serial: true,
    nozzleDiameterMm: true,
    purchasedAt: true,
    purchasePrice: true,
    warrantyEndsAt: true,
    warrantyNotes: true,
    state: true,
    powerW: true,
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

export const printerSortFields = ["name", "createdAt"] as const;
export const archivedFilter = z.enum(["true", "false"]).default("false");

export type PrinterInput = z.infer<typeof printerInputSchema>;
export type PrinterPatch = z.infer<typeof printerPatchSchema>;
export type CommentInput = z.infer<typeof commentInputSchema>;
export type CommentPatch = z.infer<typeof commentPatchSchema>;
export type PrintStats = z.infer<typeof printStatsSchema>;
