import {
  type ExternalPrint,
  type ExternalPrinter,
  type FilamentLibrary,
  type LibrarySpool,
  matchPrint,
  type NewSpoolField,
  PRINT_MAX_SLOTS,
  printSlotKeys,
  type SLICER_ZIP_TYPES,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { StoredRow } from "../import/review.ts";
import { spoolImport } from "../import/spools.ts";
import { printerLabel, profileMaterial, spoolName } from "../lib/catalog.ts";
import { catalogName, profileKey, spoolProfiles } from "./imports.ts";

const { brands, filamentProfiles, printerModels, printers, printFilamentUsages, prints, spools } =
  schema;

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

/**
 * What a slicer's folder offers for one type, built-in presets included: a sync imports them all,
 * whatever the type. Thumbnails are only offered when `dataDir` can take them.
 */
export async function libraryRows(
  lib: FilamentLibrary,
  dir: string,
  type: LibraryType,
  opts: { dataDir: string },
): Promise<StoredRow[]> {
  if (type === "filamentBrands" || type === "filamentMaterials") {
    // Filament vendors -> filament brands, filament types -> materials, from the filament presets.
    const presets = await lib.read(dir, { includeSystem: true });
    const key = type === "filamentBrands" ? "brand" : "material";
    return numbered(names(presets.map((p) => p[key])).map((name) => ({ raw: { name } })));
  }
  if (type === "filamentProfiles")
    // A profile you archived comes back as a skip (`filamentProfileImport.archived`).
    return numbered(
      (await lib.read(dir, { includeSystem: true })).map((preset) => {
        const { presetId, scope: _scope, pricePerKg, ...p } = preset;
        // The price column is typed in major units, like a file's.
        const price = pricePerKg === null ? null : pricePerKg / 100;
        return { source: `${lib.id}:${presetId}`, raw: { ...p, pricePerKg: price } };
      }),
    );
  const c = (await lib.readCatalog?.(dir)) ?? { models: [], machines: [], processes: [] };
  if (type === "printProfiles")
    return numbered(
      c.processes.map(({ presetId, scope: _scope, ...raw }) => ({
        source: `${lib.id}:${presetId}`,
        raw,
      })),
    );
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
      number: spools.number,
      profileId: spools.profileId,
      material: profileMaterial,
      colorHex: spools.colorHex,
      status: spools.status,
      purchasedAt: spools.purchasedAt,
      openedAt: spools.openedAt,
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
 * A vendor's print history in the prints import columns, the prints already imported included
 * (the review skips them; a person may update one). A new print's slot names the spool
 * `matchPrint` picks; one picked from several is listed in `unsure`, and one with no spool stays
 * empty. Either holds the print for a person. The source key is `<integrationId>:<externalId>`.
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
  // Copies: `remainingGrams` becomes what each spool still holds once the rows before take theirs,
  // so a booking can't overdraw it.
  const active = activeSpools(db).map((s) => ({ ...s }));
  const byId = new Map(active.map((s) => [s.id, s]));
  const history = spoolHistory(db);
  const fresh = items.filter((p) => !known.has(p.externalId));
  // Oldest first, so a print follows the spools picked for the ones before it.
  const picked = new Map<string, { label: string | null; sure: boolean }[]>();
  for (const p of [...fresh].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const printerId = printerOf.get(p.printerExternalId)?.id;
    const slots = p.filaments
      .slice(0, PRINT_MAX_SLOTS)
      .map((f) => ({ ...f, startedAt: p.startedAt }));
    const matches = matchPrint(slots, active, (slot) =>
      history.before(printerId, slot, p.startedAt),
    );
    picked.set(
      p.externalId,
      matches.map((m, i) => {
        const spool = byId.get(m.id ?? "");
        const f = slots[i];
        if (!spool || !f) return { label: null, sure: false };
        if (spool.remainingGrams != null) spool.remainingGrams -= f.grams;
        if (printerId)
          history.add({
            printerId,
            slot: f.slot ?? null,
            startedAt: p.startedAt,
            spoolId: spool.id,
          });
        return { label: spool.label, sure: m.sure };
      }),
    );
  }
  return numbered(
    items.map(({ filaments, ...p }) => {
      const slots: Record<string, unknown> = {};
      // Slots picked from several spools: shown for a person to check, and held by an auto run.
      const unsure: string[] = [];
      // A print you have keeps its filament: its slots are left out, so an update never rebooks them.
      const own = known.has(p.externalId) ? [] : filaments;
      for (const [i, f] of own.slice(0, PRINT_MAX_SLOTS).entries()) {
        const key = printSlotKeys(i + 1);
        const pick = picked.get(p.externalId)?.[i];
        slots[key.spool] = pick?.label ?? null;
        if (pick?.label && !pick.sure) unsure.push(key.spool);
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
          sourceUrl: p.sourceUrl ?? null,
          reported: own.slice(0, PRINT_MAX_SLOTS).map((f) => ({
            slot: f.slot ?? null,
            material: f.material,
            colorHex: f.colorHex,
          })),
          ...(unsure.length && { unsure }),
        },
      };
    }),
  );
}

/**
 * A vendor's printers. The source key is `<integrationId>:<externalId>`. The model is spelled
 * like the catalog's ("A1" -> "Bambu Lab A1"), so it lands on the model you have.
 */
export function printerRows(db: Db, integrationId: string, items: ExternalPrinter[]): StoredRow[] {
  const models = db
    .select({ brand: brands.name, model: printerModels.model })
    .from(printerModels)
    .innerJoin(brands, eq(brands.id, printerModels.brandId))
    .all();
  const of = (brand: string) =>
    models.filter((m) => m.brand.toLowerCase() === brand.toLowerCase()).map((m) => m.model);
  return numbered(
    items.map((p) => ({
      source: `${integrationId}:${p.externalId}`,
      raw: {
        name: p.name,
        brand: p.brand,
        model: p.model ? catalogName(p.model, of(p.brand)) : null,
        serial: p.serial ?? null,
        nozzleDiameterMm: p.nozzleDiameterMm ?? null,
      },
    })),
  );
}

/** What a sync does with a spool it brings in for the first time (the spools policy). */
export type NewSpools = { newWeight: NewSpoolField; newOpenedAt: NewSpoolField };

/**
 * A vendor's spools. `spoolId` is already `<adapterId>:<id>`. A new one's profile is spelled like
 * the catalog's ("PLA Basic" -> "Bambu PLA Basic"); its weight and open date follow `policy`.
 */
export function spoolRows(
  db: Db,
  items: LibrarySpool[],
  policy: NewSpools = { newWeight: "import", newOpenedAt: "unset" },
  today = new Date().toISOString().slice(0, 10),
): StoredRow[] {
  // A spool you archived counts as yours too: it comes back as a skip (`spoolImport.archived`).
  const gone = spoolImport.archived(db);
  const linked = spoolImport.bySource(db);
  const yours = new Map([...spoolImport.targets(db), ...gone.targets].map((t) => [t.id, t.values]));
  const profiles = spoolProfiles(db).active;
  const profileName = (p: LibrarySpool["profile"]) =>
    catalogName(
      p.name,
      profiles
        .filter((x) => profileKey({ ...x, name: "" }) === profileKey({ ...p, name: "" }))
        .map((x) => x.name),
    );
  return numbered(
    items.map(({ spoolId, profile, ...s }) => {
      // A spool you have keeps its own filament: the vendor's name for it is not a difference.
      const mine = yours.get(linked.get(spoolId) ?? gone.of(spoolId) ?? "");
      const filament = mine
        ? { brand: mine.brand, material: mine.material, profile: mine.profile }
        : { brand: profile.brand, material: profile.material, profile: profileName(profile) };
      const { remainingGrams, initialGrams, ...rest } = s;
      // Without "Track usage" the review leaves a spool you have its weight (`USAGE_KEYS`).
      if (mine)
        return { source: spoolId, raw: { ...filament, ...rest, initialGrams, remainingGrams } };
      const weight = policy.newWeight === "unset" ? {} : { initialGrams, remainingGrams };
      // Only a spool in use was opened; a sealed one has no open date to guess.
      const opened =
        policy.newOpenedAt === "import" && s.status === "in_use" ? { openedAt: today } : {};
      // "Let me review": an auto run leaves the spool for a person to fill in.
      const hold = policy.newWeight === "review" || policy.newOpenedAt === "review";
      return {
        source: spoolId,
        raw: { ...filament, ...rest, ...weight, ...opened, ...(hold && { hold: true }) },
      };
    }),
  );
}
