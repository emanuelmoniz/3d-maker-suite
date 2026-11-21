import { z } from "zod";
import { id, integrationSchema, isoDate, syncPolicySchema } from "./entities.ts";
import {
  CAPABILITIES,
  type Capability,
  GRAMS_SOURCES,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_KINDS,
  isCatalogType,
  isUserPresetType,
  LOGIN_CHALLENGES,
  PRINT_OUTCOMES,
  PRINTER_STATES,
  SPOOL_LOADERS,
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
   * A print of a published model is titled after the model; this is the process preset's name the
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
      /** Unset: the printer doesn't say; the job file or the project plate does (ADR-0015). */
      grams: z.number().nonnegative().optional(),
      /** Not measured: a total scaled by how far a stopped print got. */
      gramsEstimated: z.boolean().optional(),
      /** Set with `grams`; unset means the printer's own. `fillGrams` sets `file` and `plate`. */
      gramsSource: z.enum(GRAMS_SOURCES).optional(),
      /**
       * The spool the printer named: the tag it read, or a spool library's own spool as a spool
       * import keys it (`<adapter>:<id>`, e.g. "spoolman:3"), which is then that spool for sure.
       */
      rfid: z.string().min(1).optional(),
      spoolId: z.string().min(1).optional(),
      /**
       * The printer's host already took this slot's usage off its spool library's spool (Moonraker
       * reporting to Spoolman): the app charges its own spool, never that library's again.
       */
      chargedAtSource: z.boolean().optional(),
    }),
  ),
  /** Design page (e.g. MakerWorld). A plain string: stored and shown, never fetched. */
  sourceUrl: z.string().optional(),
  /**
   * This print's `externalId` in another source of the same printer, when the printer names it
   * (Bambu LAN carries the cloud's task id): the two are one print.
   */
  peerId: z.string().min(1).optional(),
});

/**
 * What one printer is doing now (ADR-0015). Always whole: a source that sends only what changed
 * merges it itself. Kept in memory only.
 */
export const printerSnapshotSchema = z.object({
  /** As `listPrinters` names it. */
  printerExternalId: z.string().min(1),
  /** When the source read it. */
  at: isoDate,
  state: z.enum(PRINTER_STATES),
  /** Each field only when the printer says; the snapshot that ends a job often has no file or id. */
  job: z
    .object({
      /** The source's own id of this job: two ids that differ are two jobs. */
      id: z.string().min(1),
      /** As `externalPrintSchema.peerId`. */
      peerId: z.string().min(1),
      /** As the printer names it; the job file's header has the grams. */
      file: z.string().min(1),
      title: z.string().min(1),
      /** 1-based plate of the project file. */
      plate: z.number().int().positive(),
      /** The printer's own start time. */
      startedAt: isoDate,
      elapsedSec: z.number().int().nonnegative(),
      /** The printer's percent: often of the time, not of the material. */
      progress: z.number().min(0).max(100),
      etaSec: z.number().int().nonnegative(),
      layer: z.number().int().nonnegative(),
      totalLayers: z.number().int().positive(),
      /** The slots the job uses, when the printer says so up front (Bambu's AMS mapping). */
      slots: z.array(z.number().int().nonnegative()),
      /** Why it ended in `error`, in the printer's words. */
      failureReason: z.string().min(1),
      /**
       * The slicer totals of the job file, when the source reads the file itself (Bambu LAN, over
       * FTPS); `slot` numbered as `slots`. The server reads the others (`readJobTotals`).
       */
      totals: z.array(
        z.object({
          slot: z.number().int().nonnegative().optional(),
          grams: z.number().nonnegative(),
        }),
      ),
    })
    .partial()
    .optional(),
  /** °C. */
  temperatures: z
    .object({
      nozzle: z.number(),
      nozzleTarget: z.number(),
      bed: z.number(),
      bedTarget: z.number(),
      chamber: z.number(),
    })
    .partial()
    .optional(),
  /** Numbered as a print's filaments; a printer with one extruder and no spool holder has slot 0. */
  slots: z
    .array(
      z.object({
        slot: z.number().int().nonnegative(),
        material: z.string().optional(),
        colorHex: hexColor.optional(),
        rfid: z.string().min(1).optional(),
        /** As `externalPrintSchema`'s filament `spoolId` and `chargedAtSource`. */
        spoolId: z.string().min(1).optional(),
        chargedAtSource: z.boolean().optional(),
        /** Feeding the nozzle now. */
        active: z.boolean().optional(),
        /** What this job took from the slot so far, when the printer measures it (Moonraker). */
        gramsUsed: z.number().nonnegative().optional(),
      }),
    )
    .default([]),
  /**
   * `slots` is what is physically loaded and the list is complete, also when idle (Bambu LAN): a
   * slot missing is an empty tray. Unset when the slots come from the job file (Moonraker).
   */
  physicalSlots: z.boolean().optional(),
});

/** A spool the app puts in a printer's slot by itself, or suggests there (Step 19b, `autoLoad`). */
const slotSpool = z.object({ slot: z.number().int().nonnegative(), spoolId: id });

/** A printer's live status as the API sends it: which printer, from which source. */
export const printerStatusSchema = z.object({
  printerId: id,
  integrationId: id,
  snapshot: printerSnapshotSchema,
  /** Reached through a connector (ADR-0015): which one, and whether it is online. */
  via: z.object({ deviceId: id, deviceName: z.string(), online: z.boolean() }).optional(),
  /**
   * The source itself can't be read: `refused` = a wrong access code or key, signed out; `other` =
   * any other failure. Its printers are out of reach either way.
   */
  failing: z.enum(["refused", "other"]).optional(),
  /** Its source started and hasn't read yet: nothing is known of the printer. */
  pending: z.boolean().optional(),
  /**
   * The spools in its slots, as stored, and who loaded each: a page refetches its spools when the
   * printer loaded or unloaded one. Unset when none is loaded.
   */
  loaded: z.array(slotSpool.extend({ by: z.enum(SPOOL_LOADERS) })).optional(),
  /** Several spools fit a slot the printer reports: the likeliest, one click loads it. Memory only. */
  suggestions: z.array(slotSpool).optional(),
});

/**
 * Where a printer is read from, for its page (`GET /api/printers/:id/connection`): one block per
 * source. `host` and the names of the stored `secrets` (never their values) are the setup's, so
 * `integrations.manage` only (ADR-0012); a connector's name is not.
 */
export const printerConnectionSchema = z.object({
  sources: z.array(
    z.object({
      integrationId: id,
      adapterId: z.string(),
      enabled: z.boolean(),
      /** Reached through this machine's connector; null = this server reaches it. */
      deviceId: id.nullable(),
      deviceName: z.string().nullable(),
      /** Gives a live status; false = it only syncs (Bambu Cloud), shown as Synced. */
      live: z.boolean(),
      lastSyncAt: isoDate.nullable(),
      /**
       * A sync-only source: an adapter that reads this same printer live (it names its printer by
       * serial, Bambu LAN), for the hint; null = none or not needed.
       */
      liveAdapterId: z.string().nullable(),
      host: z.string().nullable().optional(),
      secrets: z.array(z.string()).optional(),
    }),
  ),
});
export type PrinterConnection = z.infer<typeof printerConnectionSchema>;

/**
 * The printer a printer on the network is (ADR-0015): `new` = made at save from what it says, else
 * one of yours that no network source has yet.
 */
export const printerChoiceSchema = z.union([z.literal("new"), id]);
export type PrinterChoice = z.infer<typeof printerChoiceSchema>;

/** `config` and `secrets` are checked against the adapter's own schemas by the server. */
export const integrationInputSchema = z.object({
  adapterId: z.string().min(1),
  enabled: z.boolean().optional(),
  /** A printer source reached through this device's connector (`host` printers, `hub.manage`). */
  deviceId: id.nullable().optional(),
  config: z.record(z.string(), z.json()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
  /** A printer on the network: required, it is one printer, linked at save. */
  printer: printerChoiceSchema.optional(),
  /** A new printer's name (`printer: "new"`); empty = what it announces. Only at create (10b). */
  printerName: z.string().trim().max(100).optional(),
});

/**
 * Test a source before saving it (or an edit before saving it): nothing is stored. `integrationId`:
 * the saved one being edited, whose stored secrets fill in the ones left empty. `printer`: whose
 * serial a source that reads it uses.
 */
export const sourceTestInputSchema = integrationInputSchema
  .pick({ adapterId: true, deviceId: true, config: true, secrets: true, printer: true })
  .extend({ integrationId: id.optional() });

/** Any subset. `secrets` keys that are sent replace the stored ones; others are kept. */
export const integrationPatchSchema = z
  .object({
    enabled: z.boolean(),
    config: z.record(z.string(), z.json()),
    secrets: z.record(z.string(), z.string()),
    /** As `integrationInputSchema.deviceId`: null = this server reaches it. */
    deviceId: id.nullable(),
    /** A printer on the network: another printer, and the link moves to it. */
    printer: printerChoiceSchema,
    slicerConfigDir: z.string().trim().nullable(),
    slicerPath: z.string().trim().nullable(),
    /** A local slicer receives the hub's catalog (ADR-0022); 409 `hub_slicer` on the hub's slicer. */
    catalogReceive: z.boolean(),
    /** A local slicer receives the hub's user presets, as a machine does. */
    presetReceive: z.boolean(),
    /** Only the listed types change, and only the fields sent. */
    policies: z.array(
      syncPolicySchema
        .pick({
          type: true,
          mode: true,
          frequency: true,
          alertSeverities: true,
          trackUsage: true,
          recordPrints: true,
          reviewPolicy: true,
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
          recordPrints: true,
          reviewPolicy: true,
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
  /** Config fields of which at least one must be set (`IntegrationAdapter.configAnyOf`). */
  configAnyOf: z.array(z.string()),
  secrets: z.record(z.string(), z.unknown()),
  /** Secrets come from an interactive sign-in instead of the form. */
  login: z.boolean(),
  /** Everything the adapter supports (switched on or not). */
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** First default slicer config folder that exists on this PC, if the adapter reads one. */
  detectedConfigDir: z.string().nullable(),
  /** The slicer library's id (a slicer-zip source), shared by a slicer's local and server adapters. */
  libraryId: z.string().nullable(),
  /**
   * `server` adapters: the vendor's repo and licence, for the install dialog, and whether this
   * server can run the slicer at all (not on Linux ARM, ADR-0024).
   */
  managed: z
    .object({ repo: z.string(), licenceUrl: z.string(), supported: z.boolean() })
    .nullable(),
});

/** A slicer release this server can install (ADR-0013). */
export const slicerReleaseSchema = z.object({
  tag: z.string(),
  prerelease: z.boolean(),
  /** The release page. */
  url: z.string(),
  /** Download size in bytes. */
  size: z.number().int().nonnegative(),
});

export const slicerInstallSchema = z.object({ tag: z.string().min(1) }).strict();

/**
 * A `worker` integration (ADR-0014): the device it slices on, and its slicer there: one installed
 * on it (picked with `POST /:id/slicer/check`) or a managed one the hub installs. Presets are the
 * hub's: a zip import, or a folder on the hub.
 */
export const workerConfigSchema = z.object({
  deviceId: id,
  source: z.enum(["installed", "managed"]),
});
/** Use the slicer found on the device (its id) or the program at `path` there, once it runs. */
export const slicerCheckSchema = z
  .object({ slicer: z.string().max(100), path: z.string().trim().min(1).max(4096) })
  .partial()
  .strict()
  .refine((b) => !!b.slicer !== !!b.path, "Either slicer or path");

export const SLICER_INSTALL_PHASES = ["download", "verify", "unpack", "test"] as const;
export const SLICER_INSTALL_ERRORS = [
  "fetch_failed",
  "bad_digest",
  "unpack_failed",
  "smoke_failed",
  "vcredist_missing",
  /** A worker's device went offline before its install finished. */
  "device_offline",
] as const;

/** The install job of one server integration (one job runs at a time, in memory). */
export const slicerInstallStatusSchema = z.object({
  state: z.enum(["idle", "running", "failed", "done"]),
  phase: z.enum(SLICER_INSTALL_PHASES).nullable(),
  tag: z.string().nullable(),
  /** Bytes downloaded so far, and the asset's size. */
  received: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  error: z.enum(SLICER_INSTALL_ERRORS).nullable(),
  /** The program's own text (e.g. its exit code), shown as-is. */
  detail: z.string().nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
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

/**
 * A new account's sign-in (6.1.0 Step 10c): nothing is saved until it succeeds. Step 1 sends the
 * config with email + password; a challenge answers a short-lived `token`, step 2 sends it with
 * the code.
 */
export const newLoginInputSchema = z.union([
  z
    .object({
      adapterId: z.string().min(1),
      config: z.record(z.string(), z.json()).default({}),
      email: z.string().trim().min(1),
      password: z.string().min(1),
    })
    .strict(),
  z.object({ token: z.string().min(1).max(100), code: z.string().trim().min(1) }).strict(),
]);

export const newLoginResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), integration: integrationSchema }),
  z.object({
    status: z.literal("challenge"),
    challenge: z.enum(LOGIN_CHALLENGES),
    token: z.string(),
  }),
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
 * own, and a slicer's catalog and presets follow its files on their own; spools are imported by
 * hand until the user picks `auto`. A change to a printer or spool you have waits for you; catalog
 * rows keep your edits.
 */
export const defaultPolicy = (
  type: Capability,
): { mode: SyncMode; frequency: SyncFrequency; scope: SyncScope; merge: SyncMerge } => ({
  ...(type === "prints"
    ? { mode: "auto", frequency: "1h" }
    : {
        mode: type === "printers" || isCatalogType(type) ? "auto" : "manual",
        frequency: WEEKLY.includes(type) ? "1w" : "1d",
      }),
  scope: "all",
  merge: type === "printers" || type === "spools" ? "review" : "keepEdits",
});

/** A type's mode on a new account, and when its Allow switch turns on again. */
export const accountMode = (type: Capability): SyncMode =>
  // An account's user presets are read when you ask, like migration 0102's (ADR-0019).
  isUserPresetType(type) ? "manual" : defaultPolicy(type).mode;

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

/** A page's Sync: these types, now, in every source on `auto` for them that the caller may sync. */
export const syncTypesRequestSchema = z.object({
  types: z.array(z.enum(SYNC_TYPES)).min(1),
});

export const TYPE_SYNC_STATUSES = ["ok", "error", "skipped"] as const;

/**
 * One source and type of a page's Sync. `code`: the run's error; on `skipped`, `sync_running` or
 * the error an earlier type of the same source hit. `updated`: rows written (new ones too).
 */
export const typeSyncResultSchema = z.object({
  integrationId: id,
  type: z.enum(SYNC_TYPES),
  status: z.enum(TYPE_SYNC_STATUSES),
  code: z.enum([...INTEGRATION_ERROR_CODES, "sync_running"]).optional(),
  updated: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});

export const syncTypesResultSchema = z.object({ results: z.array(typeSyncResultSchema) });

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

/** A printer a test found: one for a printer on the network, all of an account's. */
export const foundPrinterSchema = externalPrinterSchema
  .pick({ name: true, brand: true, model: true, serial: true })
  // Its id in the source, which links it at save; unset from a connector older than 6.0.0.
  .extend({ externalId: z.string().min(1).optional() });
/** Most found printers a test answers with. */
export const FOUND_PRINTERS_MAX = 20;
/** A test of a source that isn't saved (yet), with what it found (`tryOut`). */
export const sourceTestResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), printers: z.array(foundPrinterSchema).max(FOUND_PRINTERS_MAX) }),
  z.object({ ok: z.literal(false), code: z.enum(INTEGRATION_ERROR_CODES) }),
]);

/**
 * A print the job tracker saw end (`TrackedPrint`), as a connector sends it to the hub (ADR-0015,
 * LAN reach). `print` is checked again by the hub's `recordPrint`.
 */
export const trackedPrintSchema = z.object({
  print: externalPrintSchema,
  partial: z.boolean(),
  endSeen: z.boolean(),
  job: z.object({
    file: z.string().optional(),
    progress: z.number().optional(),
    layer: z.number().optional(),
    totalLayers: z.number().optional(),
    totals: z
      .array(
        z.object({
          slot: z.number().int().nonnegative().optional(),
          grams: z.number().nonnegative(),
        }),
      )
      .optional(),
  }),
});

/**
 * A spool of the app's to make at a spool library (`SpoolUsageTarget.createSpool`), also as a hub
 * sends it to a connector (`spools.write`, ADR-0015).
 */
export const spoolToCreateSchema = z.object({
  appSpoolId: id,
  brand: z.string().max(200).nullable(),
  material: z.string().min(1).max(100),
  name: z.string().max(200).nullable(),
  colorHex: hexColor,
  colorName: z.string().max(200).nullable(),
  densityGcm3: z.number().nonnegative().nullable(),
  /** Null = not known. */
  initialGrams: z.number().nonnegative().nullable(),
  remainingGrams: z.number().nullable(),
  emptyWeightGrams: z.number().nonnegative().nullable(),
});

const grams = z.number().nonnegative().max(1_000_000);
/**
 * One spool's usage for one print slot (`SpoolUsageTarget.writeUsage`): `key` is core's `pushKey`
 * (`<printId>:<slot>`, `-` for no slot). As a hub sends it to a connector (`spools.write`).
 */
export const spoolUsageWriteSchema = z.object({
  spoolId: z.string().min(1).max(100),
  key: z.string().regex(/^[\w-]{1,64}:(\d{1,3}|-)$/),
  grams,
  sent: grams,
});
/** A connector's answers to `spools.write`: as `writeUsage` and `createSpool` answer. */
export const spoolUsageWrittenSchema = z.object({ gone: z.boolean().optional() });
export const spoolCreatedSchema = z.object({ spoolId: z.string().min(1).max(100) });

export type SpoolToCreate = z.infer<typeof spoolToCreateSchema>;
export type SpoolUsageWrite = z.infer<typeof spoolUsageWriteSchema>;
export type ExternalPrinter = z.infer<typeof externalPrinterSchema>;
export type ExternalPrint = z.infer<typeof externalPrintSchema>;
export type PrinterSnapshot = z.infer<typeof printerSnapshotSchema>;
export type PrinterStatus = z.infer<typeof printerStatusSchema>;
export type IntegrationInput = z.input<typeof integrationInputSchema>;
export type IntegrationPatch = z.infer<typeof integrationPatchSchema>;
export type AdapterInfo = z.infer<typeof adapterInfoSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncRun = z.infer<typeof syncRunSchema>;
export type SyncLogEntry = z.infer<typeof syncLogEntrySchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;
export type SyncTypesRequest = z.infer<typeof syncTypesRequestSchema>;
export type TypeSyncResult = z.infer<typeof typeSyncResultSchema>;
export type SyncPolicy = z.infer<typeof syncPolicySchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type SourceTestInput = z.input<typeof sourceTestInputSchema>;
export type SourceTestResult = z.infer<typeof sourceTestResultSchema>;
export type FoundPrinter = z.infer<typeof foundPrinterSchema>;
export type LoginRequest = z.infer<typeof loginInputSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type NewLoginRequest = z.input<typeof newLoginInputSchema>;
export type NewLoginResult = z.infer<typeof newLoginResultSchema>;
export type SlicerRelease = z.infer<typeof slicerReleaseSchema>;
export type SlicerInstallStatus = z.infer<typeof slicerInstallStatusSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type SlicerCheck = z.infer<typeof slicerCheckSchema>;
export type SlicerInstallError = (typeof SLICER_INSTALL_ERRORS)[number];
