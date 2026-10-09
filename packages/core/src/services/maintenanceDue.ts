import { z } from "zod";

/** Share of an interval used up from which a task counts as "upcoming". */
export const UPCOMING_AT = 0.9;
const DAY_MS = 86_400_000;

export const maintenanceStatusSchema = z.enum(["ok", "upcoming", "overdue"]);
export const dueBySchema = z.enum(["hours", "count", "days"]);

export interface MaintenanceInterval {
  intervalSec: number | null;
  intervalPrints: number | null;
  intervalDays: number | null;
}

/** Printer usage at a point in time: lifetime runtime and print count (offsets included). */
export interface UsageSnapshot {
  at: string;
  runtimeSec: number;
  prints: number;
}

export const maintenanceDueSchema = z.object({
  status: maintenanceStatusSchema,
  /** Which interval is closest to (or past) its limit; null when the type has no interval. */
  dueBy: dueBySchema.nullable(),
  /** Used share of the closest interval; 1 = due now, above 1 = overdue. */
  progress: z.number(),
  /** Remaining until due, per interval (negative = overdue). Null when that interval is unset. */
  remainingSec: z.number().nullable(),
  remainingPrints: z.number().nullable(),
  remainingDays: z.number().nullable(),
  /** Calendar due date, only when the type has a days interval. */
  dueAt: z.iso.datetime({ precision: 3 }).nullable(),
});
export type MaintenanceDue = z.infer<typeof maintenanceDueSchema>;

/**
 * Whichever interval (hours, print count, days) is used up first decides the status.
 * `since` is the last time the task was done, or the printer's start when it never was
 * (`{ at: purchase/created date, runtimeSec: 0, prints: 0 }`).
 */
export function maintenanceDue(
  interval: MaintenanceInterval,
  since: UsageSnapshot,
  now: UsageSnapshot,
): MaintenanceDue {
  const days = (now: string, then: string) => (Date.parse(now) - Date.parse(then)) / DAY_MS;
  const checks = [
    ["hours", interval.intervalSec, now.runtimeSec - since.runtimeSec],
    ["count", interval.intervalPrints, now.prints - since.prints],
    ["days", interval.intervalDays, days(now.at, since.at)],
  ] as const;

  let dueBy: MaintenanceDue["dueBy"] = null;
  let progress = 0;
  const left: Record<string, number | null> = { hours: null, count: null, days: null };
  for (const [kind, limit, used] of checks) {
    if (limit === null) continue;
    left[kind] = limit - used;
    if (dueBy === null || used / limit > progress) {
      dueBy = kind;
      progress = used / limit;
    }
  }
  return {
    status: progress >= 1 ? "overdue" : progress >= UPCOMING_AT ? "upcoming" : "ok",
    dueBy,
    progress,
    remainingSec: left.hours ?? null,
    remainingPrints: left.count ?? null,
    remainingDays: left.days ?? null,
    dueAt:
      interval.intervalDays === null
        ? null
        : new Date(Date.parse(since.at) + interval.intervalDays * DAY_MS).toISOString(),
  };
}

/** No models and no printers = every printer; otherwise the printer is listed or its model matches. */
export const appliesToPrinter = (
  type: { appliesToModels: string[]; appliesToPrinterIds: string[] },
  printer: { id: string; model: string },
) => {
  if (!type.appliesToModels.length && !type.appliesToPrinterIds.length) return true;
  const model = printer.model.trim().toLowerCase();
  return (
    type.appliesToPrinterIds.includes(printer.id) ||
    type.appliesToModels.some((m) => m.trim().toLowerCase() === model)
  );
};
