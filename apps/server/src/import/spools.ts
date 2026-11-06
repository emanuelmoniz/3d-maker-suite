import {
  type ImportCell,
  type ImportTarget,
  type ImportValues,
  matchSpoolRows,
  type SpoolStatus,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  filamentBrandIdFor,
  filamentMaterialIdFor,
  spoolColumns,
  spoolName,
} from "../lib/catalog.ts";
import { assertNumberFree, freeNumber, numberCell } from "../lib/numbers.ts";
import { createSpool, setRemaining } from "../lib/spools.ts";
import type { WriteRow } from "./review.ts";

const { filamentBrands, filamentMaterials, spools } = schema;

export const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
export const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
// Date-only values are stored as noon UTC, like the spool form does.
const noon = (c: ImportCell | undefined) =>
  typeof c === "string" ? new Date(`${c}T12:00:00Z`).toISOString() : null;
const day = (iso: string | null) => iso?.slice(0, 10) ?? null;
/** A spool's filament columns as its row's fields; a name that is only the material is none. */
function filament(db: Db, v: ImportValues) {
  const material = str(v.material) ?? "";
  const name = str(v.name)?.trim() || null;
  return {
    brandId: filamentBrandIdFor(db, str(v.brand) ?? ""),
    materialId: filamentMaterialIdFor(db, material),
    name: name?.toLowerCase() === material.trim().toLowerCase() ? null : name,
  };
}
/** One spelling per name, the first one seen. */
export const distinct = (names: string[]) => [
  ...new Map(names.filter(Boolean).map((n) => [n.toLowerCase(), n])).values(),
];

export const names = (
  db: Db,
  table: typeof filamentBrands | typeof filamentMaterials,
  /** For what a template offers; a name match still finds an archived row (ADR-0018). */
  activeOnly = false,
) =>
  db
    .select({ name: table.name })
    .from(table)
    .where(activeOnly ? isNull(table.archivedAt) : undefined)
    .orderBy(table.name)
    .all()
    .map((r) => r.name);

/** Every spool's display name, archived ones too. */
export const spoolLabels = (db: Db) =>
  new Map(
    db
      .select({ id: spools.id, name: spoolName })
      .from(spools)
      .all()
      .map((s) => [s.id, s.name] as const),
  );

/** Active spools, or the vendor's spools you archived, in the shape of the import columns. */
const spoolTargets = (db: Db, archived = false): ImportTarget[] =>
  db
    .select({ spool: spoolColumns, label: spoolName })
    .from(spools)
    .where(
      archived
        ? and(isNotNull(spools.archivedAt), isNotNull(spools.sourceSpool))
        : isNull(spools.archivedAt),
    )
    .orderBy(spools.number)
    .all()
    .map(({ spool: s, label }) => ({
      id: s.id,
      label,
      ...(archived && { archived: true }),
      values: {
        number: s.number,
        brand: s.brand || null,
        material: s.material,
        name: s.name,
        colorHex: s.colorHex.toLowerCase(),
        colorName: s.colorName,
        initialGrams: s.initialGrams,
        remainingGrams: s.remainingGrams,
        emptyWeightGrams: s.emptyWeightGrams,
        pricePaid: s.pricePaid,
        purchasedAt: day(s.purchasedAt),
        openedAt: day(s.openedAt),
        location: s.location,
        status: s.status,
      },
    }));

/** Spools imported from a vendor, by `sourceSpool`: the active ones, or the archived ones. */
const spoolsBySource = (db: Db, archived = false) =>
  new Map(
    db
      .select({ source: spools.sourceSpool, id: spools.id })
      .from(spools)
      .where(
        and(
          isNotNull(spools.sourceSpool),
          archived ? isNotNull(spools.archivedAt) : isNull(spools.archivedAt),
        ),
      )
      .all()
      .map((r) => [r.source ?? "", r.id] as const),
  );

/** Spools from a file or an integration: the brand and material are found by name or created. */
export const spoolImport = {
  /** Active spools, in the shape of the import columns. */
  targets: (db: Db) => spoolTargets(db),

  match: matchSpoolRows,

  /** The names the template's dropdowns offer. */
  refs: (db: Db) => ({
    filamentBrands: names(db, filamentBrands, true),
    filamentMaterials: names(db, filamentMaterials, true),
  }),

  /** Brands and materials the rows name that aren't there yet. */
  missing(db: Db, rows: ImportValues[]) {
    const lacking = (key: string, table: typeof filamentBrands | typeof filamentMaterials) => {
      const have = new Set(names(db, table).map((n) => n.toLowerCase()));
      return distinct(rows.map((r) => str(r[key]) ?? "")).filter((n) => !have.has(n.toLowerCase()));
    };
    return {
      filamentBrands: lacking("brand", filamentBrands),
      filamentMaterials: lacking("material", filamentMaterials),
    };
  },

  bySource: (db: Db) => spoolsBySource(db),
  /** A vendor's spool you archived comes back by its source key. */
  archived(db: Db) {
    const bySource = spoolsBySource(db, true);
    return {
      targets: spoolTargets(db, true),
      of: (source: string | undefined) => (source && bySource.get(source)) || null,
    };
  },
  // A change to a spool you have follows the sync type's `merge` (default: you review it).
  exclusive: true,

  create(db: Db, v: ImportValues, row: WriteRow) {
    // No weight = not known yet (a synced spool you weigh later).
    const initialGrams = num(v.initialGrams);
    // Imported as new: the vendor's spool is this one now, not the one linked before.
    if (row.source)
      db.update(spools).set({ sourceSpool: null }).where(eq(spools.sourceSpool, row.source)).run();
    createSpool(db, {
      ...filament(db, v),
      sourceSpool: row.source,
      // A number another spool has ("import as new" of an exported row) gets the next free one.
      number: freeNumber(db, spools, numberCell(v.number)),
      colorHex: str(v.colorHex) ?? undefined,
      colorName: str(v.colorName),
      initialGrams,
      remainingGrams: num(v.remainingGrams) ?? initialGrams,
      emptyWeightGrams: num(v.emptyWeightGrams),
      pricePaid: num(v.pricePaid),
      purchasedAt: noon(v.purchasedAt),
      openedAt: noon(v.openedAt),
      location: str(v.location),
      status: (str(v.status) as SpoolStatus | null) ?? undefined,
    });
  },

  /** Writes `patch` (only the values that change) to the spool. */
  update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
    const { brand, material, name, remainingGrams, purchasedAt, openedAt, ...fields } = patch;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    if ("number" in set) set.number = numberCell(fields.number) ?? undefined;
    assertNumberFree(db, spools, "spool", numberCell(fields.number), target.id);
    if (target.archived) set.archivedAt = null;
    if (purchasedAt != null) set.purchasedAt = noon(purchasedAt);
    if (openedAt != null) set.openedAt = noon(openedAt);
    // A vendor names a filament its own way: its spool never changes yours.
    if (!row.source && [brand, material, name].some((n) => n !== undefined))
      Object.assign(set, filament(db, { ...target.values, ...patch }));
    if (Object.keys(set).length) db.update(spools).set(set).where(eq(spools.id, target.id)).run();
    // A spool entered by hand is linked to the vendor's, so the next run knows it.
    if (row.source)
      db.update(spools)
        .set({ sourceSpool: row.source })
        .where(and(eq(spools.id, target.id), isNull(spools.sourceSpool)))
        .run();
    // The remaining weight only ever changes through the ledger.
    if (typeof remainingGrams === "number")
      setRemaining(db, target.id, "correction", remainingGrams);
  },
};
