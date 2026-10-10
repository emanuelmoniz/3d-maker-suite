import {
  ALERT_KINDS,
  CAPABILITIES,
  COMMENT_STATUSES,
  ENERGY_SOURCES,
  INTEGRATION_ERROR_CODES,
  ORIGINS,
  PRINT_OUTCOMES,
  type PROJECT_EDITABLE_FIELDS,
  SPOOL_STATUSES,
  SYNC_FREQUENCIES,
  SYNC_MODES,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  SYNC_TYPES,
  TAGGABLE_TYPES,
  WEIGHT_ENTRY_KINDS,
} from "@3d-maker-suite/core";
import { type SQL, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Conventions: docs/architecture.md. Dates are UTC ISO strings, grams real, seconds integer,
// money integer minor units. `archivedAt` = soft delete for rows that history points to.

const now = () => new Date().toISOString();
const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const timestamps = {
  createdAt: text().notNull().$defaultFn(now),
  updatedAt: text().notNull().$defaultFn(now).$onUpdateFn(now),
};

function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).notNull(),
});

export const integrations = sqliteTable("integrations", {
  id: id(),
  adapterId: text().notNull(),
  // No name: the UI shows the adapter's name (`integrations:adapters.<id>.name`).
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  config: text({ mode: "json" }).notNull().default({}),
  /** AES-256-GCM blob `{ v, iv, tag, data }` (ADR-0005). Never returned by the API. */
  secrets: text(),
  /** Slicer config folder override; null = detected. */
  slicerConfigDir: text(),
  /** Slicer program for "Open in slicer". */
  slicerPath: text(),
  status: text().notNull().default("new"),
  lastSyncAt: text(),
  lastError: text(),
  ...timestamps,
});

// Sync policy per integration + type. Sparse: a type without a row follows core's `defaultPolicy`,
// so a row appears when the user changes it or its first run finishes.
export const syncPolicies = sqliteTable(
  "sync_policies",
  {
    integrationId: text()
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    type: text({ enum: CAPABILITIES }).notNull(),
    mode: text({ enum: SYNC_MODES }).notNull(),
    frequency: text({ enum: SYNC_FREQUENCIES }).notNull(),
    /** Last successful run of this type (any trigger); the scheduler's "is it due" starts here. */
    lastRunAt: text(),
    /** Where the next incremental run starts (prints: fetched up to this date). */
    cursor: text(),
    /** Rows the last run left for the preview -> confirm flow. */
    pending: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.integrationId, t.type] }),
    check("sync_policies_mode_ck", oneOf(t.mode, SYNC_MODES)),
    check("sync_policies_frequency_ck", oneOf(t.frequency, SYNC_FREQUENCIES)),
  ],
);

// Sync log: one row per run (the server keeps the last 100 per integration).
export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: id(),
    integrationId: text()
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    trigger: text({ enum: SYNC_TRIGGERS }).notNull(),
    /** null on runs from before sync was split by type. */
    type: text({ enum: SYNC_TYPES }),
    /** Range of a manual prints sync; null = incremental. */
    rangeFrom: text(),
    rangeTo: text(),
    startedAt: text().notNull(),
    finishedAt: text().notNull(),
    status: text({ enum: SYNC_RUN_STATUSES }).notNull(),
    errorCode: text({ enum: INTEGRATION_ERROR_CODES }),
    created: integer().notNull().default(0),
    skipped: integer().notNull().default(0),
  },
  (t) => [
    index("sync_runs_integration_idx").on(t.integrationId, t.startedAt),
    check("sync_runs_trigger_ck", oneOf(t.trigger, SYNC_TRIGGERS)),
    check("sync_runs_status_ck", oneOf(t.status, SYNC_RUN_STATUSES)),
    check("sync_runs_error_code_ck", oneOf(t.errorCode, INTEGRATION_ERROR_CODES)),
  ],
);

// Rows that may come from an integration; sync upserts by (integrationId, externalId).
const imported = () => ({
  origin: text({ enum: ORIGINS }).notNull().default("manual"),
  integrationId: text().references(() => integrations.id, { onDelete: "set null" }),
  externalId: text(),
});

// Catalog: brand -> printer model -> machine profile. Hard-deleted; FKs restrict while in use.
export const brands = sqliteTable(
  "brands",
  {
    id: id(),
    name: text().notNull(),
    /** Website (support / store). */
    url: text(),
    /** Relative to the data directory (brands/<id>.<ext>). */
    logoPath: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("brands_name_uq").on(sql`${t.name} COLLATE NOCASE`)],
);

export const printerModels = sqliteTable(
  "printer_models",
  {
    id: id(),
    brandId: text()
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    model: text().notNull(),
    /** Pre-fills `printers.powerW` when a printer is created from this model. */
    powerW: integer(),
    /** Relative to the data directory (models/<id>.<ext>). */
    imagePath: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("printer_models_name_uq").on(t.brandId, sql`${t.model} COLLATE NOCASE`)],
);

export const machineProfiles = sqliteTable(
  "machine_profiles",
  {
    id: id(),
    name: text().notNull(),
    printerModelId: text()
      .notNull()
      .references(() => printerModels.id, { onDelete: "restrict" }),
    nozzleDiameterMm: real().notNull().default(0.4),
    /** Preset this profile was imported from, `<library>:<preset id>`; null for hand-made ones. */
    sourcePreset: text(),
    /** An older version of a preset that prints still point at (see `sourcePreset`). */
    archivedAt: text(),
    ...timestamps,
  },
  (t) => [
    index("machine_profiles_model_idx").on(t.printerModelId),
    // Unique only among current rows: an archived version keeps its key.
    uniqueIndex("machine_profiles_source_uq")
      .on(t.sourcePreset)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

export const printers = sqliteTable(
  "printers",
  {
    id: id(),
    name: text().notNull(),
    // Nullable only because SQLite can't ADD a NOT NULL FK column without rebuilding the table
    // (migration 0017); the API always requires it.
    modelId: text().references(() => printerModels.id, { onDelete: "restrict" }),
    serial: text(),
    nozzleDiameterMm: real().notNull().default(0.4),
    runtimeOffsetSec: integer().notNull().default(0),
    printsOffset: integer().notNull().default(0),
    purchasedAt: text(),
    purchasePrice: integer(),
    warrantyEndsAt: text(),
    warrantyNotes: text(),
    // Validated against the `printerStates` preference by the API, so no CHECK here.
    state: text().notNull().default("working"),
    powerW: integer(),
    photoPath: text(),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("printers_external_uq").on(t.integrationId, t.externalId),
    check("printers_origin_ck", oneOf(t.origin, ORIGINS)),
  ],
);

// A timeline: pinned first, then newest first. `status` lets an issue note be closed out.
export const printerComments = sqliteTable(
  "printer_comments",
  {
    id: id(),
    printerId: text()
      .notNull()
      .references(() => printers.id, { onDelete: "cascade" }),
    body: text().notNull(),
    pinned: integer({ mode: "boolean" }).notNull().default(false),
    status: text({ enum: COMMENT_STATUSES }).notNull().default("open"),
    ...timestamps,
  },
  (t) => [
    index("printer_comments_printer_idx").on(t.printerId, t.createdAt),
    check("printer_comments_status_ck", oneOf(t.status, COMMENT_STATUSES)),
  ],
);

export const maintenanceTypes = sqliteTable("maintenance_types", {
  id: id(),
  name: text().notNull(),
  description: text(),
  docUrl: text(),
  intervalSec: integer(),
  intervalPrints: integer(),
  intervalDays: integer(),
  appliesToModelIds: text({ mode: "json" }).notNull().$type<string[]>().default([]),
  appliesToPrinterIds: text({ mode: "json" }).notNull().$type<string[]>().default([]),
  archivedAt: text(),
  ...timestamps,
});

export const maintenanceTasks = sqliteTable(
  "maintenance_tasks",
  {
    id: id(),
    printerId: text()
      .notNull()
      .references(() => printers.id, { onDelete: "restrict" }),
    typeId: text()
      .notNull()
      .references(() => maintenanceTypes.id, { onDelete: "restrict" }),
    doneAt: text().notNull(),
    printerRuntimeSecAt: integer().notNull(),
    printerPrintsAt: integer().notNull(),
    notes: text(),
    /** Minor units. */
    cost: integer(),
    ...timestamps,
  },
  (t) => [index("maintenance_tasks_latest_idx").on(t.printerId, t.typeId, t.doneAt)],
);

export const filamentBrands = sqliteTable(
  "filament_brands",
  {
    id: id(),
    name: text().notNull(),
    /** Website (store / product page). */
    url: text(),
    /** Relative to the data directory (filament-brands/<id>.<ext>). */
    logoPath: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("filament_brands_name_uq").on(sql`${t.name} COLLATE NOCASE`)],
);

export const filamentMaterials = sqliteTable(
  "filament_materials",
  {
    id: id(),
    name: text().notNull(),
    /** Optional defaults that pre-fill a new profile of this material. */
    nozzleTempC: integer(),
    bedTempC: integer(),
    densityGcm3: real(),
    ...timestamps,
  },
  (t) => [uniqueIndex("filament_materials_name_uq").on(sql`${t.name} COLLATE NOCASE`)],
);

export const filamentProfiles = sqliteTable(
  "filament_profiles",
  {
    id: id(),
    /** Null when the brand is unknown (it was optional as free text). */
    brandId: text().references(() => filamentBrands.id, { onDelete: "restrict" }),
    /** Nullable only because SQLite can't add a NOT NULL column to a filled table; always set. */
    materialId: text().references(() => filamentMaterials.id, { onDelete: "restrict" }),
    name: text().notNull(),
    diameterMm: real().notNull().default(1.75),
    densityGcm3: real().notNull(),
    pricePerKg: integer(),
    nozzleTempC: integer(),
    bedTempC: integer(),
    sourcePreset: text(),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    index("filament_profiles_brand_idx").on(t.brandId),
    index("filament_profiles_material_idx").on(t.materialId),
    uniqueIndex("filament_profiles_external_uq").on(t.integrationId, t.externalId),
    uniqueIndex("filament_profiles_source_uq")
      .on(t.sourcePreset)
      .where(sql`${t.archivedAt} IS NULL`),
    check("filament_profiles_origin_ck", oneOf(t.origin, ORIGINS)),
  ],
);

export const spools = sqliteTable(
  "spools",
  {
    id: id(),
    profileId: text()
      .notNull()
      .references(() => filamentProfiles.id, { onDelete: "restrict" }),
    colorHex: text().notNull().default("#808080"),
    initialGrams: real().notNull(),
    remainingGrams: real().notNull(),
    emptyWeightGrams: real(),
    status: text({ enum: SPOOL_STATUSES }).notNull().default("new"),
    pricePaid: integer(),
    purchasedAt: text(),
    openedAt: text(),
    location: text(),
    sourceSpool: text(),
    archivedAt: text(),
    ...timestamps,
  },
  (t) => [
    index("spools_profile_idx").on(t.profileId),
    uniqueIndex("spools_source_uq").on(t.sourceSpool),
    check("spools_status_ck", oneOf(t.status, SPOOL_STATUSES)),
  ],
);

// Append-only: `spools.remainingGrams` always equals the sum of its entries' deltas.
export const spoolWeightEntries = sqliteTable(
  "spool_weight_entries",
  {
    id: id(),
    spoolId: text()
      .notNull()
      .references(() => spools.id, { onDelete: "restrict" }),
    kind: text({ enum: WEIGHT_ENTRY_KINDS }).notNull(),
    deltaGrams: real().notNull(),
    remainingAfter: real().notNull(),
    note: text(),
    createdAt: text().notNull().$defaultFn(now),
  },
  (t) => [
    index("spool_weight_entries_spool_idx").on(t.spoolId, t.createdAt),
    check("spool_weight_entries_kind_ck", oneOf(t.kind, WEIGHT_ENTRY_KINDS)),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    name: text().notNull(),
    description: text(),
    // Set when the project comes from a folder (scan or manual); the scan key.
    folderPath: text(),
    filePath: text(),
    sourceUrl: text(),
    thumbnailPath: text(),
    meta: text({ mode: "json" }).notNull().default({}),
    // Fields the user changed; a re-scan only rewrites the others.
    editedFields: text({ mode: "json" })
      .$type<(typeof PROJECT_EDITABLE_FIELDS)[number][]>()
      .notNull()
      .default([]),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("projects_external_uq").on(t.integrationId, t.externalId),
    uniqueIndex("projects_folder_uq").on(t.folderPath),
    check("projects_origin_ck", oneOf(t.origin, ORIGINS)),
  ],
);

export const prints = sqliteTable(
  "prints",
  {
    id: id(),
    printerId: text()
      .notNull()
      .references(() => printers.id, { onDelete: "restrict" }),
    projectId: text().references(() => projects.id, { onDelete: "restrict" }),
    machineProfileId: text().references(() => machineProfiles.id, { onDelete: "restrict" }),
    title: text().notNull(),
    plate: integer(),
    startedAt: text().notNull(),
    durationSec: integer(),
    outcome: text({ enum: PRINT_OUTCOMES }).notNull(),
    failureReason: text(),
    notes: text(),
    energyWh: real(),
    energySource: text({ enum: ENERGY_SOURCES }),
    costSnapshot: text({ mode: "json" }),
    coverUrl: text(),
    sourceUrl: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    index("prints_started_idx").on(t.startedAt),
    index("prints_printer_started_idx").on(t.printerId, t.startedAt),
    index("prints_project_idx").on(t.projectId),
    uniqueIndex("prints_external_uq").on(t.integrationId, t.externalId),
    check("prints_origin_ck", oneOf(t.origin, ORIGINS)),
    check("prints_outcome_ck", oneOf(t.outcome, PRINT_OUTCOMES)),
    check("prints_failure_reason_ck", sql`${t.outcome} <> 'success' OR ${t.failureReason} IS NULL`),
    check("prints_energy_source_ck", oneOf(t.energySource, ENERGY_SOURCES)),
    check("prints_energy_pair_ck", sql`(${t.energyWh} IS NULL) = (${t.energySource} IS NULL)`),
  ],
);

// One row per filament slot (AMS). spoolId is null while an imported slot waits in the review
// queue, and stays null if the user dismisses it.
export const printFilamentUsages = sqliteTable(
  "print_filament_usages",
  {
    id: id(),
    printId: text()
      .notNull()
      .references(() => prints.id, { onDelete: "cascade" }),
    spoolId: text().references(() => spools.id, { onDelete: "restrict" }),
    profileId: text().references(() => filamentProfiles.id, { onDelete: "restrict" }),
    grams: real().notNull(),
    slot: integer(),
    // As reported by an import; a spool is matched on these (or picked by hand in the review queue).
    material: text(),
    colorHex: text(),
    dismissed: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("print_filament_usages_print_idx").on(t.printId),
    index("print_filament_usages_spool_idx").on(t.spoolId),
    index("print_filament_usages_profile_idx").on(t.profileId),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: id(),
    name: text().notNull(),
    color: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("tags_name_uq").on(sql`${t.name} COLLATE NOCASE`)],
);

// Polymorphic: no FK to the tagged row. A trigger (migration 0001) removes taggings of deleted
// prints; spools and projects are archived, never deleted.
export const taggings = sqliteTable(
  "taggings",
  {
    tagId: text()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: text({ enum: TAGGABLE_TYPES }).notNull(),
    entityId: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
    index("taggings_entity_idx").on(t.entityType, t.entityId),
    check("taggings_entity_type_ck", oneOf(t.entityType, TAGGABLE_TYPES)),
  ],
);

export const collections = sqliteTable("collections", {
  id: id(),
  name: text().notNull(),
  description: text(),
  ...timestamps,
});

export const collectionProjects = sqliteTable(
  "collection_projects",
  {
    collectionId: text()
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.projectId] })],
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: id(),
    kind: text({ enum: ALERT_KINDS }).notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    context: text({ mode: "json" }).notNull().$type<Record<string, string | number>>().default({}),
    createdAt: text().notNull().$defaultFn(now),
    readAt: text(),
    /** When the channels were told; null = still to send. Re-armed when a snooze ends. */
    notifiedAt: text(),
    snoozedUntil: text(),
    /** Hidden until the condition resolves and comes back. */
    dismissedAt: text(),
    resolvedAt: text(),
  },
  (t) => [
    uniqueIndex("alerts_open_uq")
      .on(t.kind, t.entityType, t.entityId)
      .where(sql`${t.resolvedAt} IS NULL`),
    check("alerts_kind_ck", oneOf(t.kind, ALERT_KINDS)),
  ],
);

// Saved pricing-calculator results. `form` is the calculator state; cost/quote are the numbers
// as quoted, so later price changes don't rewrite an offer already made.
export const quotes = sqliteTable(
  "quotes",
  {
    id: id(),
    projectId: text().references(() => projects.id, { onDelete: "set null" }),
    name: text().notNull(),
    form: text({ mode: "json" }).notNull(),
    cost: text({ mode: "json" }).notNull(),
    quote: text({ mode: "json" }).notNull(),
    ...timestamps,
  },
  (t) => [index("quotes_project_idx").on(t.projectId)],
);
