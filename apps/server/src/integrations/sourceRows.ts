import {
  type ExternalPrint,
  type ExternalPrinter,
  type FilamentLibrary,
  type LibrarySpool,
  matchPrint,
  type NewSpoolField,
  PRINT_MAX_SLOTS,
  printSlotKeys,
  type ReviewPolicy,
  reviewPolicyOf,
  type SLICER_ZIP_TYPES,
  samePrint,
  slotOutcome,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { StoredRow } from "../import/review.ts";
import { spoolImport } from "../import/spools.ts";
import { presetName, presetNames, printerLabel, spoolMaterial, spoolName } from "../lib/catalog.ts";
import { readPreferences } from "../lib/preferences.ts";
import { catalogName } from "./imports.ts";
import { printersOfSource } from "./printerSources.ts";

const { brands, printerModels, printers, printFilamentUsages, prints, spools } = schema;

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
 * What a slicer's folder offers for one type: a sync imports it all, whatever the type. `scope`
 * picks the system presets, the user presets or (left out) both. Thumbnails are only offered when
 * `dataDir` can take them. Vendor models carry no scope: they are system.
 */
export async function libraryRows(
  lib: FilamentLibrary,
  dir: string,
  type: LibraryType,
  opts: { dataDir: string; scope?: "system" | "user" },
): Promise<StoredRow[]> {
  const want = <T extends { scope: string }>(items: T[]) =>
    opts.scope ? items.filter((i) => i.scope === opts.scope) : items;
  const system = opts.scope !== "user";
  if (type === "filamentBrands" || type === "filamentMaterials") {
    // Filament vendors -> filament brands, filament types -> materials, from the filament presets.
    const presets = want(await lib.read(dir, { includeSystem: system }));
    const key = type === "filamentBrands" ? "brand" : "material";
    return numbered(names(presets.map((p) => p[key])).map((name) => ({ raw: { name } })));
  }
  if (type === "filamentPresets")
    // A preset you archived comes back as a skip (`filamentPresetImport.archived`).
    return numbered(
      want(await lib.read(dir, { includeSystem: system })).map((preset) => {
        const { presetId, scope: _scope, ...p } = preset;
        return {
          source: `${lib.id}:${presetId}`,
          // No material: its parent can't be read, so a person fills it in (ADR-0019).
          raw: { ...p, ...(!p.material && { hold: true }) },
        };
      }),
    );
  const read = (await lib.readCatalog?.(dir)) ?? { models: [], machines: [], processes: [] };
  const c = {
    models: system ? read.models : [],
    machines: want(read.machines),
    processes: want(read.processes),
  };
  // Presets a preset names keep their keys (`machinePresets`, `defaultProcessPreset`); the review
  // shows and compares their names.
  const key = (presetId: string) => `${lib.id}:${presetId}`;
  if (type === "processPresets")
    return numbered(
      c.processes.map(({ presetId, scope: _scope, machines, ...raw }) => ({
        source: key(presetId),
        raw: { ...raw, printers: presetNames(machines), machinePresets: machines.map(key) },
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
    c.machines.map(({ presetId, scope: _scope, defaultProcessPreset: process, ...raw }) => ({
      source: key(presetId),
      raw: {
        ...raw,
        defaultProcessPresetName: process && presetName(process),
        defaultProcessPreset: process && key(process),
        ...(!raw.brand && { hold: true }),
      },
    })),
  );
}

/** The spools an imported print's filament can be matched to (`matchSpool`). */
export const activeSpools = (db: Db) =>
  db
    .select({
      id: spools.id,
      number: spools.number,
      material: spoolMaterial,
      colorHex: spools.colorHex,
      status: spools.status,
      purchasedAt: spools.purchasedAt,
      openedAt: spools.openedAt,
      createdAt: spools.createdAt,
      initialGrams: spools.initialGrams,
      remainingGrams: spools.remainingGrams,
      rfid: spools.rfid,
      label: spoolName,
    })
    .from(spools)
    .where(and(isNull(spools.archivedAt), ne(spools.status, "empty")))
    .all();

/**
 * The spool loaded in a printer slot for a print, for `matchPrint`: loaded before the print ended,
 * so an older print synced later isn't charged to it, and one running while you set it is.
 */
export function loadedSpools(db: Db) {
  const rows = db
    .select({
      id: spools.id,
      printerId: spools.loadedPrinterId,
      slot: spools.loadedSlot,
      at: spools.loadedAt,
    })
    .from(spools)
    .where(isNotNull(spools.loadedPrinterId))
    .all();
  return (printerId: string | undefined, startedAt: string, durationSec?: number | null) => {
    const end = Date.parse(startedAt) + (durationSec ?? 0) * 1000;
    return (slot: number | null | undefined) =>
      rows.find(
        (r) => r.printerId === printerId && r.slot === slot && !!r.at && Date.parse(r.at) <= end,
      )?.id;
  };
}

/**
 * The review level of a printer's automatic prints from one source (ADR-0015): the printer's own,
 * else the source's (`source`, from its prints settings: `Syncer`'s `printsPolicy`), else the
 * global one.
 */
export function reviewLevels(db: Db, source: ReviewPolicy | null) {
  const global = readPreferences(db).printReview;
  const own = new Map(
    db
      .select({ id: printers.id, level: printers.reviewPolicy })
      .from(printers)
      .all()
      .map((p) => [p.id, p.level]),
  );
  return (printerId: string | null | undefined) =>
    reviewPolicyOf({ printer: own.get(printerId ?? ""), source, global });
}

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
 *
 * With `levels` the prints are automatic (a run nobody reviews, the job tracker): each new slot
 * follows its review level (`slotOutcome`). Only a spool to charge is named; a slot that waits or
 * isn't tracked says so in `reported`, and nothing is `unsure`.
 */
export function printRows(
  db: Db,
  integrationId: string,
  items: ExternalPrint[],
  levels?: ReturnType<typeof reviewLevels>,
): StoredRow[] {
  // Its own printers and those it is linked to by serial (`linkSourcePrinters`).
  const ids = printersOfSource(db, integrationId);
  const labels = new Map(
    db
      .select({ id: printers.id, label: printerLabel })
      .from(printers)
      .where(inArray(printers.id, [...new Set(ids.values())]))
      .all()
      .map((p) => [p.id, p.label]),
  );
  const printerOf = new Map(
    [...ids].map(([ext, id]) => [ext, { id, label: labels.get(id) ?? ext }] as const),
  );
  const known = new Set(
    db
      .select({ externalId: prints.externalId })
      .from(prints)
      .where(eq(prints.integrationId, integrationId))
      .all()
      .map((p) => p.externalId),
  );
  // The same print from the printer's other source (ADR-0015): it is there already, so it is
  // neither new nor an update. By the id either names, else by a start within a minute.
  const others = db
    .select({
      printerId: prints.printerId,
      externalId: prints.externalId,
      startedAt: prints.startedAt,
      peerId: prints.peerId,
    })
    .from(prints)
    .where(
      and(
        inArray(prints.printerId, [...new Set(ids.values())]),
        ne(prints.integrationId, integrationId),
        isNotNull(prints.integrationId),
      ),
    )
    .all();
  const twin = (p: ExternalPrint) => {
    const printerId = printerOf.get(p.printerExternalId)?.id;
    return (
      !!printerId &&
      !known.has(p.externalId) &&
      !!samePrint(
        p,
        others.filter((o) => o.printerId === printerId),
      )
    );
  };
  const offered = items.filter((p) => !twin(p));
  // Copies: `remainingGrams` becomes what each spool still holds once the rows before take theirs,
  // so a booking can't overdraw it.
  const active = activeSpools(db).map((s) => ({ ...s }));
  const byId = new Map(active.map((s) => [s.id, s]));
  const history = spoolHistory(db);
  const loaded = loadedSpools(db);
  const fresh = offered.filter((p) => !known.has(p.externalId));
  // Oldest first, so a print follows the spools picked for the ones before it.
  type Picked = {
    label: string | null;
    sure: boolean;
    /** An automatic slot that isn't charged: what it waits with, or that it isn't tracked. */
    held?: { suggestedSpoolId: string | null; dismissed: boolean };
  };
  const picked = new Map<string, Picked[]>();
  for (const p of [...fresh].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const printerId = printerOf.get(p.printerExternalId)?.id;
    const slots = p.filaments
      .slice(0, PRINT_MAX_SLOTS)
      .map((f) => ({ ...f, grams: f.grams ?? 0, startedAt: p.startedAt, rfid: f.rfid }));
    const matches = matchPrint(
      slots,
      active,
      (slot) => history.before(printerId, slot, p.startedAt),
      loaded(printerId, p.startedAt, p.durationSec),
    );
    picked.set(
      p.externalId,
      matches.map((m, i): Picked => {
        const spool = byId.get(m.id ?? "");
        const f = slots[i];
        if (!f) return { label: null, sure: false };
        const outcome =
          levels &&
          slotOutcome(levels(printerId), {
            spoolId: spool?.id ?? null,
            sure: m.sure,
            grams: p.filaments[i]?.grams == null ? "none" : f.gramsEstimated ? "estimated" : "real",
          });
        const held =
          outcome && outcome.action !== "charge"
            ? {
                suggestedSpoolId: outcome.action === "wait" ? outcome.suggestedSpoolId : null,
                dismissed: outcome.action === "dismiss",
              }
            : undefined;
        // Not tracked: it takes nothing from the spool, now or in the prints that follow.
        if (!spool || held?.dismissed) return { label: null, sure: false, held };
        // A suggestion counts like a pick here: later prints see what it would leave.
        if (spool.remainingGrams != null) spool.remainingGrams -= f.grams;
        if (printerId)
          history.add({
            printerId,
            slot: f.slot ?? null,
            startedAt: p.startedAt,
            spoolId: spool.id,
          });
        return held ? { label: null, sure: false, held } : { label: spool.label, sure: m.sure };
      }),
    );
  }
  return numbered(
    offered.map(({ filaments, ...p }) => {
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
        // No grams (the job file and the plate had none either): counts as 0.
        slots[key.grams] = f.grams ?? 0;
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
          ...(p.peerId && { peerId: p.peerId }),
          reported: own.slice(0, PRINT_MAX_SLOTS).map((f, i) => ({
            slot: f.slot ?? null,
            material: f.material,
            colorHex: f.colorHex,
            ...(f.rfid && { rfid: f.rfid }),
            gramsSource: f.grams == null ? null : (f.gramsSource ?? "printer"),
            gramsEstimated: f.gramsEstimated ?? false,
            ...picked.get(p.externalId)?.[i]?.held,
          })),
          ...(unsure.length && { unsure }),
          // Nobody chose "no project" for it (`printImport.create`).
          ...(levels && { automatic: true }),
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
 * A vendor's spools. `spoolId` is already `<adapterId>:<id>`. A new one takes the vendor's
 * brand, material and name; its weight and open date follow `policy`.
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
  return numbered(
    items.map(({ spoolId, filament: f, ...s }) => {
      // A spool you have keeps its own filament: the vendor's name for it is not a difference.
      const mine = yours.get(linked.get(spoolId) ?? gone.of(spoolId) ?? "");
      const filament = mine
        ? { brand: mine.brand, material: mine.material, name: mine.name }
        : { brand: f.brand, material: f.material, name: f.name };
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
