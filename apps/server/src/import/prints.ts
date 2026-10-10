import {
  type ImportCell,
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  lower,
  matchPrintRows,
  type PrintInput,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";
import { energyFor, syncUsages } from "../lib/prints.ts";
import { spoolImport, spoolLabels } from "./spools.ts";

const { filamentProfiles, printFilamentUsages, printers, prints } = schema;

const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
/** The start time the way the file column keeps it: UTC, to the second. */
const second = (iso: string) => `${new Date(iso).toISOString().slice(0, 19)}Z`;

/** Ids by lowercase name, to resolve a name from the file to the one row it means. */
type Names = Map<string, string[]>;
const group = (pairs: (readonly [string, string])[]): Names => {
  const map: Names = new Map();
  for (const [name, id] of pairs) map.set(lower(name), [...(map.get(lower(name)) ?? []), id]);
  return map;
};
/** The row a name means; null when it means none or several. */
const one = (names: Names, name: ImportCell | undefined) => {
  const ids = names.get(lower(name));
  return ids?.length === 1 ? (ids[0] ?? null) : null;
};

type Lookups = { printers: Names; spools: Names; profiles: Names };
function build(db: Db): Lookups {
  const all = db
    .select({ id: printers.id, name: printers.name, archivedAt: printers.archivedAt })
    .from(printers)
    .all();
  // An archived printer only answers to a name no active one has.
  const named = group(all.filter((p) => !p.archivedAt).map((p) => [p.name, p.id] as const));
  for (const p of all)
    if (p.archivedAt && !named.has(lower(p.name))) named.set(lower(p.name), [p.id]);
  return {
    printers: named,
    spools: group(spoolImport.targets(db).map((s) => [s.label, s.id] as const)),
    profiles: group(
      db
        .select({ id: filamentProfiles.id, name: filamentProfiles.name })
        .from(filamentProfiles)
        .where(isNull(filamentProfiles.archivedAt))
        .all()
        .map((p) => [p.name, p.id] as const),
    ),
  };
}

// A preview or an apply runs in one synchronous stretch, so the lookups are built once for it
// and dropped before anything else can change the data.
let cached: { db: Db; look: Lookups } | null = null;
function lookups(db: Db): Lookups {
  if (cached?.db !== db) {
    cached = { db, look: build(db) };
    queueMicrotask(() => {
      cached = null;
    });
  }
  return cached.look;
}

/**
 * Books the print's filament from the file row. A spool the name points to takes the grams
 * through the ledger; a spool or filament that doesn't resolve leaves the grams in the review
 * queue (Step 13) for the user to assign.
 */
function useFilament(db: Db, printId: string, title: string, v: ImportValues) {
  const look = lookups(db);
  const grams = num(v.grams);
  const spoolId = one(look.spools, v.spool);
  db.delete(printFilamentUsages)
    .where(and(eq(printFilamentUsages.printId, printId), isNull(printFilamentUsages.spoolId)))
    .run();
  if (spoolId && grams && grams > 0) return syncUsages(db, printId, title, [{ spoolId, grams }]);
  syncUsages(db, printId, title, []);
  if (grams && grams > 0 && (v.spool || v.filament))
    db.insert(printFilamentUsages)
      .values({
        printId,
        spoolId: null,
        profileId: one(look.profiles, v.filament),
        grams,
        material: str(v.filament) ?? str(v.spool),
      })
      .run();
}

/** Prints from a file. The printer must exist; spool and filament can be assigned later. */
export const printImport = {
  /** Every print, in the shape of the import columns. */
  targets(db: Db): ImportTarget[] {
    const usages = new Map<string, (typeof printFilamentUsages.$inferSelect)[]>();
    for (const u of db.select().from(printFilamentUsages).all())
      usages.set(u.printId, [...(usages.get(u.printId) ?? []), u]);
    const spools = spoolLabels(db);
    const profiles = new Map(
      db
        .select({ id: filamentProfiles.id, name: filamentProfiles.name })
        .from(filamentProfiles)
        .all()
        .map((p) => [p.id, p.name]),
    );
    return db
      .select({ print: prints, printer: printers.name })
      .from(prints)
      .innerJoin(printers, eq(printers.id, prints.printerId))
      .all()
      .map(({ print: p, printer }) => {
        // A print with several filament slots shows none: the file has one filament per row.
        const [only, more] = usages.get(p.id) ?? [];
        const u = more ? undefined : only;
        return {
          id: p.id,
          label: p.title,
          values: {
            printer,
            title: p.title,
            startedAt: second(p.startedAt),
            durationSec: p.durationSec,
            outcome: p.outcome,
            failureReason: p.failureReason,
            notes: p.notes,
            spool: (u?.spoolId && spools.get(u.spoolId)) || null,
            filament: (u?.profileId && profiles.get(u.profileId)) || null,
            grams: u?.grams ?? null,
          },
        };
      });
  },

  match: matchPrintRows,

  refs: (db: Db) => ({
    printers: db
      .select({ name: printers.name })
      .from(printers)
      .where(isNull(printers.archivedAt))
      .orderBy(printers.name)
      .all()
      .map((p) => p.name),
    spools: [...new Set(spoolImport.targets(db).map((s) => s.label))].sort(),
    filamentProfiles: spoolImport.refs(db).filamentProfiles,
  }),

  /** Nothing is created on the way: a print needs a printer that exists. */
  missing: (): Record<string, string[]> => ({}),

  /** What a file row needs besides valid cells. */
  check(db: Db, v: ImportValues) {
    const errors: { column: string; code: ImportErrorCode }[] = [];
    if (!one(lookups(db).printers, v.printer))
      errors.push({ column: "printer", code: "unresolved" });
    // Filament named without grams (or the reverse) is a typo, not data.
    if ((v.spool || v.filament) && v.grams == null)
      errors.push({ column: "grams", code: "required" });
    return errors;
  },

  create(db: Db, v: ImportValues) {
    const printerId = one(lookups(db).printers, v.printer) ?? "";
    const durationSec = num(v.durationSec);
    const outcome = str(v.outcome) as PrintInput["outcome"];
    const row = db
      .insert(prints)
      .values({
        printerId,
        title: str(v.title) ?? "",
        startedAt: new Date(str(v.startedAt) ?? "").toISOString(),
        durationSec,
        outcome,
        failureReason: outcome === "success" ? null : str(v.failureReason),
        notes: str(v.notes),
        ...energyFor(db, printerId, durationSec, null),
      })
      .returning()
      .get();
    useFilament(db, row.id, row.title, v);
  },

  /** Writes `patch` (only the values that change) to the print. */
  update(db: Db, target: ImportTarget, patch: ImportValues) {
    const { printer, startedAt, spool, filament, grams, ...fields } = patch;
    const cur = db.select().from(prints).where(eq(prints.id, target.id)).get();
    if (!cur) return;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    const printerId = printer === undefined ? cur.printerId : one(lookups(db).printers, printer);
    if (printer !== undefined) set.printerId = printerId;
    if (startedAt != null) set.startedAt = new Date(String(startedAt)).toISOString();
    if ((patch.outcome ?? cur.outcome) === "success") set.failureReason = null;
    // An estimate follows the printer and the duration; a measured value stays.
    if (cur.energySource !== "measured" && (printer !== undefined || "durationSec" in patch))
      Object.assign(
        set,
        energyFor(
          db,
          printerId ?? cur.printerId,
          "durationSec" in patch ? num(patch.durationSec) : cur.durationSec,
          null,
        ),
      );
    if (Object.keys(set).length) db.update(prints).set(set).where(eq(prints.id, cur.id)).run();

    // ponytail: a print with several filament slots keeps them; the file has one per row.
    const slots = db
      .select()
      .from(printFilamentUsages)
      .where(eq(printFilamentUsages.printId, cur.id))
      .all();
    if ([spool, filament, grams].some((x) => x !== undefined) && slots.length <= 1)
      useFilament(db, cur.id, String(set.title ?? cur.title), { ...target.values, ...patch });
  },
};
