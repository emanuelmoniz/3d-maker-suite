import { z } from "zod";

export const LANGUAGES = ["en"] as const;
export const UNIT_SYSTEMS = ["metric", "imperial"] as const;
export const THEME_MODES = ["light", "dark", "system"] as const;
export const ACCENT_COLORS = ["teal", "blue", "violet", "rose", "amber"] as const;

const shape = {
  language: z.enum(LANGUAGES),
  units: z.enum(UNIT_SYSTEMS),
  defaultPrinterId: z.string().nullable(),
  themeMode: z.enum(THEME_MODES),
  accent: z.enum(ACCENT_COLORS),
  currency: z.string().regex(/^[A-Z]{3}$/),
  energyCostPerKwh: z.number().nonnegative(),
  projectRoots: z.array(z.string().min(1)),
  slicerPath: z.string(),
  lowSpoolGrams: z.number().nonnegative(),
  maintenanceLeadDays: z.number().int().nonnegative(),
  printerStates: z.array(z.string().min(1)).min(1),
};

/** User preferences. Each key is one row in `settings`; missing rows fall back to these defaults. */
export const preferencesSchema = z.object(shape);

export const PREFERENCE_DEFAULTS: z.infer<typeof preferencesSchema> = {
  language: "en",
  units: "metric",
  defaultPrinterId: null,
  themeMode: "system",
  accent: "teal",
  currency: "EUR",
  energyCostPerKwh: 0.25,
  projectRoots: [],
  slicerPath: "",
  lowSpoolGrams: 100,
  maintenanceLeadDays: 7,
  printerStates: ["working", "maintenance", "inop", "retired"],
};

export const preferencesPatchSchema = preferencesSchema.partial().strict();

export const preferencesResponseSchema = z.object({
  values: preferencesSchema,
  /** Read-only info, shown on the settings page. */
  dataDir: z.string(),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
