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
  usableOn,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
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

const cellText = (c: ImportCell | undefined) => (c == null ? "" : String(c).trim());

/**
 * The plain number a cell starts with, padded or not: "001-x", "1-x", "01", "1 x" are all 1.
 * "3D Benchy" has none.
 */
export const leadingNumber = (c: ImportCell | undefined) => {
  const m = /^(\d+)(?:[\s._-]|$)/.exec(cellText(c));
  return m ? Number(m[1]) : null;
};

/** A row the file can name: by its number (the identity) or by a name; `labels` by id. */
type Ref = { numbers: Map<number, string>; names: Names; labels: Map<string, string> };
type RefRow = {
  id: string;
  number: number | null;
  /** The display name first, then other names it answers to. */
  keys: [string, ...string[]];
  archivedAt?: string | null;
};

/** An archived row only answers to names no active one has; numbers are unique anyway. */
function refOf(rows: RefRow[]): Ref {
  const names = group(
    rows.filter((r) => !r.archivedAt).flatMap((r) => r.keys.map((k) => [k, r.id] as const)),
  );
  for (const r of rows)
    if (r.archivedAt) for (const k of r.keys) if (!names.has(lower(k))) names.set(lower(k), [r.id]);
  const numbers = new Map(
    rows.flatMap((r) => (r.number == null ? [] : [[r.number, r.id] as const])),
  );
  return { numbers, names, labels: new Map(rows.map((r) => [r.id, r.keys[0]])) };
}

/**
 * The rows a cell can mean. A leading number that exists wins, whatever text follows it
 * ("1-Aquaterrario" is project 1 however it is spelled); otherwise the whole cell is a name.
 */
const candidates = (ref: Ref, c: ImportCell | undefined): string[] => {
  const n = leadingNumber(c);
  const byNumber = n == null ? undefined : ref.numbers.get(n);
  return byNumber ? [byNumber] : (ref.names.get(lower(c)) ?? []);
};
/** The row a cell means; null when it means none or several. */
const find = (ref: Ref, c: ImportCell | undefined) => {
  const ids = candidates(ref, c);
  return ids.length === 1 ? (ids[0] ?? null) : null;
};

type Lookups = {
  printers: Ref;
  projects: Ref;
  spools: Ref;
  /** Each spool's opening day, for `usableOn`. */
  opened: Map<string, string | null>;
  profiles: Names;
};
function build(db: Db): Lookups {
  const spoolRows = spoolImport.targets(db);
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
    printers: refOf(printerRows.map((p) => ({ ...p, keys: [printerTitle(p), p.name] }))),
    projects: refOf(projectRows.map((p) => ({ ...p, keys: [p.label, p.name] }))),
    // Active spools only, by number or display name.
    spools: refOf(
      spoolRows.map((s) => ({
        id: s.id,
        number: typeof s.values.number === "number" ? s.values.number : null,
        keys: [s.label],
      })),
    ),
    opened: new Map(spoolRows.map((s) => [s.id, str(s.values.openedAt)])),
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
 * The project a cell names, null for an empty cell. One that doesn't exist yet is created without
 * a folder: "5-bucket" is project 5 (if free) "bucket", "Benchy" gets the next free number.
 */
function projectFor(db: Db, cell: ImportCell | undefined): string | null {
  const text = cellText(cell);
  if (!text) return null;
  const look = lookups(db).projects;
  const known = candidates(look, text);
  if (known.length) return known.length === 1 ? (known[0] ?? null) : null;
  const { number, name } = parseFolderName(text);
  const created = db
    .insert(projects)
    .values({
      number: freeNumber(db, projects, number || null) ?? nextNumber(projects),
      name,
      editedFields: ["name"],
    })
    .returning({ id: projects.id, number: projects.number })
    .get();
  // Later rows of the same file naming it (by name or number) get this one, not another.
  look.names.set(lower(text), [created.id]);
  if (created.number != null) look.numbers.set(created.number, created.id);
  return created.id;
}

/** What an integration reported for a slot; kept on a slot left for the review queue. */
type Reported = { slot?: number | null; material?: string; colorHex?: string };
const reportedOf = (row: WriteRow | undefined) => (row?.raw.reported ?? []) as Reported[];

/**
 * Books the print's filament from the file row. A spool the name points to takes the grams
 * through the ledger (only links it for a print older than the spool); a spool or filament that
 * doesn't resolve leaves the grams in the review queue (Step 13) for the user to assign.
 */
function useFilament(
  db: Db,
  printId: string,
  title: string,
  v: ImportValues,
  reported: Reported[] = [],
  /** The spools the user picked in the review, by slot spool key; replaces the cells. */
  picked?: Record<string, string>,
) {
  const look = lookups(db);
  db.delete(printFilamentUsages)
    .where(and(eq(printFilamentUsages.printId, printId), isNull(printFilamentUsages.spoolId)))
    .run();
  const booked: Parameters<typeof syncUsages>[3] = [];
  const waiting: (typeof printFilamentUsages.$inferInsert)[] = [];
  for (let n = 1; n <= PRINT_MAX_SLOTS; n++) {
    const key = printSlotKeys(n);
    const grams = num(v[key.grams]);
    if (!grams || grams <= 0) continue;
    const spoolId = picked ? (picked[key.spool] ?? null) : find(look.spools, v[key.spool]);
    const said = reported[n - 1];
    // An integration's slot keeps what the printer reported.
    const as = said && {
      slot: said.slot ?? null,
      material: said.material ?? null,
      colorHex: said.colorHex?.toLowerCase() ?? null,
    };
    if (spoolId) booked.push({ spoolId, grams, ...as });
    else if (v[key.spool] || v[key.filament] || said)
      waiting.push({
        printId,
        spoolId: null,
        profileId: one(look.profiles, v[key.filament]),
        grams,
        material: str(v[key.filament]) ?? str(v[key.spool]),
        ...as,
      });
  }
  // "no": the spools are already up to date, so only the print's own rows are written.
  syncUsages(db, printId, title, booked, lower(v.trackUsage) !== "no");
  if (waiting.length) db.insert(printFilamentUsages).values(waiting).run();
}

/** A slot with grams whose spool cell names no spool: a person picks one. */
const unmatched = (look: Lookups, v: ImportValues) =>
  Array.from({ length: PRINT_MAX_SLOTS }, (_, i) => printSlotKeys(i + 1)).some(
    (key) => (num(v[key.grams]) ?? 0) > 0 && !find(look.spools, v[key.spool]),
  );

/** `<integrationId>:<externalId>`, the source key of a print an integration offers. */
const sourceOf = (row: WriteRow) => {
  const at = row.source?.indexOf(":") ?? -1;
  return row.source && at > 0
    ? { integrationId: row.source.slice(0, at), externalId: row.source.slice(at + 1) }
    : null;
};

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
      .select({ print: prints, printer: printerLabel, project: projectLabel })
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

  /** By printer, start and title, where the printer is the one each spelling means. */
  match: matchPrintRows,

  /**
   * Each printer, project and spool cell that resolves becomes that row's display name, the
   * spelling the targets use: "box", "1" and "1-Box" all read "01-Box", so matching and the
   * diff see one spelling. A cell that doesn't resolve stays as written.
   */
  canon(db: Db, v: ImportValues): ImportValues {
    const look = lookups(db);
    const label = (ref: Ref, c: ImportCell | undefined) => {
      const id = find(ref, c);
      return (id && ref.labels.get(id)) || (c ?? null);
    };
    const out: ImportValues = {
      ...v,
      printer: label(look.printers, v.printer),
      project: label(look.projects, v.project),
    };
    for (let n = 1; n <= PRINT_MAX_SLOTS; n++) {
      const key = printSlotKeys(n).spool;
      out[key] = label(look.spools, v[key]);
    }
    return out;
  },

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
    // One entry per project to be, as the first row spells it (that row creates it): "135-Boat
    // Test" and a later "135 boat" are the same new project 135.
    const first = new Map<string | number, string>();
    for (const r of rows) {
      const n = cellText(r.project);
      const key = leadingNumber(n) ?? lower(n);
      if (n && !candidates(look, n).length && !first.has(key)) first.set(key, n);
    }
    return first.size ? { projects: [...first.values()] } : {};
  },

  /** What a file row needs besides valid cells. */
  check(db: Db, v: ImportValues) {
    const errors: { column: string; code: ImportErrorCode }[] = [];
    if (!find(lookups(db).printers, v.printer))
      errors.push({ column: "printer", code: "unresolved" });
    // A name several projects answer to can't be told apart (an unknown one is created).
    if (candidates(lookups(db).projects, v.project).length > 1)
      errors.push({ column: "project", code: "unresolved" });
    // Filament named without grams (or the reverse) is a typo, not data.
    for (let n = 1; n <= PRINT_MAX_SLOTS; n++) {
      const key = printSlotKeys(n);
      if ((v[key.spool] || v[key.filament]) && v[key.grams] == null)
        errors.push({ column: key.grams, code: "required" });
      const spoolId = find(lookups(db).spools, v[key.spool]);
      const openedAt = spoolId && lookups(db).opened.get(spoolId);
      if (openedAt && !usableOn({ openedAt }, str(v.startedAt) ?? ""))
        errors.push({ column: key.spool, code: "not_opened" });
    }
    return errors;
  },

  /** Prints an integration imported, by `<integrationId>:<externalId>`. */
  bySource: (db: Db) =>
    new Map(
      db
        .select({
          id: prints.id,
          integrationId: prints.integrationId,
          externalId: prints.externalId,
        })
        .from(prints)
        .where(and(isNotNull(prints.integrationId), isNotNull(prints.externalId)))
        .all()
        .map((p) => [`${p.integrationId}:${p.externalId}`, p.id]),
    ),
  /** A print you have is yours: the vendor's version of it is not offered as a change. */
  handsOff: true,
  /**
   * The spool of each slot with grams, suggested as the one the row names (`printRows` matched it).
   * One left empty waits in the review queue. A run with nobody watching leaves such a print for a
   * person, and one with a spool picked from several (`raw.unsure`) too.
   */
  picks(db: Db) {
    const targets = spoolImport.targets(db);
    const spools = targets.map((s) => ({
      id: s.id,
      label: s.label,
      from: str(s.values.openedAt) ?? undefined,
      empty: s.values.status === "empty" || undefined,
    }));
    const options = Object.fromEntries(
      Array.from({ length: PRINT_MAX_SLOTS }, (_, i) => [printSlotKeys(i + 1).spool, spools]),
    );
    const same = (a: ImportCell | undefined, b: string | undefined) => !!b && lower(a) === lower(b);
    return {
      options,
      optional: true,
      suggest(v: ImportValues, raw: Record<string, unknown>) {
        const look = lookups(db);
        const reported = (raw.reported ?? []) as Reported[];
        const refs: Record<string, string | null> = {};
        const first: Record<string, string[]> = {};
        for (let n = 1; n <= PRINT_MAX_SLOTS; n++) {
          const key = printSlotKeys(n);
          if ((num(v[key.grams]) ?? 0) <= 0) continue;
          refs[key.spool] = find(look.spools, v[key.spool]);
          // What the printer reported for the slot, else the filament the file names, else the
          // filament and colour of the spool it names.
          const said = reported[n - 1];
          const named = targets.find((s) => s.id === refs[key.spool])?.values;
          const fits = (s: ImportTarget) =>
            said
              ? same(s.values.material, said.material) && same(s.values.colorHex, said.colorHex)
              : v[key.filament]
                ? same(s.values.profile, str(v[key.filament]) ?? undefined)
                : !!named &&
                  same(s.values.profile, str(named.profile) ?? undefined) &&
                  same(s.values.colorHex, str(named.colorHex) ?? undefined);
          first[key.spool] = targets.filter(fits).map((s) => s.id);
        }
        const unsure = ((raw.unsure ?? []) as string[]).filter((k) => refs[k]);
        return { refs, sure: !unmatched(look, v) && !unsure.length, unsure, first };
      },
    };
  },
  filePicks: true,

  create(db: Db, v: ImportValues, src?: WriteRow) {
    const printerId = find(lookups(db).printers, v.printer) ?? "";
    const durationSec = num(v.durationSec);
    const outcome = str(v.outcome) as PrintInput["outcome"];
    const source = src && sourceOf(src);
    const row = db
      .insert(prints)
      .values({
        ...(source && {
          origin: "integration" as const,
          ...source,
          plate: num(src.raw.plate as ImportCell),
          coverUrl: str(src.raw.coverUrl as ImportCell),
          sourceUrl: str(src.raw.sourceUrl as ImportCell),
        }),
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
    useFilament(db, row.id, row.title, v, reportedOf(src), src?.refs);
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
    const printerId = printer === undefined ? cur.printerId : find(lookups(db).printers, printer);
    if (printer !== undefined) set.printerId = printerId;
    if (startedAt != null) set.startedAt = new Date(String(startedAt)).toISOString();
    if ((patch.outcome ?? cur.outcome) === "success") set.failureReason = null;
    // The same print, added by hand before: from now on it is the integration's.
    const source = sourceOf(row);
    if (source && !cur.externalId) Object.assign(set, source, { origin: "integration" });
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
      useFilament(
        db,
        cur.id,
        String(set.title ?? cur.title),
        { ...target.values, ...patch, trackUsage: String(row.raw.trackUsage ?? "") },
        reportedOf(row),
      );
  },
};
