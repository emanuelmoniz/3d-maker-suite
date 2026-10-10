import {
  type ImportCell,
  type ImportTarget,
  type ImportValues,
  matchSpoolRows,
  type SpoolStatus,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { profileKey, spoolProfiles } from "../integrations/imports.ts";
import { filamentProfileIdFor, profileBrand, profileMaterial } from "../lib/catalog.ts";
import { createSpool, setRemaining } from "../lib/spools.ts";
import type { WriteRow } from "./review.ts";

const { filamentBrands, filamentMaterials, filamentProfiles, spools } = schema;

export const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
export const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
// Date-only values are stored as noon UTC, like the spool form does.
const noon = (c: ImportCell | undefined) =>
  typeof c === "string" ? new Date(`${c}T12:00:00Z`).toISOString() : null;
const day = (iso: string | null) => iso?.slice(0, 10) ?? null;
const filament = (v: ImportValues) => ({
  brand: str(v.brand) ?? "",
  material: str(v.material) ?? "",
  name: str(v.profile) ?? "",
});
const label = (p: { brand: string; material: string; name: string }) =>
  [p.brand, p.material, p.name].filter(Boolean).join(" ");
/** One spelling per name, the first one seen. */
export const distinct = (names: string[]) => [
  ...new Map(names.filter(Boolean).map((n) => [n.toLowerCase(), n])).values(),
];

const activeProfiles = (db: Db) =>
  db
    .select({ brand: profileBrand, material: profileMaterial, name: filamentProfiles.name })
    .from(filamentProfiles)
    .where(isNull(filamentProfiles.archivedAt))
    .all();
const names = (db: Db, table: typeof filamentBrands | typeof filamentMaterials) =>
  db
    .select({ name: table.name })
    .from(table)
    .orderBy(table.name)
    .all()
    .map((r) => r.name);

/** Every spool's label ("Brand Material Profile"), archived ones too. */
export const spoolLabels = (db: Db) =>
  new Map(
    db
      .select({
        id: spools.id,
        brand: profileBrand,
        material: profileMaterial,
        name: filamentProfiles.name,
      })
      .from(spools)
      .innerJoin(filamentProfiles, eq(filamentProfiles.id, spools.profileId))
      .all()
      .map(({ id, ...p }) => [id, label(p)] as const),
  );

/**
 * Spools from a file: the profile, its brand and its material are found by name or created.
 * Spools from an integration go on a profile the user picks, and a profile is never created.
 */
export const spoolImport = {
  /** Active spools, in the shape of the import columns. */
  targets: (db: Db): ImportTarget[] =>
    db
      .select({
        spool: spools,
        brand: profileBrand,
        material: profileMaterial,
        name: filamentProfiles.name,
      })
      .from(spools)
      .innerJoin(filamentProfiles, eq(filamentProfiles.id, spools.profileId))
      .where(isNull(spools.archivedAt))
      .all()
      .map(({ spool: s, ...p }) => ({
        id: s.id,
        label: label(p),
        values: {
          brand: p.brand || null,
          material: p.material,
          profile: p.name || null,
          colorHex: s.colorHex.toLowerCase(),
          initialGrams: s.initialGrams,
          remainingGrams: s.remainingGrams,
          emptyWeightGrams: s.emptyWeightGrams,
          pricePaid: s.pricePaid,
          purchasedAt: day(s.purchasedAt),
          openedAt: day(s.openedAt),
          location: s.location,
          status: s.status,
        },
      })),

  match: matchSpoolRows,

  /** The names the template's dropdowns offer. */
  refs: (db: Db) => ({
    filamentBrands: names(db, filamentBrands),
    filamentMaterials: names(db, filamentMaterials),
    filamentProfiles: distinct(activeProfiles(db).map((p) => p.name)).sort(),
  }),

  /** Brands, materials and profiles the rows name that aren't there yet. */
  missing(db: Db, rows: ImportValues[]) {
    const lower = (list: string[]) => new Set(list.map((n) => n.toLowerCase()));
    const brands = lower(names(db, filamentBrands));
    const materials = lower(names(db, filamentMaterials));
    const profiles = new Set(activeProfiles(db).map(profileKey));
    const wanted = rows.map(filament);
    return {
      filamentBrands: distinct(wanted.map((f) => f.brand)).filter(
        (n) => !brands.has(n.toLowerCase()),
      ),
      filamentMaterials: distinct(wanted.map((f) => f.material)).filter(
        (n) => !materials.has(n.toLowerCase()),
      ),
      filamentProfiles: distinct(wanted.filter((f) => !profiles.has(profileKey(f))).map(label)),
    };
  },

  bySource: (db: Db) =>
    new Map(
      db
        .select({ source: spools.sourceSpool, id: spools.id })
        .from(spools)
        .where(and(isNotNull(spools.sourceSpool), isNull(spools.archivedAt)))
        .all()
        .map((r) => [r.source ?? "", r.id] as const),
    ),
  exclusive: true,
  handsOff: true,

  /** The profile a vendor's spool goes on: suggested when one fits, a run needs exactly one. */
  picks(db: Db) {
    const profiles = spoolProfiles(db);
    return {
      options: { profile: profiles.active.map((p) => ({ id: p.id, label: label(p) })) },
      suggest(v: ImportValues) {
        const fits = profiles.fits(filament(v));
        return { refs: { profile: fits[0]?.id ?? null }, sure: fits.length === 1 };
      },
    };
  },

  create(db: Db, v: ImportValues, row: WriteRow) {
    const initialGrams = num(v.initialGrams) ?? 0;
    createSpool(db, {
      profileId: row.refs?.profile ?? filamentProfileIdFor(db, filament(v)),
      sourceSpool: row.source,
      colorHex: str(v.colorHex) ?? undefined,
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
    const { brand, material, profile, remainingGrams, purchasedAt, openedAt, ...fields } = patch;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    if (purchasedAt != null) set.purchasedAt = noon(purchasedAt);
    if (openedAt != null) set.openedAt = noon(openedAt);
    // A vendor names a filament its own way: its spool never moves yours to another profile.
    if (!row.source && [brand, material, profile].some((n) => n !== undefined))
      set.profileId = filamentProfileIdFor(db, filament({ ...target.values, ...patch }));
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
