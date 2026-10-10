import type { FilamentLibrary, LibrarySpool, SLICER_ZIP_TYPES } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { isNotNull } from "drizzle-orm";
import type { StoredRow } from "../import/review.ts";
import { spoolImport } from "../import/spools.ts";
import { profileColumns } from "../lib/catalog.ts";
import { profileKey } from "./imports.ts";

const { filamentProfiles, spools } = schema;

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
