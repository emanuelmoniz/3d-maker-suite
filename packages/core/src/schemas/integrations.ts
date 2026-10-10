import { z } from "zod";
import { id, isoDate, syncPolicySchema } from "./entities.ts";
import {
  CAPABILITIES,
  type Capability,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_KINDS,
  LOGIN_CHALLENGES,
  PRINT_OUTCOMES,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  SYNC_TYPES,
  type SyncFrequency,
  type SyncMode,
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
  /** Cover image and design page (e.g. MakerWorld). Plain strings: stored and shown, never fetched. */
  coverUrl: z.string().optional(),
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
        .pick({ type: true, mode: true, frequency: true })
        .partial({ mode: true, frequency: true }),
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

const WEEKLY: readonly Capability[] = ["brands", "printerModels", "filamentBrands"];
/**
 * What a type does until the user changes it (no stored row). Printers and prints sync on their
 * own; anything with a preview is imported by hand until the user picks `auto`.
 */
export const defaultPolicy = (type: Capability): { mode: SyncMode; frequency: SyncFrequency } =>
  type === "prints"
    ? { mode: "auto", frequency: "1h" }
    : type === "printers"
      ? { mode: "auto", frequency: "1d" }
      : { mode: "manual", frequency: WEEKLY.includes(type) ? "1w" : "1d" };

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
export type SyncPolicy = z.infer<typeof syncPolicySchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type LoginRequest = z.infer<typeof loginInputSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
