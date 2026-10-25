import { z } from "zod";
import { id, isoDate, syncPolicySchema } from "./entities.ts";
import {
  CAPABILITIES,
  type Capability,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_KINDS,
  LOGIN_CHALLENGES,
  PRINT_OUTCOMES,
  SYNC_LEFT_REASONS,
  SYNC_LOG_EVENTS,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  SYNC_TYPES,
  type SyncFrequency,
  type SyncMerge,
  type SyncMode,
  type SyncScope,
} from "./enums.ts";
import type { ColumnFilter } from "./list.ts";

// DTOs returned by adapters (docs/architecture.md). Core validates them before any DB write.
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const externalPrinterSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  model: z.string(),
  serial: z.string().optional(),
  nozzleDiameterMm: z.number().positive().optional(),
});

export const externalPrintSchema = z.object({
  externalId: z.string().min(1),
  printerExternalId: z.string().min(1),
  title: z.string().min(1),
  /**
   * A print of a published model is titled after the model; this is the print profile's name the
   * vendor titled it with before ("0.2mm layer, 2 walls, 15% infill").
   */
  profileTitle: z.string().min(1).optional(),
  /** 1-based plate of the project file that was printed, when the vendor says. */
  plate: z.number().int().positive().optional(),
  startedAt: isoDate,
  durationSec: z.number().int().nonnegative().optional(),
  outcome: z.enum(PRINT_OUTCOMES),
  failureReason: z.string().min(1).optional(),
  filaments: z.array(
    z.object({
      slot: z.number().int().nonnegative().optional(),
      material: z.string().optional(),
      colorHex: hexColor.optional(),
      grams: z.number().nonnegative(),
    }),
  ),
  /** Design page (e.g. MakerWorld). A plain string: stored and shown, never fetched. */
  sourceUrl: z.string().optional(),
});

/** `config` and `secrets` are checked against the adapter's own schemas by the server. */
export const integrationInputSchema = z.object({
  adapterId: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.json()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

/** Any subset. `secrets` keys that are sent replace the stored ones; others are kept. */
export const integrationPatchSchema = z
  .object({
    enabled: z.boolean(),
    config: z.record(z.string(), z.json()),
    secrets: z.record(z.string(), z.string()),
    slicerConfigDir: z.string().trim().nullable(),
    slicerPath: z.string().trim().nullable(),
    /** Only the listed types change, and only the fields sent. */
    policies: z.array(
      syncPolicySchema
        .pick({
          type: true,
          mode: true,
          frequency: true,
          alertSeverities: true,
          trackUsage: true,
          scope: true,
          merge: true,
          newWeight: true,
          newOpenedAt: true,
          atMinute: true,
          atHour: true,
          atWeekday: true,
          atDay: true,
          editorSync: true,
          editorReview: true,
        })
        .partial({
          mode: true,
          frequency: true,
          alertSeverities: true,
          trackUsage: true,
          scope: true,
          merge: true,
          newWeight: true,
          newOpenedAt: true,
          atMinute: true,
          atHour: true,
          atWeekday: true,
          atDay: true,
          editorSync: true,
          editorReview: true,
        }),
    ),
  })
  .partial()
  .strict();

/** What the setup form needs: JSON Schemas of the adapter's config and secret fields. */
export const adapterInfoSchema = z.object({
  id: z.string(),
  kind: z.enum(INTEGRATION_KINDS),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.unknown()),
  /** Secrets come from an interactive sign-in instead of the form. */
  login: z.boolean(),
  /** Everything the adapter supports (switched on or not). */
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** First default slicer config folder that exists on this PC, if the adapter reads one. */
  detectedConfigDir: z.string().nullable(),
});

/** Step 1 sends email + password, step 2 the code the vendor asked for. */
export const loginInputSchema = z.union([
  z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).strict(),
  z.object({ code: z.string().trim().min(1) }).strict(),
]);

export const loginResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }),
  z.object({ status: z.literal("challenge"), challenge: z.enum(LOGIN_CHALLENGES) }),
  z.object({ status: z.literal("error"), code: z.enum(INTEGRATION_ERROR_CODES) }),
]);

const WEEKLY: readonly Capability[] = [
  "brands",
  "printerModels",
  "filamentBrands",
  "filamentMaterials",
];
/**
 * What a type does until the user changes it (no stored row). Printers and prints sync on their
 * own; anything with a preview is imported by hand until the user picks `auto`. A change to a
 * printer or spool you have waits for you; catalog rows keep your edits.
 */
export const defaultPolicy = (
  type: Capability,
): { mode: SyncMode; frequency: SyncFrequency; scope: SyncScope; merge: SyncMerge } => ({
  ...(type === "prints"
    ? { mode: "auto", frequency: "1h" }
    : type === "printers"
      ? { mode: "auto", frequency: "1d" }
      : { mode: "manual", frequency: WEEKLY.includes(type) ? "1w" : "1d" }),
  scope: "all",
  merge: type === "printers" || type === "spools" ? "review" : "keepEdits",
});

export const syncRunSchema = z.object({
  id,
  integrationId: id,
  trigger: z.enum(SYNC_TRIGGERS),
  /** null on runs logged before sync was split by type. */
  type: z.enum(SYNC_TYPES).nullable(),
  /** The date range a manual prints sync asked for; null = incremental. */
  rangeFrom: isoDate.nullable(),
  rangeTo: isoDate.nullable(),
  startedAt: isoDate,
  finishedAt: isoDate,
  status: z.enum(SYNC_RUN_STATUSES),
  errorCode: z.enum(INTEGRATION_ERROR_CODES).nullable(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** One line of a run's log. Codes and row names only, never a raw or vendor error (ADR-0008). */
export const syncLogEntrySchema = z.object({
  event: z.enum(SYNC_LOG_EVENTS),
  /** The row's title or name as the source sent it. */
  label: z.string().optional(),
  /** `left`: why it waits for a person. */
  reason: z.enum(SYNC_LEFT_REASONS).optional(),
  /** `failed`: why. */
  code: z.enum(INTEGRATION_ERROR_CODES).optional(),
  /** `truncated`: how many lines were cut. */
  count: z.number().int().positive().optional(),
});

/** A run as "Sync now" gets it back: also the rows it left for a person to review. */
export const syncResultSchema = syncRunSchema.extend({
  updated: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});

/** One run = one type. Prints are incremental unless a range is given (prints only). */
export const syncRequestSchema = z
  .object({ type: z.enum(SYNC_TYPES), from: isoDate.optional(), to: isoDate.optional() })
  .refine((r) => !(r.from || r.to) || r.type === "prints", "A range needs type=prints")
  .refine((r) => !(r.from && r.to) || r.from <= r.to, "from must not be after to");

export const syncRunSortFields = ["startedAt"] as const;
export const syncRunFilters = {
  startedAt: { kind: "date" },
  type: { kind: "select", options: SYNC_TYPES },
  trigger: { kind: "select", options: SYNC_TRIGGERS },
  status: { kind: "select", options: SYNC_RUN_STATUSES },
} as const satisfies Record<string, ColumnFilter>;

export const testResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.enum(INTEGRATION_ERROR_CODES) }),
]);

export type ExternalPrinter = z.infer<typeof externalPrinterSchema>;
export type ExternalPrint = z.infer<typeof externalPrintSchema>;
export type IntegrationInput = z.input<typeof integrationInputSchema>;
export type IntegrationPatch = z.infer<typeof integrationPatchSchema>;
export type AdapterInfo = z.infer<typeof adapterInfoSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncRun = z.infer<typeof syncRunSchema>;
export type SyncLogEntry = z.infer<typeof syncLogEntrySchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;
export type SyncPolicy = z.infer<typeof syncPolicySchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type LoginRequest = z.infer<typeof loginInputSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
