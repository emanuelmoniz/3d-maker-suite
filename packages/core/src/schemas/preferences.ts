import { z } from "zod";

export const LANGUAGES = ["en"] as const;
export const UNIT_SYSTEMS = ["metric", "imperial"] as const;
export const THEME_MODES = ["light", "dark", "system"] as const;
export const ACCENT_COLORS = ["teal", "blue", "violet", "rose", "amber"] as const;

/** One widget on the Home dashboard. `type` names a registered web widget; `settings` is its own schema. */
export const dashboardWidgetSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  settings: z.record(z.string(), z.json()),
});

const shape = {
  language: z.enum(LANGUAGES),
  units: z.enum(UNIT_SYSTEMS),
  defaultPrinterId: z.string().nullable(),
  themeMode: z.enum(THEME_MODES),
  accent: z.enum(ACCENT_COLORS),
  /** Custom app name shown in the sidebar and tab title. Empty = the default (`common:appName`). */
  appName: z.string().trim().max(60),
  currency: z.string().regex(/^[A-Z]{3}$/),
  energyCostPerKwh: z.number().nonnegative(),
  /** Printer wear: purchase price / these hours. 0 leaves wear out of the cost. */
  printerLifetimeHours: z.number().nonnegative(),
  /** Spread past maintenance spend over printer runtime and add it to the cost. */
  includeMaintenanceCost: z.boolean(),
  /** Pricing calculator defaults. Money in major units, like energyCostPerKwh. */
  laborRatePerHour: z.number().nonnegative(),
  failureMarginPct: z.number().nonnegative(),
  markupPct: z.number().nonnegative(),
  projectRoots: z.array(z.string().min(1)),
  /** How many folder levels below a root a project may sit (1 = direct subfolders). */
  projectScanDepth: z.number().int().min(1).max(5),
  /** Model files bigger than this show the plate thumbnail instead of the 3D viewer. */
  viewerMaxMb: z.number().positive(),
  /** Integration whose slicer "Open in slicer" uses first. Missing / null = the first one. */
  defaultSlicerId: z.string().nullable(),
  lowSpoolGrams: z.number().nonnegative(),
  maintenanceLeadDays: z.number().int().nonnegative(),
  printerStates: z.array(z.string().min(1)).min(1),
  failureReasons: z.array(z.string().min(1)),
  dashboardLayout: z.array(dashboardWidgetSchema),
  /** Daily automatic backup, keeping this many of the newest automatic ones. */
  backupAuto: z.boolean(),
  backupKeep: z.number().int().min(1).max(100),
};

/** User preferences. Each key is one row in `settings`; missing rows fall back to these defaults. */
export const preferencesSchema = z.object(shape);

const widget = (type: string, settings: Record<string, string | number> = {}) => ({
  id: type + JSON.stringify(settings),
  type,
  settings,
});

export const PREFERENCE_DEFAULTS: z.infer<typeof preferencesSchema> = {
  language: "en",
  units: "metric",
  defaultPrinterId: null,
  themeMode: "system",
  accent: "teal",
  appName: "",
  currency: "EUR",
  energyCostPerKwh: 0.25,
  printerLifetimeHours: 0,
  includeMaintenanceCost: false,
  laborRatePerHour: 0,
  failureMarginPct: 5,
  markupPct: 20,
  projectRoots: [],
  projectScanDepth: 1,
  viewerMaxMb: 30,
  defaultSlicerId: null,
  lowSpoolGrams: 100,
  maintenanceLeadDays: 7,
  printerStates: ["working", "maintenance", "inop", "retired"],
  failureReasons: [
    "Spaghetti",
    "Bed adhesion",
    "Warping",
    "Layer shift",
    "Clog",
    "Filament runout",
    "Power loss",
    "Other",
  ],
  backupAuto: true,
  backupKeep: 7,
  dashboardLayout: [
    widget("statCard", { metric: "prints" }),
    widget("statCard", { metric: "successRate" }),
    widget("statCard", { metric: "cost" }),
    widget("statCard", { metric: "hours" }),
    widget("seriesChart", { metric: "prints" }),
    widget("printerStates"),
    widget("maintenanceDue"),
    widget("lowSpools"),
    widget("recentPrints"),
  ],
};

export const preferencesPatchSchema = preferencesSchema.partial().strict();

export const preferencesResponseSchema = z.object({
  values: preferencesSchema,
  /** Read-only info, shown on the settings page. */
  dataDir: z.string(),
});

export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
