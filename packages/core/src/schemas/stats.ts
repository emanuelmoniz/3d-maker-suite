import { z } from "zod";
import { dateRangeQuery, idList } from "./list.ts";

export const STATS_BUCKETS = ["day", "week", "month"] as const;

/** Filters shared by the JSON and CSV endpoints. Date range and ids work like the prints list. */
export const statsQuerySchema = dateRangeQuery.extend({
  printerId: idList.optional(),
  projectId: idList.optional(),
  outcome: idList.optional(),
  tagId: idList.optional(),
  spoolId: idList.optional(),
  profileId: idList.optional(),
  bucket: z.enum(STATS_BUCKETS).default("day"),
});

const minor = z.number().int(); // minor currency units

/** Every metric the page shows, for one group of prints. Money is in minor units. */
export const statsMetricsSchema = z.object({
  prints: z.number().int(),
  successes: z.number().int(),
  seconds: z.number().int(),
  energyWh: z.number(),
  grams: z.number(),
  unpricedGrams: z.number(),
  material: minor,
  energy: minor,
  wear: minor,
  maintenance: minor,
  total: minor,
});

const group = statsMetricsSchema.extend({
  key: z.string().nullable(),
  label: z.string().nullable(),
});

export const statsSchema = z.object({
  totals: statsMetricsSchema,
  /** One row per day/week/month that has prints; `key` is the bucket's first day (UTC). */
  series: z.array(statsMetricsSchema.extend({ key: z.string() })),
  breakdowns: z.object({
    printer: z.array(group),
    project: z.array(group),
    outcome: z.array(group),
    /** By filament profile: prints that used it, grams and material cost (other lines are 0). */
    filament: z.array(group),
  }),
});

export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type StatsMetrics = z.infer<typeof statsMetricsSchema>;
export type Stats = z.infer<typeof statsSchema>;
