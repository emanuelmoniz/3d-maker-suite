import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import type { ColumnFilter } from "./list.ts";

const minor = z.number().int(); // minor currency units

/** What one print (or one estimate) costs, by line. All amounts are minor units. */
export const costBreakdownSchema = z.object({
  material: minor,
  energy: minor,
  /**
   * Purchase price spread over lifetime hours: the printer's, plus each counted accessory's on it
   * when the print started. 0 when not configured.
   */
  wear: minor,
  /** Past maintenance spend spread over runtime, same devices as `wear`. 0 when not enabled. */
  maintenance: minor,
  total: minor,
  /** Filament grams that have no price, so `material` is understated. */
  unpricedGrams: z.number().nonnegative(),
});

/** Hourly/kWh rates in minor units. Fractions are fine, lines are rounded after multiplying. */
export const costRatesSchema = z.object({
  energyPerKwh: z.number().nonnegative(),
  wearPerHour: z.number().nonnegative(),
  maintenancePerHour: z.number().nonnegative(),
});

export const quoteSettingsSchema = z.object({
  laborHours: z.number().nonnegative(),
  /** Minor units per hour. */
  laborRatePerHour: z.number().int().nonnegative(),
  failureMarginPct: z.number().nonnegative(),
  markupPct: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

export const quoteBreakdownSchema = z.object({
  /** Production cost of one piece (material, energy, wear, maintenance). */
  unitCost: minor,
  labor: minor,
  failureMargin: minor,
  subtotal: minor,
  markup: minor,
  unitPrice: minor,
  quantity: z.number().int().positive(),
  total: minor,
});

/** A saved quote. `form` is the calculator state, restored as-is when the quote is reopened. */
export const quoteSchema = z.object({
  id,
  /** Short unique number the quote goes by ("001-Vase"). */
  number: z.number().int().positive(),
  projectId: id.nullable(),
  clientId: id.nullable(),
  name: z.string().min(1),
  notes: z.string().nullable(),
  form: z.record(z.string(), z.json()),
  cost: costBreakdownSchema,
  quote: quoteBreakdownSchema,
  createdAt: isoDate,
  updatedAt: isoDate,
});
/** `number` defaults to the next free one. `PATCH` takes any subset. */
export const quoteInputSchema = z.object({
  number: quoteSchema.shape.number.optional(),
  name: z.string().trim().min(1),
  notes: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null),
  projectId: id.nullable().optional(),
  clientId: id.nullable().optional(),
  form: quoteSchema.shape.form,
  cost: costBreakdownSchema,
  quote: quoteBreakdownSchema,
});
export const quotePatchSchema = quoteInputSchema.partial().strict();

export const quoteSortFields = [
  "name",
  "client",
  "project",
  "quantity",
  "total",
  "createdAt",
] as const;

/** Quotes table column filters (see `listQuery`). */
export const quoteFilters = {
  name: { kind: "text" },
  clientId: { kind: "select" },
  projectId: { kind: "select" },
  createdAt: { kind: "date" },
} as const satisfies Record<string, ColumnFilter>;

/** Everything the calculator needs from the server. Prices are per kg, minor units. */
export const costContextSchema = z.object({
  rates: z.object({ energyPerKwh: z.number() }),
  quoteDefaults: z.object({
    laborRatePerHour: z.number().int(),
    failureMarginPct: z.number(),
    markupPct: z.number(),
  }),
  printers: z.array(
    z.object({
      id,
      number: z.number().int(),
      name: z.string(),
      powerW: z.number().nullable(),
      wearPerHour: z.number(),
      maintenancePerHour: z.number(),
    }),
  ),
  /** Average price per kg of the (non-archived) profiles of each material, upper-case key. */
  materialPrices: z.record(z.string(), z.number()),
});

export type CostBreakdown = z.infer<typeof costBreakdownSchema>;
export type CostRates = z.infer<typeof costRatesSchema>;
export type QuoteSettings = z.infer<typeof quoteSettingsSchema>;
export type QuoteBreakdown = z.infer<typeof quoteBreakdownSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteInput = z.input<typeof quoteInputSchema>;
export type QuotePatch = z.input<typeof quotePatchSchema>;
export type CostContext = z.infer<typeof costContextSchema>;
