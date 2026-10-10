import {
  type ImportCell,
  type ImportTarget,
  type ImportValues,
  matchPrinterRows,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNull } from "drizzle-orm";
import { modelIdFor } from "../lib/catalog.ts";

const { brands, printerModels, printers } = schema;

const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
// Date-only values are stored as noon UTC, like the printer form does.
const noon = (c: ImportCell | undefined) =>
  typeof c === "string" ? new Date(`${c}T12:00:00Z`).toISOString() : null;
const day = (iso: string | null) => iso?.slice(0, 10) ?? null;
const lower = (list: string[]) => new Set(list.map((n) => n.toLowerCase()));
/** One spelling per name, the first one seen. */
const distinct = (names: string[]) => [
  ...new Map(names.filter(Boolean).map((n) => [n.toLowerCase(), n])).values(),
];

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
        label: p.name,
        values: {
          name: p.name,
          brand,
          model,
          serial: p.serial,
          nozzleDiameterMm: p.nozzleDiameterMm,
          purchasedAt: day(p.purchasedAt),
          purchasePrice: p.purchasePrice,
          warrantyEndsAt: day(p.warrantyEndsAt),
          powerW: p.powerW,
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
        name: str(v.name) ?? "",
        modelId: modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? ""),
        serial: str(v.serial),
        nozzleDiameterMm: num(v.nozzleDiameterMm) ?? undefined,
        purchasedAt: noon(v.purchasedAt),
        purchasePrice: num(v.purchasePrice),
        warrantyEndsAt: noon(v.warrantyEndsAt),
        powerW: num(v.powerW),
      })
      .run();
  },

  /** Writes `patch` (only the values that change) to the printer. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const { brand, model, purchasedAt, warrantyEndsAt, ...fields } = patch;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    if (purchasedAt != null) set.purchasedAt = noon(purchasedAt);
    if (warrantyEndsAt != null) set.warrantyEndsAt = noon(warrantyEndsAt);
    if (brand !== undefined || model !== undefined) {
      const v = { ...target.values, ...patch };
      set.modelId = modelIdFor(db, str(v.brand) ?? "", str(v.model) ?? "");
    }
    if (Object.keys(set).length)
      db.update(printers).set(set).where(eq(printers.id, target.id)).run();
  },
};
