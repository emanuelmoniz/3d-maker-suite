import { z } from "zod";
import { costBreakdownSchema } from "./cost.ts";
import { id, isoDate, printFilamentUsageSchema, printSchema } from "./entities.ts";
import { PRINT_OUTCOMES } from "./enums.ts";
import type { ColumnFilter } from "./list.ts";

/** Filament taken from one spool. The profile is derived from the spool. Failed prints use partial grams. */
export const printUsageInputSchema = z.object({
  spoolId: id,
  grams: z.number().positive(),
  slot: z.number().int().nonnegative().nullable().optional(),
});

/** A print with its filament rows and its cost (today's prices, see `printCosts` on the server). */
export const printDetailSchema = printSchema.and(
  z.object({ usages: z.array(printFilamentUsageSchema), cost: costBreakdownSchema }),
);

const base = z.object({
  printerId: id,
  projectId: id.nullable().optional(),
  machineProfileId: id.nullable().optional(),
  title: z.string().min(1),
  plate: z.number().int().positive().nullable().optional(),
  startedAt: isoDate,
  durationSec: z.number().int().nonnegative().nullable().optional(),
  outcome: z.enum(PRINT_OUTCOMES),
  failureReason: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  /** Manual override (stored as "measured"). Empty/null: estimated from printer power x duration. */
  energyWh: z.number().nonnegative().nullable().optional(),
  usages: z.array(printUsageInputSchema).max(16).default([]),
});

const successHasNoReason = {
  path: ["failureReason"],
  error: "failure_reason_not_allowed",
};

export const printInputSchema = base.refine(
  (p) => p.outcome !== "success" || !p.failureReason,
  successHasNoReason,
);

/** Any subset. Sending `usages` replaces the whole list. */
export const printPatchSchema = base
  .partial()
  .strict()
  .refine((p) => p.outcome !== "success" || !p.failureReason, successHasNoReason);

export const printSortFields = ["startedAt", "title", "outcome", "durationSec"] as const;

/** Prints table column filters (see `listQuery`). */
export const printFilters = {
  title: { kind: "text" },
  startedAt: { kind: "date" },
  printerId: { kind: "select" },
  projectId: { kind: "select" },
  outcome: { kind: "select", options: PRINT_OUTCOMES },
  tagId: { kind: "select" },
  durationSec: { kind: "number" },
} as const satisfies Record<string, ColumnFilter>;

export const filamentReviewSortFields = ["startedAt", "grams"] as const;

export type PrintUsageInput = z.infer<typeof printUsageInputSchema>;
export type PrintDetail = z.infer<typeof printDetailSchema>;
export type PrintInput = z.input<typeof printInputSchema>;
export type PrintPatch = z.infer<typeof printPatchSchema>;

/** An imported filament slot that has no spool yet. */
export const filamentReviewItemSchema = z.object({
  usageId: id,
  printId: id,
  printTitle: z.string(),
  startedAt: isoDate,
  slot: z.number().int().nonnegative().nullable(),
  grams: z.number().nonnegative(),
  material: z.string().nullable(),
  colorHex: z.string().nullable(),
});
export const reviewAssignSchema = z.object({ spoolId: id });
export const reviewDismissSchema = z.object({ usageIds: z.array(id).min(1).max(500) });

export type FilamentReviewItem = z.infer<typeof filamentReviewItemSchema>;
