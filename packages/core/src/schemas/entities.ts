import { z } from "zod";
import {
  ALERT_KINDS,
  ALERT_MODULES,
  ALERT_SEVERITIES,
  CAPABILITIES,
  COMMENT_STATUSES,
  ENERGY_SOURCES,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
  MAINTENANCE_TARGETS,
  ORIGINS,
  PRINT_OUTCOMES,
  SPOOL_STATUSES,
  SYNC_FREQUENCIES,
  SYNC_MERGES,
  SYNC_MODES,
  SYNC_SCOPES,
  TAGGABLE_TYPES,
  WEIGHT_ENTRY_KINDS,
} from "./enums.ts";

// Row shapes as stored in the DB (nullable columns are `null`, not `undefined`).
// Dates are UTC `toISOString()` strings so they sort and range-compare as text.
export const id = z.uuid();
export const isoDate = z.iso.datetime({ precision: 3 });
const grams = z.number().nonnegative();
const seconds = z.number().int().nonnegative();
const money = z.number().int().nonnegative(); // minor units
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

const timestamps = { createdAt: isoDate, updatedAt: isoDate };
const imported = {
  origin: z.enum(ORIGINS),
  integrationId: id.nullable(),
  externalId: z.string().nullable(),
};

/** One type's sync policy, as stored or (no row yet) its default. */
export const syncPolicySchema = z.object({
  type: z.enum(CAPABILITIES),
  /** `openInSlicer` and `slice` are actions: only `off` or `manual` (= on). */
  mode: z.enum(SYNC_MODES),
  /** Only used by `auto`. */
  frequency: z.enum(SYNC_FREQUENCIES),
  /** Last successful run of this type, manual or scheduled. */
  lastRunAt: isoDate.nullable(),
  /** Rows the last run left for the preview -> confirm flow. */
  pending: z.number().int().nonnegative(),
  /** Severities this task raises (error: failed run, warning: rows left pending, success). Null = all. */
  alertSeverities: z.array(z.enum(ALERT_SEVERITIES)).nullable(),
  /** Prints in `auto` mode: take the filament from the spools (off: link them only). */
  trackUsage: z.boolean(),
  /** Reviewed types except prints: which rows a run takes, and what it does with a change. */
  scope: z.enum(SYNC_SCOPES),
  merge: z.enum(SYNC_MERGES),
  /**
   * When an `auto` run happens; null = unset. 15m: minute offset (mod 15); 1h: minute; 1d: hour +
   * minute; 1w: weekday (0 = Sunday) + hour; 1M: day + hour. All unset = every `frequency` since
   * the last run.
   */
  atMinute: z.number().int().min(0).max(59).nullable(),
  atHour: z.number().int().min(0).max(23).nullable(),
  atWeekday: z.number().int().min(0).max(6).nullable(),
  atDay: z.number().int().min(1).max(28).nullable(),
});

/** API shape: the encrypted `secrets` column is never exposed, only whether it is set. */
export const integrationSchema = z.object({
  id,
  adapterId: z.string().min(1),
  /** The adapter's kind; the hub groups by it. */
  kind: z.enum(INTEGRATION_KINDS),
  enabled: z.boolean(),
  config: z.json(),
  hasSecrets: z.boolean(),
  /** Slicer config folder override; null = the detected one. */
  slicerConfigDir: z.string().nullable(),
  /** Slicer program used by "Open in slicer". */
  slicerPath: z.string().nullable(),
  /** Supported, switched on and set up: the only thing the UI looks at to offer actions. */
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** One per capability the adapter supports, in its order. */
  policies: z.array(syncPolicySchema),
  status: z.enum(INTEGRATION_STATUSES),
  lastSyncAt: isoDate.nullable(),
  lastError: z.enum(INTEGRATION_ERROR_CODES).nullable(),
  ...timestamps,
});

export const brandSchema = z.object({
  id,
  name: z.string().min(1),
  url: z.url().nullable(),
  /** Relative to the data directory. */
  logoPath: z.string().nullable(),
  ...timestamps,
});

export const printerModelSchema = z.object({
  id,
  brandId: id,
  model: z.string().min(1),
  /** Pre-fills a new printer's `powerW`. */
  powerW: z.number().int().nonnegative().nullable(),
  /** Relative to the data directory. Shown for printers without a photo of their own. */
  imagePath: z.string().nullable(),
  ...timestamps,
});

export const machineProfileSchema = z.object({
  id,
  name: z.string().min(1),
  printerModelId: id,
  nozzleDiameterMm: z.number().positive(),
  /** Preset this profile was imported from, `<library>:<preset id>`; null for hand-made ones. */
  sourcePreset: z.string().nullable(),
  /** An older version of an imported preset that prints still point at; hidden from pickers. */
  archivedAt: isoDate.nullable(),
  ...timestamps,
});

/** A slicer process preset: layer height, walls, infill, supports, speeds. */
export const printProfileSchema = z.object({
  id,
  name: z.string().min(1),
  /** The printer model it is made for; null when the preset names none we know. */
  printerModelId: id.nullable(),
  nozzleDiameterMm: z.number().positive().nullable(),
  layerHeightMm: z.number().positive().nullable(),
  /** Preset this profile was imported from, `<library>:<preset id>`; null for hand-made ones. */
  sourcePreset: z.string().nullable(),
  archivedAt: isoDate.nullable(),
  ...timestamps,
});

export const printerSchema = z.object({
  id,
  /** Short unique number the printer goes by ("02-Bambu A1"). */
  number: z.number().int().positive(),
  name: z.string().min(1),
  modelId: id,
  serial: z.string().nullable(),
  nozzleDiameterMm: z.number().positive(),
  runtimeOffsetSec: seconds,
  printsOffset: z.number().int().nonnegative(),
  purchasedAt: isoDate.nullable(),
  purchasePrice: money.nullable(),
  warrantyEndsAt: isoDate.nullable(),
  warrantyNotes: z.string().nullable(),
  /** One of `Preferences.printerStates`. */
  state: z.string().min(1),
  /** Typical draw while printing, used to estimate energy when a print has none. */
  powerW: z.number().int().nonnegative().nullable(),
  /** Wear: purchase price / these hours. Null = `Preferences.printerLifetimeHours`. */
  lifetimeHours: z.number().int().nonnegative().nullable(),
  /** Null = `Preferences.includeMaintenanceCost`. */
  includeMaintenanceCost: z.boolean().nullable(),
  /** Off: adds no wear or maintenance. Null = `Preferences.printerCountInCosts`. */
  countInCosts: z.boolean().nullable(),
  /** Default print profile for slicing a project's plates on this printer. */
  printProfileId: id.nullable(),
  /** Relative to the data directory. */
  photoPath: z.string().nullable(),
  archivedAt: isoDate.nullable(),
  ...imported,
  ...timestamps,
});

export const printerCommentSchema = z.object({
  id,
  printerId: id,
  body: z.string().min(1),
  pinned: z.boolean(),
  status: z.enum(COMMENT_STATUSES),
  ...timestamps,
});

export const accessorySchema = z.object({
  id,
  /** Short unique number the accessory goes by ("01-AMS"). */
  number: z.number().int().positive(),
  name: z.string().min(1),
  /** Free text ("AMS", "Hotend", …). */
  type: z.string().min(1),
  serial: z.string().nullable(),
  purchasedAt: isoDate.nullable(),
  purchasePrice: money.nullable(),
  warrantyEndsAt: isoDate.nullable(),
  warrantyNotes: z.string().nullable(),
  /** One of `Preferences.printerStates`. */
  state: z.string().min(1),
  /** Typical draw while in use. */
  powerW: z.number().int().nonnegative().nullable(),
  /** Cost settings like the printer's; null = the `accessory*` preference. */
  lifetimeHours: z.number().int().nonnegative().nullable(),
  includeMaintenanceCost: z.boolean().nullable(),
  /** Adds its wear and maintenance to prints of the printer it was on. */
  countInCosts: z.boolean().nullable(),
  /** Relative to the data directory. */
  photoPath: z.string().nullable(),
  archivedAt: isoDate.nullable(),
  /** Its open install (printer it is on now), else null. Not columns. */
  printerId: id.nullable(),
  installId: id.nullable(),
  installedAt: isoDate.nullable(),
  /** Usage: prints of the printers it was on, inside its install periods. Not columns. */
  runtimeSec: seconds,
  prints: z.number().int().nonnegative(),
  ...timestamps,
});

export const accessoryCommentSchema = printerCommentSchema
  .omit({ printerId: true })
  .extend({ accessoryId: id });

/** One period of an accessory on a printer, `[installedAt, removedAt)`; removedAt null = on it now. */
export const accessoryInstallSchema = z.object({
  id,
  accessoryId: id,
  printerId: id,
  installedAt: isoDate,
  removedAt: isoDate.nullable(),
  /** "02-Bambu A1", for the history list. Not a column. */
  printerLabel: z.string(),
  ...timestamps,
});

export const maintenanceTypeSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().nullable(),
  /** Link to the documentation / how-to for this task. */
  docUrl: z.url().nullable(),
  intervalSec: seconds.positive().nullable(),
  intervalPrints: z.number().int().positive().nullable(),
  intervalDays: z.number().int().positive().nullable(),
  /** Alert settings; null = the default (Settings' lead days, both alerts on). */
  warnLeadDays: z.number().int().nonnegative().nullable(),
  warnLeadHours: z.number().int().nonnegative().nullable(),
  warnLeadPrints: z.number().int().nonnegative().nullable(),
  warnEnabled: z.boolean().nullable(),
  errorEnabled: z.boolean().nullable(),
  /** Printers or accessories, never both. */
  target: z.enum(MAINTENANCE_TARGETS),
  /** Models and/or specific printers it applies to (union); both empty = every printer. */
  appliesToModelIds: z.array(id),
  appliesToPrinterIds: z.array(id),
  /** Same for accessories: their (free-text) types and/or specific ones. */
  appliesToAccessoryTypes: z.array(z.string().min(1)),
  appliesToAccessoryIds: z.array(id),
  archivedAt: isoDate.nullable(),
  ...timestamps,
});

export const maintenanceTaskSchema = z.object({
  id,
  /** Exactly one of them, the type's target. */
  printerId: id.nullable(),
  accessoryId: id.nullable(),
  typeId: id,
  doneAt: isoDate,
  printerRuntimeSecAt: seconds,
  printerPrintsAt: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  cost: money.nullable(),
  ...timestamps,
});

export const filamentBrandSchema = z.object({
  id,
  name: z.string().min(1),
  url: z.url().nullable(),
  /** Relative to the data directory. */
  logoPath: z.string().nullable(),
  ...timestamps,
});

export const filamentMaterialSchema = z.object({
  id,
  name: z.string().min(1),
  /** Pre-fill a new profile of this material. */
  nozzleTempC: z.number().int().positive().nullable(),
  bedTempC: z.number().int().nonnegative().nullable(),
  densityGcm3: z.number().positive().nullable(),
  ...timestamps,
});

export const filamentProfileSchema = z.object({
  id,
  brandId: id.nullable(),
  materialId: id,
  /** Names of the brand and material above (empty brand = none), for labels, sort and filters. */
  brand: z.string(),
  material: z.string().min(1),
  name: z.string(),
  diameterMm: z.number().positive(),
  densityGcm3: z.number().positive(),
  pricePerKg: money.nullable(),
  nozzleTempC: z.number().int().positive().nullable(),
  bedTempC: z.number().int().nonnegative().nullable(),
  /** Preset this profile was imported from, `<library>:<preset id>`; null for hand-made ones. */
  sourcePreset: z.string().nullable(),
  archivedAt: isoDate.nullable(),
  ...imported,
  ...timestamps,
});

export const spoolSchema = z.object({
  id,
  profileId: id,
  /** Short unique number the spool goes by ("012-Bambu PLA Matte Scarlet Red"). */
  number: z.number().int().positive(),
  colorHex: hexColor,
  /** e.g. "Scarlet Red"; the display name falls back to the hex without it. */
  colorName: z.string().trim().min(1).nullable(),
  initialGrams: grams,
  remainingGrams: grams,
  /** Weight of the empty spool, to turn a scale reading into filament left. */
  emptyWeightGrams: grams.nullable(),
  status: z.enum(SPOOL_STATUSES),
  pricePaid: money.nullable(),
  purchasedAt: isoDate.nullable(),
  openedAt: isoDate.nullable(),
  location: z.string().nullable(),
  /** Inventory entry this spool was imported from, `<library>:<spool id>`; null for hand-made ones. */
  sourceSpool: z.string().nullable(),
  /** Low-weight alert; null = the default (`lowSpoolGrams`, on). */
  lowGrams: grams.nullable(),
  lowAlert: z.boolean().nullable(),
  archivedAt: isoDate.nullable(),
  ...timestamps,
});

/** Immutable ledger: every change of `Spool.remainingGrams` is one row. */
export const spoolWeightEntrySchema = z.object({
  id,
  spoolId: id,
  kind: z.enum(WEIGHT_ENTRY_KINDS),
  /** Signed change in grams; the first entry of a spool is +initial remaining. */
  deltaGrams: z.number(),
  remainingAfter: grams,
  note: z.string().nullable(),
  createdAt: isoDate,
});

// Refinements mirror the CHECK constraints on `prints`.
export const printSchema = z
  .object({
    id,
    /** Short unique number the print goes by ("0042-Benchy"). */
    number: z.number().int().positive(),
    printerId: id,
    projectId: id.nullable(),
    /** The order it was printed for; its project is one of the order's. */
    orderId: id.nullable(),
    machineProfileId: id.nullable(),
    title: z.string().min(1),
    plate: z.number().int().positive().nullable(),
    startedAt: isoDate,
    durationSec: seconds.nullable(),
    /** Worked out from the grams (see `estimateDurationSec`); a real duration clears it. */
    durationEstimated: z.boolean(),
    outcome: z.enum(PRINT_OUTCOMES),
    failureReason: z.string().min(1).nullable(),
    notes: z.string().nullable(),
    energyWh: z.number().nonnegative().nullable(),
    energySource: z.enum(ENERGY_SOURCES).nullable(),
    costSnapshot: z.json().nullable(),
    /** Imported prints: the design page (e.g. MakerWorld), when the vendor gives it. */
    sourceUrl: z.string().nullable(),
    ...imported,
    ...timestamps,
  })
  .refine((p) => p.outcome !== "success" || p.failureReason === null, {
    path: ["failureReason"],
    error: "failure_reason_not_allowed",
  })
  .refine((p) => (p.energyWh === null) === (p.energySource === null), {
    path: ["energySource"],
    error: "energy_source_mismatch",
  });

export const printFilamentUsageSchema = z.object({
  id,
  printId: id,
  spoolId: id.nullable(),
  profileId: id.nullable(),
  grams,
  slot: z.number().int().nonnegative().nullable(),
  /** What an import reported for this slot; used to match a spool. Null for manual prints. */
  material: z.string().nullable(),
  colorHex: hexColor.nullable(),
  /** The user chose not to track this filament (review queue). */
  dismissed: z.boolean(),
});

export const tagSchema = z.object({ id, name: z.string().min(1), color: hexColor, ...timestamps });
export const taggingSchema = z.object({
  tagId: id,
  entityType: z.enum(TAGGABLE_TYPES),
  entityId: id,
});
export const collectionSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().nullable(),
  ...timestamps,
});
export const collectionProjectSchema = z.object({
  collectionId: id,
  projectId: id,
  position: z.number().int().nonnegative(),
});

export const alertSchema = z.object({
  id,
  kind: z.enum(ALERT_KINDS),
  severity: z.enum(ALERT_SEVERITIES),
  module: z.enum(ALERT_MODULES),
  /** What raised it: `spool:<id>`, `maintenance:<target>:<type>`, `printer:<id>`, `sync:<integration>:<type>`. */
  task: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  createdAt: isoDate,
  /** Names and numbers for display, captured when the alert was raised. */
  context: z.record(z.string(), z.union([z.string(), z.number()])),
  readAt: isoDate.nullable(),
  snoozedUntil: isoDate.nullable(),
  dismissedAt: isoDate.nullable(),
  resolvedAt: isoDate.nullable(),
  /** The last status change (read, snooze, dismiss, resolve); null = never touched. */
  updatedAt: isoDate.nullable(),
  /** There is a detail (`GET /api/alerts/:id`); the list leaves it out. */
  hasDetail: z.boolean(),
});

export type Integration = z.infer<typeof integrationSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type PrinterModel = z.infer<typeof printerModelSchema>;
export type MachineProfile = z.infer<typeof machineProfileSchema>;
export type PrintProfile = z.infer<typeof printProfileSchema>;
export type Printer = z.infer<typeof printerSchema>;
export type PrinterComment = z.infer<typeof printerCommentSchema>;
export type Accessory = z.infer<typeof accessorySchema>;
export type AccessoryComment = z.infer<typeof accessoryCommentSchema>;
export type AccessoryInstall = z.infer<typeof accessoryInstallSchema>;
export type MaintenanceType = z.infer<typeof maintenanceTypeSchema>;
export type MaintenanceTask = z.infer<typeof maintenanceTaskSchema>;
export type FilamentBrand = z.infer<typeof filamentBrandSchema>;
export type FilamentMaterial = z.infer<typeof filamentMaterialSchema>;
export type FilamentProfile = z.infer<typeof filamentProfileSchema>;
export type Spool = z.infer<typeof spoolSchema>;
export type SpoolWeightEntry = z.infer<typeof spoolWeightEntrySchema>;
export type Print = z.infer<typeof printSchema>;
export type PrintFilamentUsage = z.infer<typeof printFilamentUsageSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Tagging = z.infer<typeof taggingSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionProject = z.infer<typeof collectionProjectSchema>;
export type Alert = z.infer<typeof alertSchema>;

export const clientSchema = z.object({
  id,
  name: z.string().min(1),
  mobile: z.string().min(1),
  /** VAT, mobile and email are unique when filled (email ignoring case). */
  vat: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  ...timestamps,
});
