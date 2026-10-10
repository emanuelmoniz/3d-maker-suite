import { z } from "zod";
import {
  ALERT_KINDS,
  CAPABILITIES,
  COMMENT_STATUSES,
  ENERGY_SOURCES,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
  ORIGINS,
  PRINT_OUTCOMES,
  SPOOL_STATUSES,
  SYNC_FREQUENCIES,
  SYNC_MODES,
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
  /** `openInSlicer` is an action: only `off` or `manual` (= on). */
  mode: z.enum(SYNC_MODES),
  /** Only used by `auto`. */
  frequency: z.enum(SYNC_FREQUENCIES),
  /** Last successful run of this type, manual or scheduled. */
  lastRunAt: isoDate.nullable(),
  /** Rows the last run left for the preview -> confirm flow. */
  pending: z.number().int().nonnegative(),
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
  ...timestamps,
});

export const printerSchema = z.object({
  id,
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

export const maintenanceTypeSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().nullable(),
  intervalSec: seconds.positive().nullable(),
  intervalPrints: z.number().int().positive().nullable(),
  intervalDays: z.number().int().positive().nullable(),
  /** Models and/or specific printers it applies to (union); both empty = every printer. */
  appliesToModelIds: z.array(id),
  appliesToPrinterIds: z.array(id),
  archivedAt: isoDate.nullable(),
  ...timestamps,
});

export const maintenanceTaskSchema = z.object({
  id,
  printerId: id,
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
  colorHex: hexColor,
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
    printerId: id,
    projectId: id.nullable(),
    machineProfileId: id.nullable(),
    title: z.string().min(1),
    plate: z.number().int().positive().nullable(),
    startedAt: isoDate,
    durationSec: seconds.nullable(),
    outcome: z.enum(PRINT_OUTCOMES),
    failureReason: z.string().min(1).nullable(),
    notes: z.string().nullable(),
    energyWh: z.number().nonnegative().nullable(),
    energySource: z.enum(ENERGY_SOURCES).nullable(),
    costSnapshot: z.json().nullable(),
    /** Imported prints: cover image and design page (e.g. MakerWorld), when the vendor gives them. */
    coverUrl: z.string().nullable(),
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
  entityType: z.string(),
  entityId: z.string(),
  createdAt: isoDate,
  /** Names and numbers for display, captured when the alert was raised. */
  context: z.record(z.string(), z.union([z.string(), z.number()])),
  readAt: isoDate.nullable(),
  snoozedUntil: isoDate.nullable(),
  dismissedAt: isoDate.nullable(),
  resolvedAt: isoDate.nullable(),
});

export type Integration = z.infer<typeof integrationSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type PrinterModel = z.infer<typeof printerModelSchema>;
export type MachineProfile = z.infer<typeof machineProfileSchema>;
export type Printer = z.infer<typeof printerSchema>;
export type PrinterComment = z.infer<typeof printerCommentSchema>;
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
