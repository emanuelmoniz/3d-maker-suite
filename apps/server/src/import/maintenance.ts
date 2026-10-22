import {
  type ImportCell,
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  matchRowsOn,
  modelLabel,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { asc, eq } from "drizzle-orm";
import { accessoryUsageOf, usageOf } from "../lib/maintenance.ts";
import { accessoryTitle, printerTitle } from "../lib/numbers.ts";
import { find, type Ref, refOf } from "./prints.ts";
import { num, str } from "./spools.ts";

const { accessories, brands, maintenanceTasks, maintenanceTypes, printerModels, printers } = schema;

type RowError = { column: string; code: ImportErrorCode };

const HOUR = 3600;
const cell = (c: ImportCell | undefined) => (c == null ? "" : String(c).trim());
const yesNo = (b: boolean | null) => (b == null ? null : b ? "yes" : "no");
const bool = (c: ImportCell | undefined) => (c === "yes" ? true : c === "no" ? false : null);
const hours = (sec: number | null) => (sec == null ? null : sec / HOUR);
const seconds = (h: ImportCell | undefined) =>
  num(h) == null ? null : Math.round(Number(h) * HOUR);
/** The time the way the file column keeps it: UTC, to the second. */
const second = (iso: string) => `${new Date(iso).toISOString().slice(0, 19)}Z`;
/** The items of a `;` list cell. */
const items = (c: ImportCell | undefined) =>
  cell(c)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);

type Look = {
  types: Ref;
  targets: Map<string, string>;
  models: Ref;
  printers: Ref;
  accessories: Ref;
};
function build(db: Db): Look {
  const types = db.select().from(maintenanceTypes).all();
  return {
    types: refOf(
      types.map((t) => ({ id: t.id, number: null, keys: [t.name], archivedAt: t.archivedAt })),
    ),
    targets: new Map(types.map((t) => [t.id, t.target])),
    models: refOf(
      db
        .select({ id: printerModels.id, brand: brands.name, model: printerModels.model })
        .from(printerModels)
        .innerJoin(brands, eq(brands.id, printerModels.brandId))
        .all()
        .map((m) => ({ id: m.id, number: null, keys: [modelLabel(m.brand, m.model)] })),
    ),
    printers: refOf(
      db
        .select()
        .from(printers)
        .all()
        .map((p) => ({ ...p, keys: [printerTitle(p), p.name] })),
    ),
    accessories: refOf(
      db
        .select()
        .from(accessories)
        .all()
        .map((a) => ({ ...a, keys: [accessoryTitle(a), a.name] })),
    ),
  };
}
// A preview or an apply runs in one synchronous stretch (see `lookups` in prints.ts).
let cached: { db: Db; look: Look } | null = null;
function lookups(db: Db): Look {
  if (cached?.db !== db) {
    cached = { db, look: build(db) };
    queueMicrotask(() => {
      cached = null;
    });
  }
  return cached.look;
}

/** The cell as the display name of the row it means (the spelling the targets use). */
const label = (ref: Ref, c: ImportCell | undefined) => {
  const id = find(ref, c);
  return (id && ref.labels.get(id)) || (c ?? null);
};
/** A list cell with each item in its display spelling, sorted; null when empty. */
const canonList = (ref: Ref, c: ImportCell | undefined) => {
  const list = items(c).map((i) => String(label(ref, i)));
  return list.length ? list.sort().join("; ") : null;
};
const ids = (ref: Ref, c: ImportCell | undefined) => items(c).flatMap((i) => find(ref, i) ?? []);
const listErrors = (ref: Ref, column: string, c: ImportCell | undefined): RowError[] =>
  items(c).some((i) => !find(ref, i)) ? [{ column, code: "unresolved" }] : [];

const joined = (list: string[], ref: Ref) =>
  list.length
    ? list
        .map((id) => ref.labels.get(id) ?? "")
        .sort()
        .join("; ")
    : null;

/** Maintenance types from a file; a type is found by its name. */
export const maintenanceTypeImport = {
  targets(db: Db): ImportTarget[] {
    const look = lookups(db);
    return db
      .select()
      .from(maintenanceTypes)
      .orderBy(asc(maintenanceTypes.name))
      .all()
      .filter((t) => !t.archivedAt)
      .map((t) => ({
        id: t.id,
        label: t.name,
        values: {
          name: t.name,
          target: t.target,
          description: t.description,
          docUrl: t.docUrl,
          intervalDays: t.intervalDays,
          intervalHours: hours(t.intervalSec),
          intervalPrints: t.intervalPrints,
          warnLeadDays: t.warnLeadDays,
          warnLeadHours: t.warnLeadHours,
          warnLeadPrints: t.warnLeadPrints,
          warnEnabled: yesNo(t.warnEnabled),
          errorEnabled: yesNo(t.errorEnabled),
          models: joined(t.appliesToModelIds, look.models),
          printers: joined(t.appliesToPrinterIds, look.printers),
          accessoryTypes: t.appliesToAccessoryTypes.length
            ? [...t.appliesToAccessoryTypes].sort().join("; ")
            : null,
          accessories: joined(t.appliesToAccessoryIds, look.accessories),
        },
      }));
  },
  match: matchRowsOn("name"),
  canon(db: Db, v: ImportValues): ImportValues {
    const look = lookups(db);
    return {
      ...v,
      models: canonList(look.models, v.models),
      printers: canonList(look.printers, v.printers),
      accessoryTypes: items(v.accessoryTypes).sort().join("; ") || null,
      accessories: canonList(look.accessories, v.accessories),
    };
  },
  refs: (db: Db) => ({
    maintenanceTypes: db
      .select({ name: maintenanceTypes.name })
      .from(maintenanceTypes)
      .orderBy(asc(maintenanceTypes.name))
      .all()
      .map((t) => t.name),
  }),
  missing: () => ({}),
  /** A model, printer or accessory the cell names must be one you have. */
  check(db: Db, v: ImportValues): RowError[] {
    const look = lookups(db);
    return [
      ...listErrors(look.models, "models", v.models),
      ...listErrors(look.printers, "printers", v.printers),
      ...listErrors(look.accessories, "accessories", v.accessories),
    ];
  },
  create(db: Db, v: ImportValues) {
    db.insert(maintenanceTypes).values(columns(db, v)).run();
  },
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    db.update(maintenanceTypes)
      .set(columns(db, { ...target.values, ...patch }))
      .where(eq(maintenanceTypes.id, target.id))
      .run();
  },
};

function columns(db: Db, v: ImportValues) {
  const look = lookups(db);
  return {
    name: str(v.name) ?? "",
    target: v.target === "accessory" ? ("accessory" as const) : ("printer" as const),
    description: str(v.description),
    docUrl: str(v.docUrl),
    intervalDays: num(v.intervalDays),
    intervalSec: seconds(v.intervalHours),
    intervalPrints: num(v.intervalPrints),
    warnLeadDays: num(v.warnLeadDays),
    warnLeadHours: num(v.warnLeadHours),
    warnLeadPrints: num(v.warnLeadPrints),
    warnEnabled: bool(v.warnEnabled),
    errorEnabled: bool(v.errorEnabled),
    appliesToModelIds: ids(look.models, v.models),
    appliesToPrinterIds: ids(look.printers, v.printers),
    appliesToAccessoryTypes: items(v.accessoryTypes),
    appliesToAccessoryIds: ids(look.accessories, v.accessories),
  };
}

/** The task's columns from a row; usage left empty is the target's at that time, as the API does. */
function taskColumns(db: Db, v: ImportValues) {
  const look = lookups(db);
  const printerId = find(look.printers, v.printer);
  const accessoryId = printerId ? null : find(look.accessories, v.accessory);
  const doneAt = new Date(str(v.doneAt) ?? "").toISOString();
  const printer = printerId
    ? db.select().from(printers).where(eq(printers.id, printerId)).get()
    : undefined;
  const at = printer
    ? usageOf(db, printer, doneAt)
    : accessoryUsageOf(db, accessoryId ?? "", doneAt);
  return {
    typeId: find(look.types, v.type) ?? "",
    printerId,
    accessoryId,
    doneAt,
    printerRuntimeSecAt: seconds(v.runtimeHoursAt) ?? at.runtimeSec,
    printerPrintsAt: num(v.printsAt) ?? at.prints,
    notes: str(v.notes),
    cost: num(v.cost),
  };
}

/**
 * Maintenance done, from a file. A task is its type, its printer or accessory (the one the type
 * is for) and the time it was done; all of them must exist.
 */
export const maintenanceImport = {
  targets: (db: Db): ImportTarget[] =>
    db
      .select({ task: maintenanceTasks, type: maintenanceTypes.name })
      .from(maintenanceTasks)
      .innerJoin(maintenanceTypes, eq(maintenanceTypes.id, maintenanceTasks.typeId))
      .orderBy(asc(maintenanceTasks.doneAt))
      .all()
      .map(({ task: t, type }) => {
        const look = lookups(db);
        const printer = t.printerId ? look.printers.labels.get(t.printerId) : null;
        const accessory = t.accessoryId ? look.accessories.labels.get(t.accessoryId) : null;
        return {
          id: t.id,
          label: `${type} · ${printer ?? accessory} · ${second(t.doneAt).slice(0, 10)}`,
          values: {
            type,
            printer: printer ?? null,
            accessory: accessory ?? null,
            doneAt: second(t.doneAt),
            runtimeHoursAt: hours(t.printerRuntimeSecAt),
            printsAt: t.printerPrintsAt,
            cost: t.cost,
            notes: t.notes,
          },
        };
      }),
  match: matchRowsOn("type", "printer", "accessory", "doneAt"),
  canon(db: Db, v: ImportValues): ImportValues {
    const look = lookups(db);
    return {
      ...v,
      type: label(look.types, v.type),
      printer: label(look.printers, v.printer) || null,
      accessory: label(look.accessories, v.accessory) || null,
    };
  },
  refs: (db: Db) => ({
    ...maintenanceTypeImport.refs(db),
    printers: [...lookups(db).printers.labels.values()],
    accessories: [...lookups(db).accessories.labels.values()],
  }),
  missing: () => ({}),
  /** The type exists, and exactly one printer or accessory is named: the one the type is for. */
  check(db: Db, v: ImportValues): RowError[] {
    const look = lookups(db);
    const typeId = find(look.types, v.type);
    const errors: RowError[] = [];
    if (!typeId) errors.push({ column: "type", code: "unresolved" });
    for (const column of ["printer", "accessory"] as const)
      if (
        cell(v[column]) &&
        !find(look[column === "printer" ? "printers" : "accessories"], v[column])
      )
        errors.push({ column, code: "unresolved" });
    const target = (typeId && look.targets.get(typeId)) || "printer";
    const other = target === "printer" ? "accessory" : "printer";
    const wrong = cell(v[other]) ? other : cell(v[target]) ? null : target;
    if (wrong && typeId && !errors.some((e) => e.column === wrong))
      errors.push({ column: wrong, code: "wrong_target" });
    return errors;
  },
  create(db: Db, v: ImportValues) {
    db.insert(maintenanceTasks).values(taskColumns(db, v)).run();
  },
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    db.update(maintenanceTasks)
      .set(taskColumns(db, { ...target.values, ...patch }))
      .where(eq(maintenanceTasks.id, target.id))
      .run();
  },
};
