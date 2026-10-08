import {
  ALERT_KINDS,
  ENERGY_SOURCES,
  ORIGINS,
  PRINT_OUTCOMES,
  TAGGABLE_TYPES,
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
  name: text().notNull(),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  config: text({ mode: "json" }).notNull().default({}),
  /** AES-256-GCM blob `{ v, iv, tag, data }` (ADR-0005). Never returned by the API. */
  secrets: text(),
  status: text().notNull().default("new"),
  lastSyncAt: text(),
  lastError: text(),
  ...timestamps,
});

// Rows that may come from an integration; sync upserts by (integrationId, externalId).
const imported = () => ({
  origin: text({ enum: ORIGINS }).notNull().default("manual"),
  integrationId: text().references(() => integrations.id, { onDelete: "set null" }),
  externalId: text(),
});

export const printers = sqliteTable(
  "printers",
  {
    id: id(),
    name: text().notNull(),
    brand: text().notNull(),
    model: text().notNull(),
    serial: text(),
    nozzleDiameterMm: real().notNull().default(0.4),
    runtimeOffsetSec: integer().notNull().default(0),
    printsOffset: integer().notNull().default(0),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("printers_external_uq").on(t.integrationId, t.externalId),
    check("printers_origin_ck", oneOf(t.origin, ORIGINS)),
  ],
);

export const maintenanceTypes = sqliteTable("maintenance_types", {
  id: id(),
  name: text().notNull(),
  intervalSec: integer(),
  intervalPrints: integer(),
  intervalDays: integer(),
  appliesToModel: text(),
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
    ...timestamps,
  },
  (t) => [index("maintenance_tasks_latest_idx").on(t.printerId, t.typeId, t.doneAt)],
);

export const filamentProfiles = sqliteTable(
  "filament_profiles",
  {
    id: id(),
    brand: text().notNull(),
    material: text().notNull(),
    name: text().notNull(),
    colorHex: text().notNull(),
    diameterMm: real().notNull().default(1.75),
    densityGcm3: real().notNull(),
    pricePerKg: integer(),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("filament_profiles_external_uq").on(t.integrationId, t.externalId),
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
    initialGrams: real().notNull(),
    remainingGrams: real().notNull(),
    pricePaid: integer(),
    purchasedAt: text(),
    openedAt: text(),
    location: text(),
    archivedAt: text(),
    ...timestamps,
  },
  (t) => [index("spools_profile_idx").on(t.profileId)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    name: text().notNull(),
    filePath: text(),
    sourceUrl: text(),
    thumbnailPath: text(),
    meta: text({ mode: "json" }).notNull().default({}),
    archivedAt: text(),
    ...imported(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("projects_external_uq").on(t.integrationId, t.externalId),
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

// One row per filament slot (AMS). spoolId is null when an imported print's spool is unknown;
// profileId still keeps the material for cost and stats.
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
    createdAt: text().notNull().$defaultFn(now),
    readAt: text(),
    resolvedAt: text(),
  },
  (t) => [
    uniqueIndex("alerts_open_uq")
      .on(t.kind, t.entityType, t.entityId)
      .where(sql`${t.resolvedAt} IS NULL`),
    check("alerts_kind_ck", oneOf(t.kind, ALERT_KINDS)),
  ],
);
