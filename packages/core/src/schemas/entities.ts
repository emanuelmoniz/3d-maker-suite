import { z } from "zod";
import {
  ALERT_KINDS,
  COMMENT_STATUSES,
  ENERGY_SOURCES,
  ORIGINS,
  PRINT_OUTCOMES,
  SPOOL_STATUSES,
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

export const settingSchema = z.object({ key: z.string().min(1), value: z.json() });

/** API shape: the encrypted `secrets` column is never exposed, only whether it is set. */
export const integrationSchema = z.object({
  id,
  adapterId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  config: z.json(),
  hasSecrets: z.boolean(),
  status: z.string(),
  lastSyncAt: isoDate.nullable(),
  lastError: z.string().nullable(),
  ...timestamps,
});

export const printerSchema = z.object({
  id,
  name: z.string().min(1),
  brand: z.string(),
  model: z.string(),
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
  appliesToModel: z.string().nullable(),
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

export const filamentProfileSchema = z.object({
  id,
  brand: z.string(),
  material: z.string().min(1),
  name: z.string(),
  colorHex: hexColor,
  diameterMm: z.number().positive(),
  densityGcm3: z.number().positive(),
  pricePerKg: money.nullable(),
  nozzleTempC: z.number().int().positive().nullable(),
  bedTempC: z.number().int().nonnegative().nullable(),
  archivedAt: isoDate.nullable(),
  ...imported,
  ...timestamps,
});

export const spoolSchema = z.object({
  id,
  profileId: id,
  initialGrams: grams,
  remainingGrams: grams,
  /** Weight of the empty spool, to turn a scale reading into filament left. */
  emptyWeightGrams: grams.nullable(),
  status: z.enum(SPOOL_STATUSES),
  pricePaid: money.nullable(),
  purchasedAt: isoDate.nullable(),
  openedAt: isoDate.nullable(),
  location: z.string().nullable(),
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

export const projectSchema = z.object({
  id,
  name: z.string().min(1),
  filePath: z.string().nullable(),
  sourceUrl: z.url().nullable(),
  thumbnailPath: z.string().nullable(),
  meta: z.json(),
  archivedAt: isoDate.nullable(),
  ...imported,
  ...timestamps,
});

// Refinements mirror the CHECK constraints on `prints`.
export const printSchema = z
  .object({
    id,
    printerId: id,
    projectId: id.nullable(),
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
  readAt: isoDate.nullable(),
  resolvedAt: isoDate.nullable(),
});

export type Setting = z.infer<typeof settingSchema>;
export type Integration = z.infer<typeof integrationSchema>;
export type Printer = z.infer<typeof printerSchema>;
export type PrinterComment = z.infer<typeof printerCommentSchema>;
export type MaintenanceType = z.infer<typeof maintenanceTypeSchema>;
export type MaintenanceTask = z.infer<typeof maintenanceTaskSchema>;
export type FilamentProfile = z.infer<typeof filamentProfileSchema>;
export type Spool = z.infer<typeof spoolSchema>;
export type SpoolWeightEntry = z.infer<typeof spoolWeightEntrySchema>;
export type Project = z.infer<typeof projectSchema>;
export type Print = z.infer<typeof printSchema>;
export type PrintFilamentUsage = z.infer<typeof printFilamentUsageSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Tagging = z.infer<typeof taggingSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionProject = z.infer<typeof collectionProjectSchema>;
export type Alert = z.infer<typeof alertSchema>;
