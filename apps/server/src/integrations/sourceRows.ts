import {
  type ExternalPrint,
  type FilamentLibrary,
  type LibrarySpool,
  matchSpool,
  PRINT_MAX_SLOTS,
  printSlotKeys,
  type SLICER_ZIP_TYPES,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { StoredRow } from "../import/review.ts";
import { spoolImport } from "../import/spools.ts";
import { printerLabel, profileColumns, profileMaterial, spoolName } from "../lib/catalog.ts";
import { predates } from "../lib/prints.ts";
import { profileKey } from "./imports.ts";

const { filamentProfiles, printers, printFilamentUsages, prints, spools } = schema;

export type LibraryType = (typeof SLICER_ZIP_TYPES)[number];
type Row = Omit<StoredRow, "n">;

// What an integration or a zip offers, as the rows a file upload would hold: the review does the rest.
const numbered = (rows: Row[]): StoredRow[] => rows.map((r, i) => ({ n: i + 1, ...r }));

/** Names as the slicer spells them, one per lowercase name. */
const names = (values: string[]) => [
  ...new Map(
    values.filter((v) => v.trim()).map((v) => [v.trim().toLowerCase(), v.trim()]),
  ).values(),
];

/** What a slicer's folder offers for one type. Thumbnails are only offered when `dataDir` can take them. */
export async function libraryRows(
  db: Db,
  lib: FilamentLibrary,
  dir: string,
  type: LibraryType,
  opts: { includeSystem: boolean; dataDir: string },
): Promise<StoredRow[]> {
  if (type === "filamentBrands") {
    // Filament vendors -> filament brands, filament types -> materials, from the filament presets.
    const presets = await lib.read(dir, { includeSystem: true });
    return numbered([
      ...names(presets.map((p) => p.brand)).map((name) => ({ raw: { kind: "brand", name } })),
      ...names(presets.map((p) => p.material)).map((name) => ({ raw: { kind: "material", name } })),
    ]);
  }
  if (type === "filamentProfiles") {
    const have = db.select(profileColumns).from(filamentProfiles).all();
    const active = have.filter((p) => !p.archivedAt);
    const current = new Set(active.map((p) => p.sourcePreset));
    // A profile you archived by hand doesn't come back, whether it was imported or its twin.
    const gone = have.filter((p) => p.archivedAt);
    const goneSources = new Set(gone.map((p) => p.sourcePreset));
    const goneKeys = new Set(gone.map(profileKey));
    for (const p of active) goneKeys.delete(profileKey(p));
    return numbered(
      (await lib.read(dir, { includeSystem: opts.includeSystem })).flatMap((preset) => {
        const { presetId, scope, pricePerKg, ...p } = preset;
        const source = `${lib.id}:${presetId}`;
        if (!current.has(source) && (goneSources.has(source) || goneKeys.has(profileKey(p))))
          return [];
        // The price column is typed in major units, like a file's.
        const price = pricePerKg === null ? null : pricePerKg / 100;
        return [{ source, optional: scope === "system", raw: { ...p, pricePerKg: price } }];
      }),
    );
  }
  const c = (await lib.readCatalog?.(dir)) ?? { models: [], machines: [] };
  if (type === "brands")
    return numbered(
      names([...c.models, ...c.machines].map((m) => m.brand)).map((name) => ({ raw: { name } })),
    );
  if (type === "printerModels")
    return numbered(
      c.models.map((m) => ({
        image: m.image,
        raw: { brand: m.brand, model: m.model, thumbnail: m.image && opts.dataDir ? "yes" : null },
      })),
    );
  return numbered(
    c.machines.map(({ presetId, scope: _scope, ...raw }) => ({
      source: `${lib.id}:${presetId}`,
      raw,
    })),
  );
}

/** The spools an imported print's filament can be matched to (`matchSpool`). */
export const activeSpools = (db: Db) =>
  db
    .select({
      id: spools.id,
      profileId: spools.profileId,
      material: profileMaterial,
      colorHex: spools.colorHex,
      purchasedAt: spools.purchasedAt,
      createdAt: spools.createdAt,
      initialGrams: spools.initialGrams,
      remainingGrams: spools.remainingGrams,
      label: spoolName,
    })
    .from(spools)
    .innerJoin(filamentProfiles, eq(filamentProfiles.id, spools.profileId))
    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
    .all();

type Use = { printerId: string; slot: number | null; startedAt: string; spoolId: string };

/**
 * The spools each printer used, for `matchSpool` to tell spools of one colour apart. `add` a spool
 * picked during the run, so a later print in the same batch follows it.
 */
export function spoolHistory(db: Db) {
  const used = db
    .select({
      printerId: prints.printerId,
      slot: printFilamentUsages.slot,
      startedAt: prints.startedAt,
      spoolId: printFilamentUsages.spoolId,
    })
    .from(printFilamentUsages)
    .innerJoin(prints, eq(prints.id, printFilamentUsages.printId))
    .where(isNotNull(printFilamentUsages.spoolId))
    .all() as Use[];
  return {
    add: (u: Use) => used.push(u),
    /** The spools `printerId` used before `startedAt`: same AMS slot first, then any; newest first. */
    before(printerId: string | undefined, slot: number | null | undefined, startedAt: string) {
      // ponytail: a scan per slot; index by printer if the history ever gets slow.
      const mine = used
        .filter((u) => u.printerId === printerId && u.startedAt < startedAt)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return [...mine.filter((u) => slot != null && u.slot === slot), ...mine].map(
        (u) => u.spoolId,
      );
    },
  };
}

/**
 * A vendor's print history, minus the prints already imported, in the prints import columns.
 * A slot names the one spool `matchSpool` finds; one it can't decide stays empty, which holds the
 * print for a person. The source key is `<integrationId>:<externalId>`.
 */
export function printRows(db: Db, integrationId: string, items: ExternalPrint[]): StoredRow[] {
  const mine = and(eq(printers.integrationId, integrationId), isNotNull(printers.externalId));
  const printerOf = new Map(
    db
      .select({ externalId: printers.externalId, id: printers.id, label: printerLabel })
      .from(printers)
      .where(mine)
      .all()
      .map((p) => [p.externalId, p]),
  );
  const known = new Set(
    db
      .select({ externalId: prints.externalId })
      .from(prints)
      .where(eq(prints.integrationId, integrationId))
      .all()
      .map((p) => p.externalId),
  );
  const active = activeSpools(db);
  const byId = new Map(active.map((s) => [s.id, s]));
  const history = spoolHistory(db);
  // What each spool still holds once the rows before take theirs: a booking can't overdraw it.
  const left = new Map(active.map((s) => [s.id, s.remainingGrams]));
  const pick = (f: ExternalPrint["filaments"][number], startedAt: string, printerId?: string) => {
    const recent = history.before(printerId, f.slot, startedAt);
    const spool = byId.get(matchSpool({ ...f, startedAt }, active, recent) ?? "");
    if (!spool) return null;
    if (!predates(startedAt, spool)) {
      const after = (left.get(spool.id) ?? 0) - f.grams;
      if (after < 0) return null;
      left.set(spool.id, after);
    }
    if (printerId) history.add({ printerId, slot: f.slot ?? null, startedAt, spoolId: spool.id });
    return spool.label;
  };
  const fresh = items.filter((p) => !known.has(p.externalId));
  // Oldest first, so a print follows the spools picked for the ones before it.
  const picked = new Map<string, (string | null)[]>();
  for (const p of [...fresh].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const printerId = printerOf.get(p.printerExternalId)?.id;
    picked.set(
      p.externalId,
      p.filaments.slice(0, PRINT_MAX_SLOTS).map((f) => pick(f, p.startedAt, printerId)),
    );
  }
  return numbered(
    fresh.map(({ filaments, ...p }) => {
      const slots: Record<string, unknown> = {};
      for (const [i, f] of filaments.slice(0, PRINT_MAX_SLOTS).entries()) {
        const key = printSlotKeys(i + 1);
        slots[key.spool] = picked.get(p.externalId)?.[i] ?? null;
        // Shown in the review only; the slot keeps what was reported in `reported`.
        slots[key.filament] = [f.material, f.colorHex].filter(Boolean).join(" ") || null;
        slots[key.grams] = f.grams;
      }
      return {
        source: `${integrationId}:${p.externalId}`,
        raw: {
          // An unknown printer leaves the cell to fail as "unresolved": sync printers first.
          printer: printerOf.get(p.printerExternalId)?.label ?? p.printerExternalId,
          title: p.title,
          startedAt: p.startedAt,
          durationSec: p.durationSec ?? null,
          outcome: p.outcome,
          failureReason: p.outcome === "success" ? null : (p.failureReason ?? null),
          ...slots,
          plate: p.plate ?? null,
          coverUrl: p.coverUrl ?? null,
          sourceUrl: p.sourceUrl ?? null,
          reported: filaments.slice(0, PRINT_MAX_SLOTS).map((f) => ({
            slot: f.slot ?? null,
            material: f.material,
            colorHex: f.colorHex,
          })),
        },
      };
    }),
  );
}

/** A vendor's spools. `spoolId` is already `<adapterId>:<id>`. */
export function spoolRows(db: Db, items: LibrarySpool[]): StoredRow[] {
  const imported = new Set(
    db
      .select({ s: spools.sourceSpool })
      .from(spools)
      .where(isNotNull(spools.sourceSpool))
      .all()
      .map((r) => r.s),
  );
  const linked = spoolImport.bySource(db);
  const yours = new Map(spoolImport.targets(db).map((t) => [t.id, t.values]));
  return numbered(
    items
      // A spool you imported and then archived doesn't come back.
      .filter((s) => linked.has(s.spoolId) || !imported.has(s.spoolId))
      .map(({ spoolId, profile, ...s }) => {
        // A spool you have keeps its own filament: the vendor's name for it is not a difference.
        const mine = yours.get(linked.get(spoolId) ?? "");
        const filament = mine
          ? { brand: mine.brand, material: mine.material, profile: mine.profile }
          : { brand: profile.brand, material: profile.material, profile: profile.name };
        return { source: spoolId, raw: { ...filament, ...s } };
      }),
  );
}
