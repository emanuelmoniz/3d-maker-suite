import {
  ALERT_KINDS,
  ALERT_MODULES,
  ALERT_SEVERITIES,
  type AlertDetail,
  type AlertSeverity,
  CAPABILITIES,
  COMMENT_STATUSES,
  type ConnectorUpdateFailure,
  DEVICE_SYNC_MODES,
  type DeviceSlicer,
  type DeviceSyncState,
  ENERGY_SOURCES,
  IMPORT_SOURCES,
  INTEGRATION_ERROR_CODES,
  LOG_LEVELS,
  MAINTENANCE_TARGETS,
  NEW_SPOOL_FIELD,
  ORIGINS,
  PRINT_OUTCOMES,
  type PROJECT_EDITABLE_FIELDS,
  ROOT_EDIT_BY,
  SPOOL_STATUSES,
  SYNC_FREQUENCIES,
  SYNC_MERGES,
  SYNC_MODES,
  SYNC_RUN_STATUSES,
  SYNC_SCOPES,
  SYNC_TRIGGERS,
  SYNC_TYPES,
  type SyncLogEntry,
  TAGGABLE_TYPES,
  USER_ROLES,
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
  /** A server integration's installed slicer version (ADR-0013); null = none installed. */
  slicerVersion: text(),
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
    /** Severities this task raises (pending rows = warning); null = all three, the default. */
    alertSeverities: text({ mode: "json" }).$type<AlertSeverity[]>(),
    /** Prints in `auto` mode: take the filament from the spools (off: link them only). */
    trackUsage: integer({ mode: "boolean" }).notNull().default(true),
    /** Which rows a run takes (core's `SYNC_SCOPES`). */
    scope: text({ enum: SYNC_SCOPES }).notNull().default("all"),
    /** What a run does with a change to a row you have (`SYNC_MERGES`); default per type in core. */
    merge: text({ enum: SYNC_MERGES }).notNull().default("keepEdits"),
    /** Spools: a new spool's weight and open date (core's `NEW_SPOOL_FIELD`). */
    newWeight: text({ enum: NEW_SPOOL_FIELD }).notNull().default("import"),
    newOpenedAt: text({ enum: NEW_SPOOL_FIELD }).notNull().default("unset"),
    /** When an `auto` run happens within its frequency (the sync job's `schedulePattern`); all null
     * = every `frequency` since the last run. */
    atMinute: integer(),
    atHour: integer(),
    atWeekday: integer(),
    atDay: integer(),
    /** Editors may "Sync now" this task / review and import it (ADR-0012); admins always may. */
    editorSync: integer({ mode: "boolean" }).notNull().default(false),
    editorReview: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.integrationId, t.type] }),
    check("sync_policies_mode_ck", oneOf(t.mode, SYNC_MODES)),
    check("sync_policies_frequency_ck", oneOf(t.frequency, SYNC_FREQUENCIES)),
    check("sync_policies_scope_ck", oneOf(t.scope, SYNC_SCOPES)),
    check("sync_policies_merge_ck", oneOf(t.merge, SYNC_MERGES)),
    check("sync_policies_new_weight_ck", oneOf(t.newWeight, NEW_SPOOL_FIELD)),
    check("sync_policies_new_opened_at_ck", oneOf(t.newOpenedAt, NEW_SPOOL_FIELD)),
  ],
);

// What an integration last imported into a row, in the import columns, so a sync tells your
// edits (row ≠ these) from a change at the source (source ≠ these).
// ponytail: no FK to the row (one table per entity); a deleted row leaves a stale snapshot behind.
export const importSnapshots = sqliteTable(
  "import_snapshots",
  {
    integrationId: text()
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    entity: text().notNull(),
    rowId: text().notNull(),
    values: text({ mode: "json" }).$type<Record<string, string | number | null>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.integrationId, t.entity, t.rowId] })],
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
    /** What the run did, row by row (bounded, ADR-0008). Empty on runs before 0054. */
    log: text({ mode: "json" }).notNull().$type<SyncLogEntry[]>().default([]),
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

// A slicer process preset. Model and nozzle are null when the preset names no printer we know.
export const printProfiles = sqliteTable(
  "print_profiles",
  {
    id: id(),
    name: text().notNull(),
    printerModelId: text().references(() => printerModels.id, { onDelete: "restrict" }),
    nozzleDiameterMm: real(),
    layerHeightMm: real(),
    /** Preset this profile was imported from, `<library>:<preset id>`; null for hand-made ones. */
    sourcePreset: text(),
    archivedAt: text(),
    ...timestamps,
  },
  (t) => [
    index("print_profiles_model_idx").on(t.printerModelId),
    uniqueIndex("print_profiles_source_uq").on(t.sourcePreset).where(sql`${t.archivedAt} IS NULL`),
  ],
);

export const printers = sqliteTable(
  "printers",
  {
    id: id(),
    name: text().notNull(),
    // ponytail: nullable only because SQLite can't ADD a NOT NULL column without a constant
    // default; every insert sets it (nextNumber). Rebuild the table with NOT NULL if a path skips it.
    number: integer(),
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
    // Cost settings; null = the Costs default (`printerLifetimeHours`, `includeMaintenanceCost`,
    // `printerCountInCosts`).
    lifetimeHours: integer(),
    includeMaintenanceCost: integer({ mode: "boolean" }),
    countInCosts: integer({ mode: "boolean" }),
    // Default print profile for slicing on this printer.
    printProfileId: text().references((): AnySQLiteColumn => printProfiles.id, {
      onDelete: "set null",
    }),
    photoPath: text(),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("printers_external_uq").on(t.integrationId, t.externalId),
    uniqueIndex("printers_number_uq").on(t.number),
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

// AMS, hotend, enclosure, …: printer-like info, on one printer at a time (`accessoryInstalls`).
export const accessories = sqliteTable(
  "accessories",
  {
    id: id(),
    number: integer().notNull(),
    name: text().notNull(),
    /** Free text; the form suggests the types already used. */
    type: text().notNull(),
    serial: text(),
    purchasedAt: text(),
    purchasePrice: integer(),
    warrantyEndsAt: text(),
    warrantyNotes: text(),
    // One of the `printerStates` preference, checked by the API like printers.
    state: text().notNull().default("working"),
    powerW: integer(),
    // Cost settings; null = the Costs default (`accessoryLifetimeHours`, …).
    lifetimeHours: integer(),
    includeMaintenanceCost: integer({ mode: "boolean" }),
    countInCosts: integer({ mode: "boolean" }),
    photoPath: text(),
    archivedAt: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("accessories_number_uq").on(t.number)],
);

// Same timeline as `printerComments`.
export const accessoryComments = sqliteTable(
  "accessory_comments",
  {
    id: id(),
    accessoryId: text()
      .notNull()
      .references(() => accessories.id, { onDelete: "cascade" }),
    body: text().notNull(),
    pinned: integer({ mode: "boolean" }).notNull().default(false),
    status: text({ enum: COMMENT_STATUSES }).notNull().default("open"),
    ...timestamps,
  },
  (t) => [
    index("accessory_comments_accessory_idx").on(t.accessoryId, t.createdAt),
    check("accessory_comments_status_ck", oneOf(t.status, COMMENT_STATUSES)),
  ],
);

// Periods `[installedAt, removedAt)` of an accessory on a printer; removedAt null = still on it.
// The API refuses overlapping periods; the DB holds at most one open period per accessory.
export const accessoryInstalls = sqliteTable(
  "accessory_installs",
  {
    id: id(),
    accessoryId: text()
      .notNull()
      .references(() => accessories.id, { onDelete: "cascade" }),
    printerId: text()
      .notNull()
      .references(() => printers.id, { onDelete: "restrict" }),
    installedAt: text().notNull(),
    removedAt: text(),
    ...timestamps,
  },
  (t) => [
    index("accessory_installs_accessory_idx").on(t.accessoryId, t.installedAt),
    index("accessory_installs_printer_idx").on(t.printerId),
    uniqueIndex("accessory_installs_open_uq").on(t.accessoryId).where(sql`${t.removedAt} IS NULL`),
    check(
      "accessory_installs_dates_ck",
      sql`${t.removedAt} IS NULL OR ${t.removedAt} >= ${t.installedAt}`,
    ),
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
  // Alert settings; null = the default (`maintenanceLead*`, both alerts on).
  warnLeadDays: integer(),
  warnLeadHours: integer(),
  warnLeadPrints: integer(),
  warnEnabled: integer({ mode: "boolean" }),
  errorEnabled: integer({ mode: "boolean" }),
  /**
   * Printers or accessories, never both. No CHECK: adding one rebuilds a table tasks point at;
   * the API's enum guards it.
   */
  target: text({ enum: MAINTENANCE_TARGETS }).notNull().default("printer"),
  appliesToModelIds: text({ mode: "json" }).notNull().$type<string[]>().default([]),
  appliesToPrinterIds: text({ mode: "json" }).notNull().$type<string[]>().default([]),
  /** Accessory types (free text, "AMS") play the role of models; both empty = every accessory. */
  appliesToAccessoryTypes: text({ mode: "json" }).notNull().$type<string[]>().default([]),
  appliesToAccessoryIds: text({ mode: "json" }).notNull().$type<string[]>().default([]),
  archivedAt: text(),
  ...timestamps,
});

export const maintenanceTasks = sqliteTable(
  "maintenance_tasks",
  {
    id: id(),
    // Exactly one target, the type's.
    printerId: text().references(() => printers.id, { onDelete: "restrict" }),
    accessoryId: text().references(() => accessories.id, { onDelete: "restrict" }),
    typeId: text()
      .notNull()
      .references(() => maintenanceTypes.id, { onDelete: "restrict" }),
    doneAt: text().notNull(),
    /** Usage of the target (printer or accessory) when done. */
    printerRuntimeSecAt: integer().notNull(),
    printerPrintsAt: integer().notNull(),
    notes: text(),
    /** Minor units. */
    cost: integer(),
    ...timestamps,
  },
  (t) => [
    index("maintenance_tasks_latest_idx").on(t.printerId, t.typeId, t.doneAt),
    index("maintenance_tasks_accessory_idx").on(t.accessoryId, t.typeId, t.doneAt),
    check(
      "maintenance_tasks_target_ck",
      sql`(${t.printerId} IS NULL) <> (${t.accessoryId} IS NULL)`,
    ),
  ],
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
    // ponytail: nullable only because SQLite can't ADD a NOT NULL column without a constant
    // default; createSpool always sets it. Rebuild the table with NOT NULL if a path ever skips it.
    number: integer(),
    colorHex: text().notNull().default("#808080"),
    colorName: text(),
    // Both null = weight not known yet (a synced spool you weigh later): no ledger, nothing booked.
    initialGrams: real(),
    remainingGrams: real(),
    emptyWeightGrams: real(),
    status: text({ enum: SPOOL_STATUSES }).notNull().default("new"),
    pricePaid: integer(),
    purchasedAt: text(),
    openedAt: text(),
    location: text(),
    sourceSpool: text(),
    // Low-weight alert; null = the default (`lowSpoolGrams`, on).
    lowGrams: real(),
    lowAlert: integer({ mode: "boolean" }),
    archivedAt: text(),
    ...timestamps,
  },
  (t) => [
    index("spools_profile_idx").on(t.profileId),
    uniqueIndex("spools_source_uq").on(t.sourceSpool),
    uniqueIndex("spools_number_uq").on(t.number),
    check("spools_status_ck", oneOf(t.status, SPOOL_STATUSES)),
  ],
);

// Append-only: `spools.remainingGrams` always equals the sum of its entries' deltas (none while
// the weight is unknown).
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

// A folder projects live in (ADR-0014). `location` is "hub" (a folder on this server); a device id
// once devices have roots of their own.
export const roots = sqliteTable(
  "roots",
  {
    id: id(),
    name: text().notNull(),
    location: text().notNull().default("hub"),
    // Absolute on its location, as the user picked it.
    path: text().notNull(),
    // How many folder levels below the root project folders are.
    projectDepth: integer().notNull().default(1),
    // How deep a project's files are listed; null = all.
    filesDepth: integer(),
    autoSlice: integer({ mode: "boolean" }).notNull().default(true),
    /** Who edits its files besides a device root's own user (ADR-0014); "users" = `root_editors`. */
    editBy: text({ enum: ROOT_EDIT_BY }).notNull().default("roles"),
    position: integer().notNull(),
    ...timestamps,
  },
  // No CHECK on `editBy`: adding one rebuilds the table, and dropping `roots` in the migrator's
  // transaction would cascade to its folders (zod checks it).
  (t) => [uniqueIndex("roots_location_path_uq").on(t.location, t.path)],
);

/** The users picked to edit a root whose `editBy` is "users". */
export const rootEditors = sqliteTable(
  "root_editors",
  {
    rootId: text()
      .notNull()
      .references(() => roots.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references((): AnySQLiteColumn => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.rootId, t.userId] })],
);

/**
 * A device root's project folders as its connector last sent them (ADR-0014): the digest of the
 * file list (the hub asks only for changed ones) and the scan, so a re-read on the hub (a
 * description file linked) needs no device. A folder without a row is missing on the device.
 */
export const deviceRootFolders = sqliteTable(
  "device_root_folders",
  {
    rootId: text()
      .notNull()
      .references(() => roots.id, { onDelete: "cascade" }),
    folder: text().notNull(),
    digest: text().notNull(),
    /** `deviceFolderSchema` without the cover and previews. */
    scan: text({ mode: "json" }).notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.rootId, t.folder] })],
);

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    // ponytail: nullable like printers.number; the scanner and routes always set it.
    number: integer(),
    name: text().notNull(),
    description: text(),
    // Folder file (relative) whose text is the description; re-read on every scan.
    descriptionFile: text(),
    // Gallery picks, relative to the folder (`/`): every image in `folders` (and below) plus `images`.
    gallery: text({ mode: "json" })
      .$type<{ folders: string[]; images: string[] }>()
      .notNull()
      .default({ folders: [], images: [] }),
    // Image (relative) the user chose as the cover; the scan's own pick when null or gone.
    coverFile: text(),
    // Set when the project comes from a folder (scan or manual): its root and the folder relative to
    // it (`/`). Together the scan key.
    rootId: text().references(() => roots.id, { onDelete: "restrict" }),
    folder: text(),
    // The folder it was unlinked from, kept on disk as it was: scans skip it until the project
    // gets a folder again (that one, with everything kept, or another).
    unlinkedRootId: text().references(() => roots.id, { onDelete: "set null" }),
    unlinkedFolder: text(),
    // The main model file, relative to the folder (`/`).
    filePath: text(),
    sourceUrl: text(),
    thumbnailPath: text(),
    meta: text({ mode: "json" }).notNull().default({}),
    // Fields the user changed; a re-scan only rewrites the others.
    editedFields: text({ mode: "json" })
      .$type<(typeof PROJECT_EDITABLE_FIELDS)[number][]>()
      .notNull()
      .default([]),
    // Slice again when a sliced file changes; null = as its project root says.
    autoSlice: integer({ mode: "boolean" }),
    /** The slicer for plates without their own; null (or one that can't slice) = the default. */
    slicerIntegrationId: text().references(() => integrations.id, { onDelete: "set null" }),
    archivedAt: text(),
    /** Who it belongs to (ADR-0014): its creator, or a device root's user; null = nobody's. */
    ownerId: text().references((): AnySQLiteColumn => users.id, { onDelete: "set null" }),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    index("projects_owner_idx").on(t.ownerId),
    uniqueIndex("projects_external_uq").on(t.integrationId, t.externalId),
    uniqueIndex("projects_root_folder_uq").on(t.rootId, t.folder),
    uniqueIndex("projects_number_uq").on(t.number),
    check("projects_origin_ck", oneOf(t.origin, ORIGINS)),
  ],
);

// The plates a project prints, one row each; a 3MF is picked when it has a row. The file's
// size/mtime/sha256 at save time tell a later read whether it changed on disk.
export const projectSlicePlates = sqliteTable(
  "project_slice_plates",
  {
    id: id(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Relative to the project folder, `/` separators. */
    file: text().notNull(),
    plate: integer().notNull(),
    /** The printer it slices for (machine preset and cost rates); null = picked by the server. */
    printerId: text().references((): AnySQLiteColumn => printers.id, { onDelete: "set null" }),
    // Null = the printer's default profile with `useDefaultPrintProfile`, else the 3MF's own.
    printProfileId: text().references(() => printProfiles.id, { onDelete: "set null" }),
    useDefaultPrintProfile: integer({ mode: "boolean" }).notNull().default(false),
    // Filament profile id per slot; null = the 3MF's own. Not FKs: a deleted profile reads as null.
    filaments: text({ mode: "json" }).$type<(string | null)[]>().notNull().default([]),
    /** Spool id per slot, for its price; its profile is also in `filaments`. Not FKs, as above. */
    spools: text({ mode: "json" }).$type<(string | null)[]>().notNull().default([]),
    /** Its slicer; null (or one that can't slice) = the project's, then the default (`pickSlicer`). */
    slicerIntegrationId: text().references(() => integrations.id, { onDelete: "set null" }),
    fileSize: integer().notNull(),
    fileMtimeMs: real().notNull(),
    fileSha256: text().notNull(),
    // Last slice, of the file as fingerprinted above; null = never sliced. Cleared when the
    // profiles change, kept (with the fingerprint) when the setup is saved unchanged.
    slicedAt: text(),
    /** The print profile it was sliced with, after the default printer's was filled in. */
    slicedPrintProfileId: text(),
    /** The slicer integration that sliced it. Not an FK: a deleted one reads as another slicer. */
    slicedIntegrationId: text(),
    /** That integration's `slicerVersion` then; null = unknown (a local slicer, or before 0073). */
    slicedSlicerVersion: text(),
    printTimeSeconds: integer(),
    weightGrams: real(),
    slicedFilaments: text({ mode: "json" }).$type<
      { slot: number; grams: number; material: string | null }[]
    >(),
    /** Why the last slice failed (the slicer's own text); cleared by a successful one. */
    sliceError: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("project_slice_plates_uq").on(t.projectId, t.file, t.plate)],
);

export const prints = sqliteTable(
  "prints",
  {
    id: id(),
    printerId: text()
      .notNull()
      .references(() => printers.id, { onDelete: "restrict" }),
    projectId: text().references(() => projects.id, { onDelete: "restrict" }),
    /** No project on purpose (a calibration print): linking by title leaves it alone. */
    noProject: integer({ mode: "boolean" }).notNull().default(false),
    /** The order it was printed for; its project is one of the order's (the API keeps that true). */
    orderId: text().references((): AnySQLiteColumn => orders.id, { onDelete: "set null" }),
    // ponytail: nullable like printers.number; every insert sets it (nextNumber).
    number: integer(),
    machineProfileId: text().references(() => machineProfiles.id, { onDelete: "restrict" }),
    title: text().notNull(),
    plate: integer(),
    startedAt: text().notNull(),
    durationSec: integer(),
    durationEstimated: integer({ mode: "boolean" }).notNull().default(false),
    outcome: text({ enum: PRINT_OUTCOMES }).notNull(),
    failureReason: text(),
    notes: text(),
    energyWh: real(),
    energySource: text({ enum: ENERGY_SOURCES }),
    costSnapshot: text({ mode: "json" }),
    sourceUrl: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    index("prints_started_idx").on(t.startedAt),
    index("prints_printer_started_idx").on(t.printerId, t.startedAt),
    index("prints_project_idx").on(t.projectId),
    index("prints_order_idx").on(t.orderId),
    uniqueIndex("prints_external_uq").on(t.integrationId, t.externalId),
    uniqueIndex("prints_number_uq").on(t.number),
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
    severity: text({ enum: ALERT_SEVERITIES }).notNull(),
    module: text({ enum: ALERT_MODULES }).notNull(),
    /** What raised it (ADR-0008): `spool:<id>`, `maintenance:<target>:<type>`, `printer:<id>`, `sync:<integration>:<type>`. */
    task: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    context: text({ mode: "json" }).notNull().$type<Record<string, string | number>>().default({}),
    /** The expanded view (a sync log); null = nothing more to show. */
    detail: text({ mode: "json" }).$type<AlertDetail>(),
    createdAt: text().notNull().$defaultFn(now),
    readAt: text(),
    /** When the channels were told; null = still to send. Re-armed when a snooze ends. */
    notifiedAt: text(),
    snoozedUntil: text(),
    /** Hidden until the condition resolves and comes back. */
    dismissedAt: text(),
    resolvedAt: text(),
    /** The last status change (read, snooze, dismiss, resolve); null = never touched. */
    updatedAt: text(),
  },
  (t) => [
    uniqueIndex("alerts_open_uq")
      .on(t.kind, t.entityType, t.entityId)
      .where(sql`${t.resolvedAt} IS NULL`),
    check("alerts_kind_ck", oneOf(t.kind, ALERT_KINDS)),
    check("alerts_severity_ck", oneOf(t.severity, ALERT_SEVERITIES)),
    check("alerts_module_ck", oneOf(t.module, ALERT_MODULES)),
  ],
);

// Saved pricing-calculator results. `form` is the calculator state; cost/quote are the numbers
// as quoted, so later price changes don't rewrite an offer already made.
export const quotes = sqliteTable(
  "quotes",
  {
    id: id(),
    // Nullable in SQL only (added to a filled table, see 0051); the API always sets it.
    number: integer(),
    projectId: text().references(() => projects.id, { onDelete: "set null" }),
    clientId: text().references((): AnySQLiteColumn => clients.id, { onDelete: "set null" }),
    name: text().notNull(),
    notes: text(),
    form: text({ mode: "json" }).notNull(),
    cost: text({ mode: "json" }).notNull(),
    quote: text({ mode: "json" }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("quotes_project_idx").on(t.projectId),
    index("quotes_client_idx").on(t.clientId),
    uniqueIndex("quotes_number_uq").on(t.number),
  ],
);

// One row per applied import. `backup` is the automatic backup taken just before the run.
export const importRuns = sqliteTable(
  "import_runs",
  {
    id: id(),
    source: text().$type<(typeof IMPORT_SOURCES)[number]>().notNull(),
    type: text().notNull(),
    fileName: text(),
    created: integer().notNull(),
    updated: integer().notNull(),
    skipped: integer().notNull(),
    invalid: integer().notNull(),
    /** JSON `{ row, column, code }[]`, capped. */
    errors: text({ mode: "json" }).$type<{ row: number; column: string; code: string }[]>(),
    backup: text(),
    createdAt: text().notNull().$defaultFn(now),
  },
  (t) => [check("import_runs_source_ck", oneOf(t.source, IMPORT_SOURCES))],
);

// Who quotes and orders are for. VAT, mobile and email are unique when filled (email ignoring
// case); the API stores empty ones as null and maps a violation to `client_<field>_taken`.
export const clients = sqliteTable(
  "clients",
  {
    id: id(),
    name: text().notNull(),
    mobile: text().notNull(),
    vat: text(),
    email: text(),
    address: text(),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("clients_vat_uq").on(t.vat).where(sql`${t.vat} IS NOT NULL`),
    uniqueIndex("clients_mobile_uq").on(t.mobile),
    uniqueIndex("clients_email_uq")
      .on(sql`${t.email} COLLATE NOCASE`)
      .where(sql`${t.email} IS NOT NULL`),
  ],
);

// Work agreed with a client (or none). `status` is one of the `orderStatuses` preference, checked
// by the API like printers.state. An order has one or more projects (API-enforced).
export const orders = sqliteTable(
  "orders",
  {
    id: id(),
    number: integer().notNull(),
    clientId: text().references(() => clients.id, { onDelete: "set null" }),
    quoteId: text().references(() => quotes.id, { onDelete: "set null" }),
    price: integer().notNull(),
    status: text().notNull(),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_number_uq").on(t.number),
    index("orders_client_idx").on(t.clientId),
    index("orders_quote_idx").on(t.quoteId),
    check("orders_price_ck", sql`${t.price} >= 0`),
  ],
);

export const orderProjects = sqliteTable(
  "order_projects",
  {
    orderId: text()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.projectId] }),
    index("order_projects_project_idx").on(t.projectId),
  ],
);

/** App log lines, fed from pino (apps/server/src/lib/logSink.ts) and pruned hourly. */
export const logs = sqliteTable(
  "logs",
  {
    // rowid, not a uuid: high volume, never referenced, gives insert order for free.
    id: integer().primaryKey(),
    time: text().notNull(),
    level: text({ enum: LOG_LEVELS }).notNull(),
    /** One of LOG_MODULES; no CHECK, so adding a module needs no table rebuild. */
    module: text().notNull(),
    message: text().notNull(),
    /** The rest of the pino line (err, url, status, ids), already redacted. */
    detail: text({ mode: "json" }).$type<Record<string, unknown>>(),
    /** User id behind a request line; null for jobs and the no-users mode. No FK: a line
     *  outlives a deleted user and keeps saying who did it. */
    actor: text(),
  },
  (t) => [index("logs_time_idx").on(t.time), check("logs_level_ck", oneOf(t.level, LOG_LEVELS))],
);

/** Accounts (ADR-0012). The hash never leaves the server: core's `userSchema` has no hash field. */
export const users = sqliteTable(
  "users",
  {
    id: id(),
    /** Unique ignoring case, like clients.email. */
    email: text().notNull(),
    displayName: text().notNull(),
    /** `lib/password.ts` format: `scrypt$N$r$p$salt$key`. */
    passwordHash: text().notNull(),
    role: text({ enum: USER_ROLES }).notNull(),
    disabled: integer({ mode: "boolean" }).notNull().default(false),
    /** Project rights (ADR-0014); an admin always sees and edits everyone's projects. */
    projectsSeeAll: integer({ mode: "boolean" }).notNull().default(true),
    projectsEditOthers: integer({ mode: "boolean" }).notNull().default(true),
    /** Edit files in another user's device root (where the root lets them). */
    editOtherDevices: integer({ mode: "boolean" }).notNull().default(false),
    lastLoginAt: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`${t.email} COLLATE NOCASE`),
    check("users_role_ck", oneOf(t.role, USER_ROLES)),
  ],
);

/** Login sessions. `id` is the sha256 of the cookie token; the token itself is never stored. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text().notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Per-user display preferences (ADR-0012 keys), same shape as `settings`; falls back to it. */
export const userSettings = sqliteTable(
  "user_settings",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: text({ mode: "json" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** Each user's own read, snooze and dismiss on an alert (ADR-0012); no row = the `alerts` columns. Resolving stays on `alerts`. */
export const alertStates = sqliteTable(
  "alert_states",
  {
    alertId: text()
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: text(),
    snoozedUntil: text(),
    dismissedAt: text(),
    /** The user's last change; history sorts on it. */
    updatedAt: text(),
  },
  (t) => [
    primaryKey({ columns: [t.alertId, t.userId] }),
    index("alert_states_user_idx").on(t.userId),
  ],
);

/** Connectors paired with the hub (ADR-0014). A device acts as its user; deleting the row revokes it. */
export const devices = sqliteTable(
  "devices",
  {
    id: id(),
    name: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 of the device token, like `sessions.id`; the token itself is never stored. */
    tokenHash: text().notNull(),
    os: text(),
    connectorVersion: text(),
    /** What the connector reported when its stream last opened (`X-Connector-Update`). */
    updateFailed: text({ mode: "json" }).$type<ConnectorUpdateFailure>(),
    /** What the connector reported last about its sync of the hub roots (`PUT .../sync/state`). */
    syncState: text({ mode: "json" }).$type<DeviceSyncState & { reportedAt: string }>(),
    /** `all` the hub roots, or only its `device_projects`. */
    syncMode: text({ enum: DEVICE_SYNC_MODES }).notNull().default("all"),
    /** The slicers its connector found (`PUT .../slicers`). */
    slicers: text({ mode: "json" }).$type<DeviceSlicer[]>().notNull().default([]),
    lastSeenAt: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("devices_token_uq").on(t.tokenHash),
    index("devices_user_idx").on(t.userId),
    check("devices_sync_mode_ck", oneOf(t.syncMode, DEVICE_SYNC_MODES)),
  ],
);

/** The projects a device syncs in `selected` mode. */
export const deviceProjects = sqliteTable(
  "device_projects",
  {
    deviceId: text()
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.projectId] })],
);

/** One-time pairing codes an admin makes for a user. `id` is the code's sha256; used = deleted. */
export const pairingCodes = sqliteTable("pairing_codes", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text().notNull(),
});

/**
 * Hub → device events waiting for the device (ADR-0014). `seq` is the SSE event id; a reconnect's
 * `Last-Event-ID` acks (deletes) everything up to it.
 */
export const hubEvents = sqliteTable(
  "hub_events",
  {
    seq: integer().primaryKey({ autoIncrement: true }),
    deviceId: text()
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    type: text().notNull(),
    data: text({ mode: "json" }).notNull(),
    createdAt: text().notNull(),
  },
  (t) => [index("hub_events_device_idx").on(t.deviceId, t.seq)],
);

/**
 * The files of hub roots as devices sync them (ADR-0014). Every add, change and delete takes the
 * next `seq`, so a device asks for "changes since my cursor". A deleted file stays as a tombstone.
 * `size` and `mtimeMs` are the hub's own, only to skip rehashing unchanged files.
 */
export const hubFiles = sqliteTable(
  "hub_files",
  {
    id: id(),
    rootId: text()
      .notNull()
      .references(() => roots.id, { onDelete: "cascade" }),
    path: text().notNull(),
    size: integer().notNull(),
    mtimeMs: real().notNull(),
    sha256: text().notNull(),
    version: integer().notNull(),
    deleted: integer({ mode: "boolean" }).notNull().default(false),
    seq: integer().notNull(),
    /** The device that has the file checked out (`hubLocks`); its user is the editor. */
    lockDeviceId: text().references(() => devices.id, { onDelete: "set null" }),
    lockedAt: text(),
    /** Taking the lock or an accepted upload from its device; the idle timeout counts from here. */
    lockTouchedAt: text(),
    /** Who saved this version and when (names as they were); null for a change made on the hub. */
    savedUser: text(),
    savedDevice: text(),
    savedAt: text(),
  },
  (t) => [
    uniqueIndex("hub_files_root_path_uq").on(t.rootId, t.path),
    uniqueIndex("hub_files_seq_uq").on(t.seq),
  ],
);

/**
 * The earlier contents of a hub file (`hubVersions`), kept at
 * `<dataDir>/versions/<rootId>/<fileId>/<version>`. Who and when are those of the version itself.
 */
export const hubFileVersions = sqliteTable(
  "hub_file_versions",
  {
    id: id(),
    fileId: text()
      .notNull()
      .references(() => hubFiles.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    size: integer().notNull(),
    user: text(),
    device: text(),
    savedAt: text().notNull(),
  },
  (t) => [uniqueIndex("hub_file_versions_file_version_uq").on(t.fileId, t.version)],
);
