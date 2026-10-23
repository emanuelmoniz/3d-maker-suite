import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  autoOf,
  IMPORT_COLUMNS,
  type ImportApplyDecision,
  type ImportErrorCode,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportTarget,
  type ImportValues,
  type MergePolicy,
  mergeValues,
  parseRow,
  type ReviewEntity,
  suggest,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { HttpError } from "../errors.ts";
import { catalogImport } from "./catalog.ts";
import { clientImport, orderImport, quoteImport } from "./commerce.ts";
import { filamentProfileImport } from "./filamentProfiles.ts";
import { installImport } from "./installs.ts";
import { maintenanceImport, maintenanceTypeImport } from "./maintenance.ts";
import { orderProjectImport } from "./orderProjects.ts";
import { accessoryImport, printerImport } from "./printers.ts";
import { printImport } from "./prints.ts";
import { projectImport } from "./projects.ts";
import { spoolImport } from "./spools.ts";

/** One row to review: a file's line, or what an integration or a zip offers, still unparsed. */
export type StoredRow = {
  n: number;
  raw: Record<string, unknown>;
  /** The vendor's key for the row (`sourceSpool`, `sourcePreset`); kept on the row it becomes. */
  source?: string;
  /** A picture on this server to copy along (a printer model's thumbnail). */
  image?: string | null;
};

/** Rows kept from the preview until they are applied. */
export type Stored = {
  entity: ReviewEntity;
  fileName?: string;
  ignoredHeaders: string[];
  rows: StoredRow[];
  /** Set when the rows were read from an integration or a zip instead of a file. */
  from?: { kind: "integration"; integrationId: string } | { kind: "zip" };
  dir?: string;
  /** The date range the rows were read for (prints), so applying them runs the same range. */
  range?: { from?: string; to?: string };
  /** A file's column keys in its order. */
  columns?: string[];
};

/** The row a write is for, with the references the user picked for it. */
export type WriteRow = StoredRow & {
  refs?: Record<string, string>;
  /** Projects: see `importApplySchema`. */
  fromFolder?: boolean;
  prints?: string[];
};

/** What an entity adds to the review: its existing rows, its matcher and its writes. */
export type ImportHandler = {
  /** Existing rows a row can update, in the shape of the import columns. */
  targets: (db: Db) => ImportTarget[];
  /** Per row: the targets that fit and the one to suggest (pure, in core). */
  match: (
    rows: ImportValues[],
    targets: ImportTarget[],
  ) => { candidates: string[]; targetId: string | null }[];
  /** A valid row's ref cells in the spelling the targets use, before matching and diffing. */
  canon?: (db: Db, values: ImportValues) => ImportValues;
  /** By `ref`: the names the template's dropdowns offer. */
  refs?: (db: Db) => Record<string, string[]>;
  /** By `ref`: names in the rows that apply would create. */
  missing: (db: Db, rows: ImportValues[]) => Record<string, string[]>;
  /**
   * Errors a valid-looking row still has, e.g. a name that must exist and doesn't. `file`: the row
   * is from a file, not from an integration or a zip.
   */
  check?: (
    db: Db,
    values: ImportValues,
    file: boolean,
  ) => { column: string; code: ImportErrorCode }[];
  /** Per valid row, in order: errors it has because of the other rows of the file. */
  checkFile?: (db: Db, rows: ImportValues[]) => { column: string; code: ImportErrorCode }[][];
  /** What the review shows about a valid row besides its values (a project's missing folder). */
  flags?: (db: Db, values: ImportValues) => Partial<ImportPreviewRow>;
  // The rest is for rows with a `source` (from an integration or a zip).
  /** The existing row each source key was imported as. A hit beats the matcher. */
  bySource?: (db: Db) => Map<string, string>;
  /** A row imported from one source is never another source row's match (two rolls of one filament). */
  exclusive?: boolean;
  /** A source row is only ever the row its key names; `create` links one entered by hand. */
  sourceOnly?: boolean;
  /** A row you imported is yours: a change at the source is offered, never suggested. */
  handsOff?: boolean;
  /**
   * Rows you archived (`archived: true`) and the one a source row is, if any: the row is offered
   * as a skip against it, never written by a run, and an update restores it.
   */
  archived?: (db: Db) => {
    targets: ImportTarget[];
    of: (source: string | undefined, values: ImportValues) => string | null;
  };
  /**
   * References the user picks instead of having them created, and the suggestion for a row; a run
   * with nobody watching leaves a row it isn't `sure` of for a person. A row is offered the keys
   * its suggestion's `refs` name; the `optional` ones may stay empty.
   */
  picks?: (db: Db) => {
    options: Record<string, { id: string; label: string; from?: string; empty?: boolean }[]>;
    /**
     * `raw` is the stored row; `unsure` names the suggested refs a person should check, `first`
     * the options that fit each ref best.
     */
    suggest: (
      v: ImportValues,
      raw: StoredRow["raw"],
    ) => {
      refs: Record<string, string | null>;
      sure: boolean;
      unsure?: string[];
      first?: Record<string, string[]>;
    };
    optional?: string[];
  };
  /** Rows from a file get the `picks` too (a print's spools), not only rows from a source. */
  filePicks?: boolean;
  /** Rows a run with nobody watching leaves for a person. */
  held?: (db: Db) => (v: ImportValues) => boolean;
  /** Returns false when the row was there already and nothing was added; may return the new id. */
  create: (db: Db, values: ImportValues, row: WriteRow) => unknown;
  update: (db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) => void;
};

const UPLOADS = "imports";
const DAY = 24 * 60 * 60 * 1000;

/** Prints saved with their filament but none of it taken from the spools (`trackUsage` "no"). */
export const untracked = (stored: Stored): Stored =>
  stored.entity === "prints"
    ? { ...stored, rows: stored.rows.map((r) => ({ ...r, raw: { ...r.raw, trackUsage: "no" } })) }
    : stored;

/** A stored cell as the review shows it: text or a number. */
const shown = (v: unknown) =>
  v == null || typeof v === "string" || typeof v === "number" ? (v ?? null) : String(v);

/**
 * The rows with the cells edited in the review in place of the file's. The identity of a row
 * that updates (its number, any row's id) is never edited: that would be another row.
 */
export function edited(stored: Stored, decisions: ImportApplyDecision[]): Stored {
  const keys = new Set(IMPORT_COLUMNS[stored.entity].map((c) => c.key));
  const edits = new Map<number, ImportValues>();
  for (const d of decisions) {
    if (!d.values) continue;
    for (const k of Object.keys(d.values)) {
      if (k === "id" || (k === "number" && d.action === "update"))
        throw new HttpError(400, "identity_locked", `Row ${d.row}: ${k} can't be changed`);
      if (!keys.has(k)) throw new HttpError(400, "unknown_column", `Row ${d.row}: no column ${k}`);
    }
    edits.set(d.row, d.values);
  }
  if (!edits.size) return stored;
  return {
    ...stored,
    rows: stored.rows.map((r) =>
      edits.has(r.n) ? { ...r, raw: { ...r.raw, ...edits.get(r.n) } } : r,
    ),
  };
}

/** Preview and apply for every reviewed import, whatever the rows came from. */
export function createReview(db: Db, dataDir: string) {
  const dir = join(dataDir, UPLOADS);
  // `id` is a validated uuid, so it can't leave the folder.
  const file = (id: string) => join(dir, `${id}.json`);
  const handlers: Record<ReviewEntity, ImportHandler> = {
    spools: spoolImport,
    printers: printerImport,
    accessories: accessoryImport,
    accessoryInstalls: installImport,
    projects: projectImport,
    prints: printImport,
    clients: clientImport,
    quotes: quoteImport,
    orders: orderImport,
    maintenanceTypes: maintenanceTypeImport,
    maintenance: maintenanceImport,
    orderProjects: orderProjectImport,
    filamentProfiles: filamentProfileImport,
    ...catalogImport(dataDir),
  };

  /** Keeps the rows for the apply that follows a preview. */
  function save(stored: Stored) {
    mkdirSync(dir, { recursive: true });
    // Uploads nobody confirmed don't pile up.
    for (const f of readdirSync(dir))
      if (Date.now() - statSync(join(dir, f)).mtimeMs > DAY) rmSync(join(dir, f));
    const uploadId = crypto.randomUUID();
    writeFileSync(file(uploadId), JSON.stringify(stored));
    return uploadId;
  }
  const load = (uploadId: string) =>
    existsSync(file(uploadId))
      ? (JSON.parse(readFileSync(file(uploadId), "utf8")) as Stored)
      : null;
  const drop = (uploadId: string) => rmSync(file(uploadId), { force: true });

  /** Validates and matches the stored rows against the database as it is now. */
  function preview(stored: Stored): Omit<ImportPreview, "uploadId"> {
    const columns = IMPORT_COLUMNS[stored.entity];
    const handler = handlers[stored.entity];
    const targets = handler.targets(db);
    const sourced = !!stored.from;
    const gone = (sourced && handler.archived?.(db)) || undefined;
    const byId = new Map([...targets, ...(gone?.targets ?? [])].map((t) => [t.id, t]));
    const bySource = (sourced && handler.bySource?.(db)) || new Map<string, string>();
    const picks = sourced || handler.filePicks ? handler.picks?.(db) : undefined;
    const held = sourced ? handler.held?.(db) : undefined;
    const parsed = stored.rows.map((r) => {
      const p = parseRow(columns, r.raw);
      if (!p.errors.length) p.errors.push(...(handler.check?.(db, p.values, !sourced) ?? []));
      if (!p.errors.length && handler.canon) p.values = handler.canon(db, p.values);
      // A row from an export carries its id, one from an integration its source key: both beat
      // the matcher.
      const id = String(r.raw.id ?? "").trim();
      const hit = byId.has(id) ? id : (r.source && bySource.get(r.source)) || null;
      // One you archived is the row only when nothing you have is.
      const archived = (!hit && !p.errors.length && gone?.of(r.source, p.values)) || null;
      return { hit: hit ?? archived, archived: !!archived, raw: r.raw, row: r.n, ...p };
    });
    // Only the columns (and the id) go to the review, not what a vendor's row carries besides.
    const cells = (raw: StoredRow["raw"]) =>
      Object.fromEntries(
        ["id", ...columns.map((c) => c.key)].flatMap((k) => (k in raw ? [[k, shown(raw[k])]] : [])),
      );
    // Errors rows have only together (an install overlapping another row of the file).
    const clean = parsed.filter((p) => !p.errors.length);
    handler
      .checkFile?.(
        db,
        clean.map((p) => p.values),
      )
      .forEach((errors, i) => {
        clean[i]?.errors.push(...errors);
      });
    const valid = parsed.filter((p) => !p.errors.length);
    const open = valid.filter((p) => !p.hit);
    const linked = new Set(bySource.values());
    const matches = handler.match(
      open.map((p) => p.values),
      sourced && handler.sourceOnly
        ? []
        : sourced && handler.exclusive
          ? targets.filter((t) => !linked.has(t.id))
          : targets,
    );
    const matchOf = new Map(open.map((p, i) => [p.row, matches[i]]));
    return {
      entity: stored.entity,
      dir: stored.dir,
      rows: parsed.map(({ hit, archived, raw, ...p }) => {
        const m = hit
          ? { candidates: [hit], targetId: hit }
          : (matchOf.get(p.row) ?? { candidates: [], targetId: null });
        const target = (m.targetId && byId.get(m.targetId)?.values) || null;
        const s = suggest(columns, p, { candidates: m.candidates, target });
        const pick = hit || p.errors.length ? undefined : picks?.suggest(p.values, raw);
        const picked = pick && {
          refs: pick.refs,
          ...(pick.unsure?.length && { refsUnsure: pick.unsure }),
          ...(pick.first && { refsFirst: pick.first }),
        };
        const flags = !p.errors.length && handler.flags?.(db, p.values);
        if (!sourced) return { ...p, raw: cells(raw), ...m, ...s, ...picked, ...flags };
        const yours = (!!hit && !!handler.handsOff) || archived;
        // A row that has only required picks is skipped until picked (a vendor's spool); one with
        // optional ones too stays a create, so a missing required pick shows (a print's project).
        const unpicked = !!pick && !picks?.optional && Object.values(pick.refs).some((v) => !v);
        return {
          ...p,
          raw: cells(raw),
          ...m,
          ...s,
          ...((yours || (unpicked && s.action === "create")) && { action: "skip" as const }),
          ...picked,
          auto: autoOf({
            status: s.status,
            // Without a source key the name is the identity, so a match is the row itself.
            linked: !!hit || (!handler.bySource && !!m.targetId),
            held: !!held?.(p.values) || (!!pick && !pick.sure),
            optional: yours,
          }),
        };
      }),
      targets: [...targets, ...(gone?.targets ?? [])],
      // Required picks are never created, so nothing is announced for them.
      missing:
        picks && !picks.optional
          ? {}
          : handler.missing(
              db,
              valid.map((p) => p.values),
            ),
      ignoredHeaders: stored.ignoredHeaders,
      columns: stored.columns,
      refNames: handler.refs?.(db) ?? {},
      refOptions: picks?.options,
      ...(picks?.optional && { refsOptional: picks.optional }),
    };
  }

  /** The writes the decisions ask for. Anything wrong rejects them all. */
  function plan(original: Stored, decisions: ImportApplyDecision[], policy: MergePolicy) {
    const handler = handlers[original.entity];
    // Edited rows are read, checked and canonised again. The target stays the decision's.
    const stored = edited(original, decisions);
    const current = preview(stored);
    const rows = new Map(current.rows.map((r) => [r.row, r]));
    const targets = new Map(current.targets.map((t) => [t.id, t]));
    const source = new Map(stored.rows.map((r) => [r.n, r]));
    const used = new Set<string | number>();
    const ops = decisions.map((d) => {
      const row = rows.get(d.row);
      const from = source.get(d.row);
      const [error] = row?.errors ?? [];
      if (!row || !from || error)
        throw new HttpError(
          400,
          "invalid_row",
          `Row ${d.row} can't be imported${error ? `: ${error.column} ${error.code}` : ""}`,
        );
      const target = d.action === "update" ? targets.get(d.targetId ?? "") : undefined;
      if (d.action === "update" && !target)
        throw new HttpError(400, "target_not_found", `Row ${d.row} has no row to update`);
      // One decision per row, one row per existing row.
      for (const key of target ? [d.row, target.id] : [d.row]) {
        if (used.has(key))
          throw new HttpError(400, "duplicate_decision", `Row ${d.row} is used twice`);
        used.add(key);
      }
      // A picked reference is never created: it has to be one of the offered rows. An optional
      // one may be left out, and one the row isn't offered is never asked for.
      if (!target)
        for (const [column, options] of Object.entries(current.refOptions ?? {})) {
          const asked = !!row.refs && column in row.refs;
          const optional = current.refsOptional?.includes(column);
          if (d.refs?.[column] === undefined && (!asked || optional)) continue;
          if (!options.some((o) => o.id === d.refs?.[column]))
            throw new HttpError(400, "ref_not_found", `Row ${d.row} needs a ${column} you have`);
        }
      // A print's tick replaces the row's track-usage cell (`useFilament` reads it).
      const track =
        stored.entity !== "prints" || d.trackUsage === undefined
          ? undefined
          : d.trackUsage
            ? "yes"
            : "no";
      let values = track ? { ...row.values, trackUsage: track } : row.values;
      // A project's folder picked in the review replaces its cell and is checked like one. One to
      // create has no path until the route made it, just before the write.
      if (stored.entity === "projects" && d.folder !== undefined) {
        values = { ...values, folder: d.folder && "path" in d.folder ? d.folder.path : null };
        if (handler.canon) values = handler.canon(db, values);
        const [error] = handler.check?.(db, values, !stored.from) ?? [];
        if (error)
          throw new HttpError(400, "invalid_row", `Row ${d.row}: ${error.column} ${error.code}`);
      }
      return {
        values,
        target,
        policy: d.policy ?? policy,
        row: {
          ...from,
          refs: d.refs,
          fromFolder: d.fromFolder,
          prints: d.prints,
          ...(track && { raw: { ...from.raw, trackUsage: track } }),
        },
      };
    });
    return { current, ops };
  }

  /**
   * Applies the decisions in one transaction. `backup` names the backup a confirmed import took
   * first; a run with nobody watching has none and is only logged when it wrote something.
   */
  function write(
    stored: Stored,
    decisions: ImportApplyDecision[],
    policy: MergePolicy,
    backup: string | null,
  ) {
    const columns = IMPORT_COLUMNS[stored.entity];
    const handler = handlers[stored.entity];
    const { current, ops } = plan(stored, decisions, policy);
    // Prints oldest first, whatever order the file or the vendor lists them in: numbers and spool
    // bookings follow time. Same start keeps the row order.
    if (stored.entity === "prints") {
      const at = (op: (typeof ops)[number]) => Date.parse(String(op.values.startedAt));
      ops.sort((a, b) => at(a) - at(b));
    }
    // The rows written, for a sync run's log and a projects import's follow-up (by file row).
    const written: {
      event: "created" | "updated";
      values: (typeof ops)[number]["values"];
      row: number;
      id?: string;
    }[] = [];
    db.transaction(() => {
      for (const op of ops) {
        const row = op.row.n;
        if (!op.target) {
          const made = handler.create(db, op.values, op.row);
          if (made !== false)
            written.push({
              event: "created",
              values: op.values,
              row,
              ...(typeof made === "string" && { id: made }),
            });
          continue;
        }
        const patch = mergeValues(columns, op.policy, op.values, op.target.values);
        // Prints picked in the review, names taken from the folder, or a row you archived coming
        // back are a change of their own.
        if (
          !Object.keys(patch).length &&
          !op.row.prints &&
          !op.row.fromFolder &&
          !op.target.archived
        )
          continue;
        handler.update(db, op.target, patch, op.row);
        written.push({ event: "updated", values: op.values, row, id: op.target.id });
      }
    });
    const created = written.filter((w) => w.event === "created").length;
    const updated = written.length - created;
    const invalid = current.rows.filter((r) => r.status === "invalid");
    const skipped = current.rows.length - invalid.length - created - updated;
    if (backup || created || updated)
      db.insert(schema.importRuns)
        .values({
          source: stored.from?.kind ?? "file",
          type: stored.entity,
          fileName: stored.fileName ?? null,
          created,
          updated,
          skipped,
          invalid: invalid.length,
          errors: invalid
            .slice(0, 50)
            .flatMap((r) => r.errors.map((e) => ({ row: r.row, ...e })))
            .slice(0, 50),
          backup,
        })
        .run();
    // What is still there for a person (or the next run) once this one is done.
    const left = stored.from ? preview(stored).rows.filter((r) => r.auto) : [];
    return { created, updated, skipped, pending: left.length, left, written, invalid };
  }

  return { handlers, save, load, drop, preview, plan, write };
}

export type Review = ReturnType<typeof createReview>;
