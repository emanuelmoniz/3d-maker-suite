import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  type DependentType,
  hasLevel,
  type InUseDetails,
  type PermissionModule,
  type ReviewEntity,
  type TAGGABLE_TYPES,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, count, eq, or, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { HttpError } from "../errors.ts";
import { alertTasks, resolveItemAlerts } from "./archive.ts";
import type { Rights } from "./auth.ts";
import {
  accessoryLabel,
  nameKey,
  orderLabel,
  printerLabel,
  printerModelLabel,
  printLabel,
  profileLabel,
  quoteLabel,
  spoolName,
} from "./catalog.ts";
import { syncUsages } from "./prints.ts";

const {
  accessories,
  accessoryComments,
  accessoryInstalls: installs,
  brands,
  clients,
  collectionProjects,
  deletedSources,
  deviceProjects,
  filamentBrands,
  filamentMaterials,
  filamentProfiles,
  importSnapshots,
  machineProfiles,
  maintenanceTasks: tasks,
  maintenanceTypes,
  orderProjects,
  orders,
  printerComments,
  printerModels,
  printers,
  printFilamentUsages: usages,
  printProfiles,
  prints,
  projectSlicePlates: plates,
  projects,
  quotes,
  settings,
  spools,
  spoolWeightEntries,
  taggings,
} = schema;

const MAX_ITEMS = 20;

/** Rows of a table that can stand in the way, as the 409 names them. */
type Of = {
  type: DependentType;
  module: PermissionModule;
  table: SQLiteTable;
  label: SQLWrapper;
  /** What the web links to; none = the row's id. */
  id?: SQLWrapper;
};
type Use = Of & {
  /** The FK behind the reference; none for an id in a JSON list. */
  via?: SQLiteColumn;
  /** The item's id, or its column for a list's `presetUsed`. */
  where: (id: string | SQLWrapper) => SQL;
  /** Rows of the item's own table (older versions): `presetUsed` aliases them. */
  self?: true;
};
const of = (type: DependentType, module: PermissionModule, table: SQLiteTable, label: SQLWrapper) =>
  ({ type, module, table, label }) as Of;

const PRINTER_MODEL = of("printerModel", "printers", printerModels, printerModelLabel);
const MACHINE_PROFILE = of("machineProfile", "printers", machineProfiles, machineProfiles.name);
const PRINT_PROFILE = of("printProfile", "printers", printProfiles, printProfiles.name);
const PRINTER = of("printer", "printers", printers, printerLabel);
const ACCESSORY = of("accessory", "printers", accessories, accessoryLabel);
const MAINTENANCE_TYPE = of(
  "maintenanceType",
  "maintenance",
  maintenanceTypes,
  maintenanceTypes.name,
);
const MAINTENANCE_TASK = of(
  "maintenanceTask",
  "maintenance",
  tasks,
  sql`(SELECT ${maintenanceTypes.name} FROM ${maintenanceTypes} WHERE ${maintenanceTypes.id} = ${tasks.typeId})`,
);
const FILAMENT_PROFILE = of("filamentProfile", "filament", filamentProfiles, profileLabel);
const SPOOL = of("spool", "filament", spools, spoolName);
const PRINT = of("print", "prints", prints, printLabel);
const ORDER = of("order", "costs", orders, orderLabel);
const QUOTE = of("quote", "costs", quotes, quoteLabel);
// A plate is named and linked by its project.
const PLATE = {
  ...of(
    "plate",
    "projects",
    plates,
    sql`(SELECT ${projects.name} FROM ${projects} WHERE ${projects.id} = ${plates.projectId}) || ' · ' || ${plates.file} || ' #' || ${plates.plate}`,
  ),
  id: plates.projectId,
};

/** Loosely typed on purpose: every listed table has an id, most an `archivedAt`. */
const columns = (table: SQLiteTable) =>
  table as unknown as { id: SQLiteColumn; archivedAt?: SQLiteColumn };

/** Rows of `o` whose `via` is the item. */
const on = (o: Of, via: SQLiteColumn): Use => ({ ...o, via, where: (id) => eq(via, id) });
/** Rows of `o` named by `pick` on the rows whose `via` is the item (a print through its usages). */
const through = (o: Of, via: SQLiteColumn, pick: SQLiteColumn): Use => ({
  ...o,
  via,
  where: (id) =>
    sql`${columns(o.table).id} IN (SELECT ${pick} FROM ${via.table} WHERE ${via} = ${id})`,
});
/** Rows of `o` whose JSON list holds the item. */
const listed = (o: Of, list: SQLiteColumn): Use => ({
  ...o,
  where: (id) => sql`EXISTS (SELECT 1 FROM json_each(${list}) WHERE value = ${id})`,
});

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = Record<string, unknown>;
type Item = {
  table: SQLiteTable;
  /** Blocks the delete. */
  uses: Use[];
  /** FKs whose rows are deleted with the item: by the FK, or by `before`. */
  goes?: SQLiteColumn[];
  /** FKs emptied by the FK; the row stays. */
  clears?: SQLiteColumn[];
  tag?: (typeof TAGGABLE_TYPES)[number];
  alerts?: (id: string) => string[];
  /** The column holding its image file, relative to the data dir. */
  image?: string;
  /** What a sync knows it by; none for a row that didn't come from one. */
  source?: (db: Db, row: Row) => string | null;
  before?: (tx: Tx, row: Row) => void;
};

const sourcePreset = (_: Db, row: Row) => row.sourcePreset as string | null;
const byName = (_: Db, row: Row) => nameKey(row.name as string);
const bySource = (_: Db, row: Row) =>
  row.integrationId && row.externalId ? `${row.integrationId}:${row.externalId}` : null;

/**
 * ADR-0018's dependency table. Some FKs say otherwise (`accessory_installs.accessory_id` cascades,
 * `quotes.project_id` sets null): every delete goes through here. `deletes.test.ts` fails on an FK
 * to one of these tables that isn't listed.
 */
export const ITEMS = {
  brands: {
    table: brands,
    uses: [on(PRINTER_MODEL, printerModels.brandId)],
    image: "logoPath",
    source: byName,
  },
  printerModels: {
    table: printerModels,
    uses: [
      on(PRINTER, printers.modelId),
      on(MACHINE_PROFILE, machineProfiles.printerModelId),
      on(PRINT_PROFILE, printProfiles.printerModelId),
      listed(MAINTENANCE_TYPE, maintenanceTypes.appliesToModelIds),
    ],
    image: "imagePath",
    source: (db, row) =>
      nameKey(
        db
          .select({ name: brands.name })
          .from(brands)
          .where(eq(brands.id, row.brandId as string))
          .get()?.name,
        row.model as string,
      ),
  },
  machineProfiles: {
    table: machineProfiles,
    uses: [on(PRINT, prints.machineProfileId)],
    clears: [printers.machineProfileId],
    source: sourcePreset,
  },
  printProfiles: {
    table: printProfiles,
    uses: [],
    clears: [printers.printProfileId, plates.printProfileId],
    source: sourcePreset,
  },
  printers: {
    table: printers,
    uses: [
      on(PRINT, prints.printerId),
      on(MAINTENANCE_TASK, tasks.printerId),
      through(ACCESSORY, installs.printerId, installs.accessoryId),
      listed(MAINTENANCE_TYPE, maintenanceTypes.appliesToPrinterIds),
    ],
    goes: [printerComments.printerId],
    clears: [plates.printerId],
    tag: "printer",
    alerts: alertTasks.printer,
    image: "photoPath",
    source: bySource,
    before: (tx, row) => {
      tx.delete(settings)
        .where(and(eq(settings.key, "defaultPrinterId"), eq(settings.value, row.id)))
        .run();
      // Also by hand: a database that ran 0049 before its FK got `set null` would refuse the delete.
      tx.update(plates)
        .set({ printerId: null })
        .where(eq(plates.printerId, row.id as string))
        .run();
    },
  },
  accessories: {
    table: accessories,
    uses: [
      on(MAINTENANCE_TASK, tasks.accessoryId),
      through(PRINTER, installs.accessoryId, installs.printerId),
      listed(MAINTENANCE_TYPE, maintenanceTypes.appliesToAccessoryIds),
    ],
    goes: [accessoryComments.accessoryId],
    tag: "accessory",
    alerts: alertTasks.accessory,
    image: "photoPath",
  },
  maintenanceTypes: {
    table: maintenanceTypes,
    uses: [on(MAINTENANCE_TASK, tasks.typeId)],
    alerts: alertTasks.maintenanceType,
  },
  filamentBrands: {
    table: filamentBrands,
    uses: [on(FILAMENT_PROFILE, filamentProfiles.brandId), on(SPOOL, spools.brandId)],
    image: "logoPath",
    source: byName,
  },
  filamentMaterials: {
    table: filamentMaterials,
    uses: [on(FILAMENT_PROFILE, filamentProfiles.materialId), on(SPOOL, spools.materialId)],
    source: byName,
  },
  filamentProfiles: {
    table: filamentProfiles,
    // Plates name profiles without a foreign key: `presetUses` lists them.
    uses: [],
    source: sourcePreset,
  },
  spools: {
    table: spools,
    uses: [through(PRINT, usages.spoolId, usages.printId)],
    // The ledger is append-only (its FK restricts), except when its whole spool goes.
    goes: [spoolWeightEntries.spoolId],
    tag: "spool",
    alerts: alertTasks.spool,
    source: (_, row) => row.sourceSpool as string | null,
    before: (tx, row) => {
      tx.delete(spoolWeightEntries)
        .where(eq(spoolWeightEntries.spoolId, row.id as string))
        .run();
    },
  },
  projects: {
    table: projects,
    uses: [
      on(PRINT, prints.projectId),
      through(ORDER, orderProjects.projectId, orderProjects.orderId),
      on(QUOTE, quotes.projectId),
    ],
    goes: [plates.projectId, collectionProjects.projectId, deviceProjects.projectId],
    tag: "project",
    alerts: alertTasks.project,
    image: "thumbnailPath",
  },
  prints: {
    table: prints,
    uses: [],
    goes: [usages.printId],
    source: bySource,
    // The filament goes back to its spools through the ledger.
    before: (tx, row) => syncUsages(tx, row.id as string, row.title as string, []),
  },
  orders: {
    table: orders,
    uses: [on(PRINT, prints.orderId)],
    goes: [orderProjects.orderId],
  },
  quotes: {
    table: quotes,
    uses: [on(ORDER, orders.quoteId)],
  },
  clients: {
    table: clients,
    uses: [on(ORDER, orders.clientId), on(QUOTE, quotes.clientId)],
  },
} satisfies Partial<Record<ReviewEntity, Item>>;

export type ItemKind = keyof typeof ITEMS;

/** No user = the no-users mode, which reads everything. */
const mayRead = (user: Rights | undefined, module: PermissionModule) =>
  !user || user.rights.admin || hasLevel(user.rights.permissions, module, "read");

/** What keeps the item from being deleted; rows the caller can't read are counted, not named. */
export function dependentsOf(
  db: Db,
  user: Rights | undefined,
  kind: ItemKind,
  id: string,
  uses: Use[] = ITEMS[kind].uses,
): InUseDetails["dependents"] {
  return uses.flatMap((use) => {
    const t = columns(use.table);
    const where = use.where(id);
    const archivedAt = t.archivedAt ?? sql`NULL`;
    const counted = db
      .select({ total: count(), archived: count(archivedAt) })
      .from(use.table)
      .where(where)
      .get();
    if (!counted?.total) return [];
    const items = mayRead(user, use.module)
      ? db
          .select({
            id: sql<string>`${use.id ?? t.id}`,
            label: sql<string>`${use.label}`,
            at: sql<unknown>`${archivedAt}`,
          })
          .from(use.table)
          .where(where)
          .orderBy(sql`${archivedAt} IS NOT NULL`, sql`${use.label}`)
          .limit(MAX_ITEMS)
          .all()
      : [];
    return [
      {
        type: use.type,
        total: counted.total,
        archived: counted.archived,
        items: items.map((r) => ({
          id: r.id as string,
          label: r.label,
          archived: r.at != null,
        })),
      },
    ];
  });
}

export type PresetKind = "machineProfiles" | "printProfiles" | "filamentProfiles";

/** Its older versions: archived rows of the same preset, which prints point at. */
const versions = (o: Of): Use => {
  const t = o.table as typeof machineProfiles;
  return {
    ...o,
    self: true,
    where: (id) =>
      sql`${t.id} <> ${id} AND ${t.archivedAt} IS NOT NULL AND ${t.sourcePreset} = (SELECT ${t.sourcePreset} FROM ${t} WHERE ${t.id} = ${id})`,
  };
};

/** What ADR-0019 counts besides the delete check: what that only clears, and older versions. */
const PRESET_USES: Record<PresetKind, Use[]> = {
  machineProfiles: [on(PRINTER, printers.machineProfileId), versions(MACHINE_PROFILE)],
  printProfiles: [
    on(PRINTER, printers.printProfileId),
    on(PLATE, plates.printProfileId),
    versions(PRINT_PROFILE),
  ],
  filamentProfiles: [listed(PLATE, plates.filaments), versions(FILAMENT_PROFILE)],
};

/**
 * ADR-0019's "in use", stricter than the delete check: a slicer preset's catalog row is also used
 * by a printer's machine profile, a plate's or printer's print profile, a plate's filament list,
 * its older versions and the
 * presets that inherit from it (`inheritedBy`, their names: the caller reads the slicer's files).
 */
export function presetInUse(
  db: Db,
  user: Rights | undefined,
  kind: PresetKind,
  id: string,
  inheritedBy: string[] = [],
): InUseDetails["dependents"] {
  const found = dependentsOf(db, user, kind, id, [...ITEMS[kind].uses, ...PRESET_USES[kind]]);
  // One entry per type: older versions join the ones the delete check names.
  const merged = new Map<DependentType, InUseDetails["dependents"][number]>();
  for (const d of found) {
    const was = merged.get(d.type);
    merged.set(
      d.type,
      was
        ? {
            ...was,
            total: was.total + d.total,
            archived: was.archived + d.archived,
            items: [...was.items, ...d.items].slice(0, MAX_ITEMS),
          }
        : d,
    );
  }
  if (inheritedBy.length)
    merged.set("preset", {
      type: "preset",
      total: inheritedBy.length,
      archived: 0,
      items: inheritedBy
        .slice(0, MAX_ITEMS)
        .map((name) => ({ id: name, label: name, archived: false })),
    });
  return [...merged.values()];
}

/**
 * `presetInUse` as a column of the list of `kind` ("used" / "unused"), for its In use filter.
 * ponytail: presets that inherit from it aren't counted; they are in the slicer's files, not here.
 */
export function presetUsed(kind: PresetKind) {
  const t = ITEMS[kind].table as typeof machineProfiles;
  const v = alias(t, "v");
  const uses = [...ITEMS[kind].uses, ...PRESET_USES[kind]].filter((u) => !u.self);
  const used = or(
    ...uses.map((u) => sql`EXISTS (SELECT 1 FROM ${u.table} WHERE ${u.where(t.id)})`),
    sql`EXISTS (SELECT 1 FROM ${t} ${sql.identifier("v")} WHERE ${v.id} <> ${t.id} AND ${v.archivedAt} IS NOT NULL
      AND ${v.sourcePreset} = ${t.sourcePreset})`,
  );
  return sql<"used" | "unused">`CASE WHEN ${used} THEN 'used' ELSE 'unused' END`;
}

export function assertFree(db: Db, user: Rights | undefined, kind: ItemKind, id: string) {
  const dependents = dependentsOf(db, user, kind, id);
  if (dependents.length)
    throw new HttpError(409, "in_use", "Still used by other records", { dependents });
}

/**
 * Deletes a row nothing depends on, with everything that has no FK to it: taggings, import
 * snapshots and open alerts in the transaction, its image file after it. An imported row is
 * remembered, so a sync doesn't bring it back unnoticed.
 */
export function deleteItem(
  db: Db,
  kind: ItemKind,
  id: string,
  o: { user: Rights | undefined; dataDir?: string },
) {
  assertFree(db, o.user, kind, id);
  const item: Item = ITEMS[kind];
  // Loosely typed on purpose: one delete for every table.
  const t = item.table as typeof brands;
  const row = db.select().from(t).where(eq(t.id, id)).get() as Row | undefined;
  if (!row) return;
  const source = item.source?.(db, row);
  db.transaction((tx) => {
    item.before?.(tx, row);
    if (item.tag)
      tx.delete(taggings)
        .where(and(eq(taggings.entityType, item.tag), eq(taggings.entityId, id)))
        .run();
    tx.delete(importSnapshots)
      .where(and(eq(importSnapshots.entity, kind), eq(importSnapshots.rowId, id)))
      .run();
    if (item.alerts) resolveItemAlerts(tx, item.alerts(id));
    if (source)
      tx.insert(deletedSources).values({ entity: kind, source }).onConflictDoNothing().run();
    tx.delete(t).where(eq(t.id, id)).run();
  });
  const image = item.image && (row[item.image] as string | null);
  if (image && o.dataDir) rmSync(join(o.dataDir, image), { force: true });
}
