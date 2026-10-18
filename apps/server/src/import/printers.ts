import {
  type ImportCell,
  type ImportTarget,
  type ImportValues,
  matchPrinterRows,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNull } from "drizzle-orm";
import { modelIdFor } from "../lib/catalog.ts";
import {
  accessoryTitle,
  assertNumberFree,
  freeNumber,
  nextNumber,
  numberCell,
  printerTitle,
} from "../lib/numbers.ts";

const { brands, printerModels, printers, accessories } = schema;

const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
// Date-only values are stored as noon UTC, like the printer form does.
const noon = (c: ImportCell | undefined) =>
  typeof c === "string" ? new Date(`${c}T12:00:00Z`).toISOString() : null;
const day = (iso: string | null) => iso?.slice(0, 10) ?? null;
const yesNo = (b: boolean | null) => (b == null ? null : b ? "yes" : "no");
const bool = (c: ImportCell | undefined) => (c === "yes" ? true : c === "no" ? false : null);
const lower = (list: string[]) => new Set(list.map((n) => n.toLowerCase()));
/** One spelling per name, the first one seen. */
const distinct = (names: string[]) => [
  ...new Map(names.filter(Boolean).map((n) => [n.toLowerCase(), n])).values(),
];

/** The cost settings of a printer or accessory, as import cells. */
const costValues = (d: {
  countInCosts: boolean | null;
  lifetimeHours: number | null;
  includeMaintenanceCost: boolean | null;
}) => ({
  countInCosts: yesNo(d.countInCosts),
  lifetimeHours: d.lifetimeHours,
  includeMaintenanceCost: yesNo(d.includeMaintenanceCost),
});
/** The same cells as columns; empty = the Costs default. */
const costColumns = (v: ImportValues) => ({
  countInCosts: bool(v.countInCosts),
  lifetimeHours: num(v.lifetimeHours),
  includeMaintenanceCost: bool(v.includeMaintenanceCost),
});

/** A printer's or accessory's `patch` as columns (keys are named like them), cells converted. */
function patchColumns(patch: ImportValues) {
  const { purchasedAt, warrantyEndsAt, ...fields } = patch;
  const set: Record<string, unknown> = { ...fields };
  if ("number" in set) set.number = numberCell(fields.number) ?? undefined;
  if (purchasedAt != null) set.purchasedAt = noon(purchasedAt);
  if (warrantyEndsAt != null) set.warrantyEndsAt = noon(warrantyEndsAt);
  for (const k of ["countInCosts", "includeMaintenanceCost"])
    if (k in set) set[k] = bool(fields[k]);
  return set;
}

const brandNames = (db: Db) => db.select({ name: brands.name }).from(brands).all();
const modelRows = (db: Db) =>
  db
    .select({ brand: brands.name, model: printerModels.model })
    .from(printerModels)
    .innerJoin(brands, eq(brands.id, printerModels.brandId))
    .all();

/** Printers from a file. The brand and model are found by name or created. */
export const printerImport = {
  /** Active printers, in the shape of the import columns. */
  targets: (db: Db): ImportTarget[] =>
    db
      .select({ printer: printers, brand: brands.name, model: printerModels.model })
      .from(printers)
      .leftJoin(printerModels, eq(printerModels.id, printers.modelId))
      .leftJoin(brands, eq(brands.id, printerModels.brandId))
      .where(isNull(printers.archivedAt))
      .all()
      .map(({ printer: p, brand, model }) => ({
        id: p.id,
        label: printerTitle(p),
        values: {
          number: p.number,
          name: p.name,
          brand,
          model,
          serial: p.serial,
          nozzleDiameterMm: p.nozzleDiameterMm,
          purchasedAt: day(p.purchasedAt),
          purchasePrice: p.purchasePrice,
          warrantyEndsAt: day(p.warrantyEndsAt),
          powerW: p.powerW,
          ...costValues(p),
        },
      })),

  match: matchPrinterRows,

  refs: (db: Db) => ({
    brands: brandNames(db)
      .map((b) => b.name)
      .sort(),
    printerModels: distinct(modelRows(db).map((m) => m.model)).sort(),
  }),

  /** Brands and models the rows name that aren't there yet. */
  missing(db: Db, rows: ImportValues[]) {
    const haveBrands = lower(brandNames(db).map((b) => b.name));
    const haveModels = lower(modelRows(db).map((m) => `${m.brand} ${m.model}`));
    return {
      brands: distinct(rows.map((r) => str(r.brand) ?? "")).filter(
        (n) => !haveBrands.has(n.toLowerCase()),
      ),
      printerModels: distinct(rows.map((r) => `${str(r.brand)} ${str(r.model)}`)).filter(
        (n) => !haveModels.has(n.toLowerCase()),
      ),
    };
  },

  create(db: Db, v: ImportValues) {
    db.insert(printers)
      .values({
        // A number another printer has ("import as new" of an exported row) gets the next free one.
        number: freeNumber(db, printers, numberCell(v.number)) ?? nextNumber(printers),
        name: str(v.name) ?? "",
        modelId: modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? ""),
        serial: str(v.serial),
        nozzleDiameterMm: num(v.nozzleDiameterMm) ?? undefined,
        purchasedAt: noon(v.purchasedAt),
        purchasePrice: num(v.purchasePrice),
        warrantyEndsAt: noon(v.warrantyEndsAt),
        powerW: num(v.powerW),
        ...costColumns(v),
      })
      .run();
  },

  /** Writes `patch` (only the values that change) to the printer. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const { brand, model, ...rest } = patch;
    const set = patchColumns(rest);
    assertNumberFree(db, printers, "printer", numberCell(patch.number), target.id);
    if (brand !== undefined || model !== undefined) {
      const v = { ...target.values, ...patch };
      set.modelId = modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? "");
    }
    if (Object.keys(set).length)
      db.update(printers).set(set).where(eq(printers.id, target.id)).run();
  },
};

/**
 * Accessories from a file, matched like printers (number, else serial, else name). Which printer
 * an accessory is on stays on its page: installs are periods, not a cell.
 */
export const accessoryImport = {
  /** Active accessories, in the shape of the import columns. */
  targets: (db: Db): ImportTarget[] =>
    db
      .select()
      .from(accessories)
      .where(isNull(accessories.archivedAt))
      .all()
      .map((a) => ({
        id: a.id,
        label: accessoryTitle(a),
        values: {
          number: a.number,
          name: a.name,
          type: a.type,
          serial: a.serial,
          purchasedAt: day(a.purchasedAt),
          purchasePrice: a.purchasePrice,
          warrantyEndsAt: day(a.warrantyEndsAt),
          powerW: a.powerW,
          ...costValues(a),
        },
      })),

  match: matchPrinterRows,

  missing: () => ({}),

  create(db: Db, v: ImportValues) {
    db.insert(accessories)
      .values({
        number: freeNumber(db, accessories, numberCell(v.number)) ?? nextNumber(accessories),
        name: str(v.name) ?? "",
        type: str(v.type) ?? "",
        serial: str(v.serial),
        purchasedAt: noon(v.purchasedAt),
        purchasePrice: num(v.purchasePrice),
        warrantyEndsAt: noon(v.warrantyEndsAt),
        powerW: num(v.powerW),
        ...costColumns(v),
      })
      .run();
  },

  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const set = patchColumns(patch);
    assertNumberFree(db, accessories, "accessory", numberCell(patch.number), target.id);
    if (Object.keys(set).length)
      db.update(accessories).set(set).where(eq(accessories.id, target.id)).run();
  },
};
