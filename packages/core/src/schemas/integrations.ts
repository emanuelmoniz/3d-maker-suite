import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import {
  INTEGRATION_ERROR_CODES,
  LOGIN_CHALLENGES,
  PRINT_OUTCOMES,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
} from "./enums.ts";

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
  projectFileName: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

/** `config` and `secrets` are checked against the adapter's own schemas by the server. */
export const integrationInputSchema = z.object({
  adapterId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.json()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

/** Any subset. `secrets` keys that are sent replace the stored ones; others are kept. */
export const integrationPatchSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean(),
    config: z.record(z.string(), z.json()),
    secrets: z.record(z.string(), z.string()),
  })
  .partial()
  .strict();

/** What the setup form needs: JSON Schemas of the adapter's config and secret fields. */
export const adapterInfoSchema = z.object({
  id: z.string(),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.unknown()),
  /** Secrets come from an interactive sign-in instead of the form. */
  login: z.boolean(),
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

export const syncRunSchema = z.object({
  id,
  integrationId: id,
  trigger: z.enum(SYNC_TRIGGERS),
  startedAt: isoDate,
  finishedAt: isoDate,
  status: z.enum(SYNC_RUN_STATUSES),
  errorCode: z.enum(INTEGRATION_ERROR_CODES).nullable(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const testResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.enum(INTEGRATION_ERROR_CODES) }),
]);

export type ExternalPrinter = z.infer<typeof externalPrinterSchema>;
export type ExternalPrint = z.infer<typeof externalPrintSchema>;
export type IntegrationInput = z.input<typeof integrationInputSchema>;
export type IntegrationPatch = z.infer<typeof integrationPatchSchema>;
export type AdapterInfo = z.infer<typeof adapterInfoSchema>;
export type SyncRun = z.infer<typeof syncRunSchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type LoginRequest = z.infer<typeof loginInputSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
