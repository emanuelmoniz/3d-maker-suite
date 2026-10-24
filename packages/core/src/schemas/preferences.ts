import { z } from "zod";
import { UPDATE_CHANNELS } from "./enums.ts";
import { LOG_LEVELS, LOG_MODULES } from "./logs.ts";

export const LANGUAGES = ["en"] as const;
export const UNIT_SYSTEMS = ["metric", "imperial"] as const;
export const THEME_MODES = ["light", "dark", "system"] as const;
export const ACCENT_COLORS = ["teal", "blue", "violet", "rose", "amber"] as const;
export const DATE_FORMATS = [
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "DD.MM.YYYY",
] as const;
export const TIME_FORMATS = ["24h", "12h"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** One widget on the Home dashboard. `type` names a registered web widget; `settings` is its own schema. */
export const dashboardWidgetSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  settings: z.record(z.string(), z.json()),
});

/** A folder searched for projects, with its own scan settings. */
export const projectRootSchema = z.object({
  path: z.string().min(1),
  /** How many folder levels below the root a project may sit (1 = direct subfolders). */
  projectDepth: z.number().int().min(1).max(5),
  /** Subfolder levels below a project folder that are listed and watched; null = all. */
  filesDepth: z.number().int().min(0).nullable(),
  /** Off: its projects don't slice again when a file changes (unless a project says so). */
  autoSlice: z.boolean(),
});
export type ProjectRoot = z.infer<typeof projectRootSchema>;
export const PROJECT_ROOT_DEFAULTS: Omit<ProjectRoot, "path"> = {
  projectDepth: 1,
  filesDepth: null,
  autoSlice: true,
};
/** A root with the default settings, unless `over` says otherwise. */
export const projectRoot = (path: string, over: Partial<ProjectRoot> = {}): ProjectRoot => ({
  ...PROJECT_ROOT_DEFAULTS,
  ...over,
  path,
});

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
/** The root `path` sits in (the deepest one if roots nest), or undefined. Plain string match. */
export function rootOf<R extends { path: string }>(path: string, roots: R[]): R | undefined {
  const p = normPath(path);
  return roots
    .filter((r) => {
      const n = normPath(r.path);
      return p === n || p.startsWith(`${n}/`);
    })
    .sort((a, b) => b.path.length - a.path.length)[0];
}

const shape = {
  language: z.enum(LANGUAGES),
  units: z.enum(UNIT_SYSTEMS),
  defaultPrinterId: z.string().nullable(),
  dateFormat: z.enum(DATE_FORMATS),
  timeFormat: z.enum(TIME_FORMATS),
  themeMode: z.enum(THEME_MODES),
  accent: z.enum(ACCENT_COLORS),
  /** Custom app name shown in the sidebar and tab title. Empty = the default (`common:appName`). */
  appName: z.string().trim().max(60),
  currency: z.string().regex(/^[A-Z]{3}$/),
  energyCostPerKwh: z.number().nonnegative(),
  /** Printer wear: purchase price / these hours. 0 leaves wear out of the cost. Per-printer override. */
  printerLifetimeHours: z.number().nonnegative(),
  /** Pace for estimating a duration when no print of yours has both grams and a duration. */
  gramsPerHour: z.number().positive(),
  /** Spread past maintenance spend over printer runtime and add it to the cost. Per-printer override. */
  includeMaintenanceCost: z.boolean(),
  /** Off: printers add no wear or maintenance (their accessories still can). Per-printer override. */
  printerCountInCosts: z.boolean(),
  /** Same three for accessories, which add to the prints made while they were on a printer. */
  accessoryLifetimeHours: z.number().nonnegative(),
  accessoryIncludeMaintenanceCost: z.boolean(),
  accessoryCountInCosts: z.boolean(),
  /** Pricing calculator defaults. Money in major units, like energyCostPerKwh. */
  laborRatePerHour: z.number().nonnegative(),
  failureMarginPct: z.number().nonnegative(),
  markupPct: z.number().nonnegative(),
  projectRoots: z.array(projectRootSchema),
  /** Files a scan lists per project folder at most; the rest can't be picked or shown. */
  projectScanMaxFiles: z.number().int().min(100).max(100_000),
  /** Model files bigger than this show the plate thumbnail instead of the 3D viewer. */
  viewerMaxMb: z.number().positive(),
  /** Largest file one upload into a project folder may be. */
  projectUploadMaxMb: z.number().positive(),
  /** Integration whose slicer "Open in slicer" uses first. Missing / null = the first one. */
  defaultSlicerId: z.string().nullable(),
  lowSpoolGrams: z.number().nonnegative(),
  /** A warning per spool with no price, and per spool in use with no open date. */
  spoolNoPriceAlert: z.boolean(),
  spoolNoOpenDateAlert: z.boolean(),
  maintenanceLeadDays: z.number().int().nonnegative(),
  /** Default warning leads in print hours / prints before due; 0 = none. */
  maintenanceLeadHours: z.number().int().nonnegative(),
  maintenanceLeadPrints: z.number().int().nonnegative(),
  printerStates: z.array(z.string().min(1)).min(1),
  failureReasons: z.array(z.string().min(1)),
  /** An order's statuses, in order; a new order starts at the first. */
  orderStatuses: z.array(z.string().min(1)).min(1),
  dashboardLayout: z.array(dashboardWidgetSchema),
  /** Daily automatic backup, keeping this many of the newest automatic ones. */
  backupAuto: z.boolean(),
  backupKeep: z.number().int().min(1).max(100),
  /** Off: nothing is written to the `logs` table and the Logs page leaves the menu. */
  logActive: z.boolean(),
  logLevels: z.array(z.enum(LOG_LEVELS)),
  logModules: z.array(z.enum(LOG_MODULES)),
  /** Pruned hourly: older lines first, then the oldest beyond the max. */
  logRetentionDays: z.number().int().min(1).max(365),
  logMaxEntries: z.number().int().min(100).max(1_000_000),
  /** stable: releases from `main`; dev: pre-releases from `dev` too (ADR-0009). */
  updateChannel: z.enum(UPDATE_CHANNELS),
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
  dateFormat: "YYYY/MM/DD",
  timeFormat: "24h",
  themeMode: "system",
  accent: "teal",
  appName: "",
  currency: "EUR",
  energyCostPerKwh: 0.25,
  printerLifetimeHours: 0,
  gramsPerHour: 15,
  includeMaintenanceCost: false,
  printerCountInCosts: true,
  accessoryLifetimeHours: 0,
  accessoryIncludeMaintenanceCost: false,
  accessoryCountInCosts: true,
  laborRatePerHour: 0,
  failureMarginPct: 5,
  markupPct: 20,
  projectRoots: [],
  projectScanMaxFiles: 1000,
  viewerMaxMb: 30,
  projectUploadMaxMb: 1024,
  defaultSlicerId: null,
  lowSpoolGrams: 100,
  spoolNoPriceAlert: false,
  spoolNoOpenDateAlert: false,
  maintenanceLeadDays: 7,
  maintenanceLeadHours: 0,
  maintenanceLeadPrints: 0,
  printerStates: ["working", "maintenance", "inop", "retired"],
  orderStatuses: ["accepted", "in_progress", "done", "canceled"],
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
  logActive: false,
  logLevels: ["info", "success", "warn", "error"],
  logModules: [...LOG_MODULES],
  logRetentionDays: 14,
  logMaxEntries: 10_000,
  updateChannel: "stable",
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

type PreferenceKey = keyof z.infer<typeof preferencesSchema>;

/** ADR-0012: display keys every user (viewer too) sets for themselves, over the global value. */
export const USER_PREFERENCE_KEYS = [
  "language",
  "units",
  "dateFormat",
  "timeFormat",
  "themeMode",
  "accent",
  "dashboardLayout",
] as const satisfies readonly PreferenceKey[];

/** ADR-0012: global keys an editor may change. Every other key is admin-only, new ones included. */
export const EDITOR_PREFERENCE_KEYS = [
  "currency",
  "energyCostPerKwh",
  "printerLifetimeHours",
  "gramsPerHour",
  "includeMaintenanceCost",
  "printerCountInCosts",
  "accessoryLifetimeHours",
  "accessoryIncludeMaintenanceCost",
  "accessoryCountInCosts",
  "laborRatePerHour",
  "failureMarginPct",
  "markupPct",
  "defaultPrinterId",
  "defaultSlicerId",
  "lowSpoolGrams",
  "spoolNoPriceAlert",
  "spoolNoOpenDateAlert",
  "maintenanceLeadDays",
  "maintenanceLeadHours",
  "maintenanceLeadPrints",
  "printerStates",
  "failureReasons",
  "orderStatuses",
] as const satisfies readonly PreferenceKey[];

export const preferencesPatchSchema = preferencesSchema.partial().strict();

export const preferencesResponseSchema = z.object({
  values: preferencesSchema,
  /** Read-only info, shown on the settings page. */
  dataDir: z.string(),
});

export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
