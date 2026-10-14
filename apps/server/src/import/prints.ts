import {
  type ImportCell,
  type ImportErrorCode,
  type ImportTarget,
  type ImportValues,
  lower,
  matchPrintRows,
  PRINT_MAX_SLOTS,
  type PrintInput,
  printSlotKeys,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNull } from "drizzle-orm";
import { printerLabel, projectLabel } from "../lib/catalog.ts";
import {
  assertNumberFree,
  freeNumber,
  nextNumber,
  numberCell,
  printerTitle,
  printTitle,
} from "../lib/numbers.ts";
import { energyFor, syncUsages } from "../lib/prints.ts";
import { parseFolderName } from "../projects/folderName.ts";
import type { WriteRow } from "./review.ts";
import { spoolImport, spoolLabels } from "./spools.ts";

const { filamentProfiles, printFilamentUsages, printers, prints, projects } = schema;

const num = (c: ImportCell | undefined) => (typeof c === "number" ? c : null);
const str = (c: ImportCell | undefined) => (typeof c === "string" ? c : null);
/** The start time the way the file column keeps it: UTC, to the second. */
const second = (iso: string) => `${new Date(iso).toISOString().slice(0, 19)}Z`;

/** Ids by lowercase name, to resolve a name from the file to the one row it means. */
type Names = Map<string, string[]>;
const group = (pairs: (readonly [string, string])[]): Names => {
  const map: Names = new Map();
  for (const [name, id] of pairs) {
    const ids = map.get(lower(name)) ?? [];
    // The same row under two of its own keys (name "3", number 3) is still one row.
    if (!ids.includes(id)) map.set(lower(name), [...ids, id]);
  }
  return map;
};
/** The row a name means; null when it means none or several. */
const one = (names: Names, name: ImportCell | undefined) => {
  const ids = names.get(lower(name));
  return ids?.length === 1 ? (ids[0] ?? null) : null;
};

/**
 * Ids by every key a row answers to: its display name, its number alone and its plain name.
 * An archived row only answers to keys no active one has.
 */
const answering = (rows: { id: string; keys: string[]; archivedAt: string | null }[]) => {
  const named = group(
    rows.filter((r) => !r.archivedAt).flatMap((r) => r.keys.map((k) => [k, r.id] as const)),
  );
  for (const r of rows)
    if (r.archivedAt) for (const k of r.keys) if (!named.has(lower(k))) named.set(lower(k), [r.id]);
  return named;
};

type Lookups = { printers: Names; projects: Names; spools: Names; profiles: Names };
function build(db: Db): Lookups {
  const printerRows = db
    .select({
      id: printers.id,
      number: printers.number,
      name: printers.name,
      archivedAt: printers.archivedAt,
    })
    .from(printers)
    .all();
  const projectRows = db
    .select({
      id: projects.id,
      number: projects.number,
      name: projects.name,
      label: projectLabel,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .all();
  return {
    printers: answering(
      printerRows.map((p) => ({ ...p, keys: [printerTitle(p), String(p.number), p.name] })),
    ),
    projects: answering(
      projectRows.map((p) => ({ ...p, keys: [p.label, String(p.number), p.name] })),
    ),
    // A spool answers to its display name or to its number alone.
    spools: group(
      spoolImport
        .targets(db)
        .flatMap((s) => [[s.label, s.id] as const, [String(s.values.number), s.id] as const]),
    ),
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

const cellText = (c: ImportCell | undefined) => (c == null ? "" : String(c).trim());

/**
 * The project a cell names, null for an empty cell. One that doesn't exist yet is created without
 * a folder: "5-bucket" is project 5 (if free) "bucket", "Benchy" gets the next free number.
 */
function projectFor(db: Db, cell: ImportCell | undefined): string | null {
  const text = cellText(cell);
  if (!text) return null;
  const look = lookups(db).projects;
  const known = look.get(lower(text));
  if (known) return known.length === 1 ? (known[0] ?? null) : null;
  const { number, name } = parseFolderName(text);
  const id = db
    .insert(projects)
    .values({
      number: freeNumber(db, projects, number || null) ?? nextNumber(projects),
      name,
      editedFields: ["name"],
    })
    .returning({ id: projects.id })
    .get().id;
  // Later rows of the same file naming it get this one, not another.
  look.set(lower(text), [id]);
  return id;
}

/**
 * Books the print's filament from the file row. A spool the name points to takes the grams
 * through the ledger; a spool or filament that doesn't resolve leaves the grams in the review
 * queue (Step 13) for the user to assign.
 */
function useFilament(db: Db, printId: string, title: string, v: ImportValues) {
  const look = lookups(db);
  db.delete(printFilamentUsages)
    .where(and(eq(printFilamentUsages.printId, printId), isNull(printFilamentUsages.spoolId)))
    .run();
  const booked: { spoolId: string; grams: number }[] = [];
  const waiting: (typeof printFilamentUsages.$inferInsert)[] = [];
  for (let n = 1; n <= PRINT_MAX_SLOTS; n++) {
    const key = printSlotKeys(n);
    const grams = num(v[key.grams]);
    if (!grams || grams <= 0) continue;
    const spoolId = one(look.spools, v[key.spool]);
    if (spoolId) booked.push({ spoolId, grams });
    else if (v[key.spool] || v[key.filament])
      waiting.push({
        printId,
        spoolId: null,
        profileId: one(look.profiles, v[key.filament]),
        grams,
        material: str(v[key.filament]) ?? str(v[key.spool]),
      });
  }
  // "no": the spools are already up to date, so only the print's own rows are written.
  syncUsages(db, printId, title, booked, lower(v.trackUsage) !== "no");
  if (waiting.length) db.insert(printFilamentUsages).values(waiting).run();
}

const SLOT_KEYS = Array.from({ length: PRINT_MAX_SLOTS }, (_, i) =>
  Object.values(printSlotKeys(i + 1)),
).flat();

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
      .select({ print: prints, printer: printers.name, project: projectLabel })
      .from(prints)
      .innerJoin(printers, eq(printers.id, prints.printerId))
      .leftJoin(projects, eq(projects.id, prints.projectId))
      .orderBy(prints.number)
      .all()
      .map(({ print: p, printer, project }) => {
        const slots: ImportValues = {};
        for (const [i, u] of (usages.get(p.id) ?? []).slice(0, PRINT_MAX_SLOTS).entries()) {
          const key = printSlotKeys(i + 1);
          slots[key.spool] = (u.spoolId && spools.get(u.spoolId)) || null;
          slots[key.filament] = (u.profileId && profiles.get(u.profileId)) || null;
          slots[key.grams] = u.grams;
        }
        return {
          id: p.id,
          label: printTitle(p),
          values: {
            number: p.number,
            printer,
            project,
            title: p.title,
            startedAt: second(p.startedAt),
            durationSec: p.durationSec,
            outcome: p.outcome,
            failureReason: p.failureReason,
            notes: p.notes,
            ...slots,
          },
        };
      });
  },

  match: matchPrintRows,

  refs: (db: Db) => ({
    projects: db
      .select({ name: projectLabel })
      .from(projects)
      .where(isNull(projects.archivedAt))
      .orderBy(projects.number)
      .all()
      .map((p) => p.name),
    printers: db
      .select({ name: printerLabel })
      .from(printers)
      .where(isNull(printers.archivedAt))
      .orderBy(printers.number)
      .all()
      .map((p) => p.name),
    // In number order, as the targets come.
    spools: spoolImport.targets(db).map((s) => s.label),
    filamentProfiles: spoolImport.refs(db).filamentProfiles,
  }),

  /** A print needs a printer that exists; a project it names is created when missing. */
  missing(db: Db, rows: ImportValues[]): Record<string, string[]> {
    const look = lookups(db).projects;
    const names = [
      ...new Map(
        rows
          .map((r) => cellText(r.project))
          .filter((n) => n && !look.has(lower(n)))
          .map((n) => [lower(n), n]),
      ).values(),
    ];
    return names.length ? { projects: names } : {};
  },

  /** What a file row needs besides valid cells. */
  check(db: Db, v: ImportValues) {
    const errors: { column: string; code: ImportErrorCode }[] = [];
    if (!one(lookups(db).printers, v.printer))
      errors.push({ column: "printer", code: "unresolved" });
    // A name several projects answer to can't be told apart (an unknown one is created).
    if ((lookups(db).projects.get(lower(cellText(v.project)))?.length ?? 0) > 1)
      errors.push({ column: "project", code: "unresolved" });
    // Filament named without grams (or the reverse) is a typo, not data.
    for (let n = 1; n <= PRINT_MAX_SLOTS; n++) {
      const key = printSlotKeys(n);
      if ((v[key.spool] || v[key.filament]) && v[key.grams] == null)
        errors.push({ column: key.grams, code: "required" });
    }
    return errors;
  },

  create(db: Db, v: ImportValues) {
    const printerId = one(lookups(db).printers, v.printer) ?? "";
    const durationSec = num(v.durationSec);
    const outcome = str(v.outcome) as PrintInput["outcome"];
    const row = db
      .insert(prints)
      .values({
        // A number another print has ("import as new" of an exported row) gets the next free one.
        number: freeNumber(db, prints, numberCell(v.number)) ?? nextNumber(prints),
        printerId,
        projectId: projectFor(db, v.project),
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
  update(db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) {
    const { printer, project, startedAt, ...rest } = patch;
    const fields = Object.fromEntries(Object.entries(rest).filter(([k]) => !SLOT_KEYS.includes(k)));
    const cur = db.select().from(prints).where(eq(prints.id, target.id)).get();
    if (!cur) return;
    // The other keys are named like the table's columns.
    const set: Record<string, unknown> = { ...fields };
    if ("number" in set) set.number = numberCell(fields.number) ?? undefined;
    assertNumberFree(db, prints, "print", numberCell(fields.number), cur.id);
    if (project !== undefined) set.projectId = projectFor(db, project);
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

    // The file's slots replace the print's; the target values fill the slots the file left empty.
    if (SLOT_KEYS.some((k) => k in patch))
      useFilament(db, cur.id, String(set.title ?? cur.title), {
        ...target.values,
        ...patch,
        trackUsage: String(row.raw.trackUsage ?? ""),
      });
  },
};
