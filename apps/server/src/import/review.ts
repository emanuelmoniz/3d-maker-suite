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
import { filamentProfileImport } from "./filamentProfiles.ts";
import { printerImport } from "./printers.ts";
import { printImport } from "./prints.ts";
import { spoolImport } from "./spools.ts";

/** One row to review: a file's line, or what an integration or a zip offers, still unparsed. */
export type StoredRow = {
  n: number;
  raw: Record<string, unknown>;
  /** The vendor's key for the row (`sourceSpool`, `sourcePreset`); kept on the row it becomes. */
  source?: string;
  /** A picture on this server to copy along (a printer model's thumbnail). */
  image?: string | null;
  /** Only offered, never waiting for review (a slicer's built-in preset). */
  optional?: boolean;
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
};

/** The row a write is for, with the references the user picked for it. */
export type WriteRow = StoredRow & { refs?: Record<string, string> };

/** What an entity adds to the review: its existing rows, its matcher and its writes. */
export type ImportHandler = {
  /** Existing rows a row can update, in the shape of the import columns. */
  targets: (db: Db) => ImportTarget[];
  /** Per row: the targets that fit and the one to suggest (pure, in core). */
  match: (
    rows: ImportValues[],
    targets: ImportTarget[],
  ) => { candidates: string[]; targetId: string | null }[];
  /** By `ref`: the names the template's dropdowns offer. */
  refs?: (db: Db) => Record<string, string[]>;
  /** By `ref`: names in the rows that apply would create. */
  missing: (db: Db, rows: ImportValues[]) => Record<string, string[]>;
  /** Errors a valid-looking row still has, e.g. a name that must exist and doesn't. */
  check?: (db: Db, values: ImportValues) => { column: string; code: ImportErrorCode }[];
  // The rest is for rows with a `source` (from an integration or a zip).
  /** The existing row each source key was imported as. A hit beats the matcher. */
  bySource?: (db: Db) => Map<string, string>;
  /** A row imported from one source is never another source row's match (two rolls of one filament). */
  exclusive?: boolean;
  /** A row you imported is yours: a change at the source is offered, never suggested. */
  handsOff?: boolean;
  /** References the user picks instead of having them created, and the suggestion for a row. */
  picks?: (db: Db) => {
    options: Record<string, { id: string; label: string }[]>;
    suggest: (v: ImportValues) => { refs: Record<string, string | null>; sure: boolean };
  };
  /** Rows a run with nobody watching leaves for a person. */
  held?: (db: Db) => (v: ImportValues) => boolean;
  /** Returns false when the row was there already and nothing was added. */
  create: (db: Db, values: ImportValues, row: WriteRow) => unknown;
  update: (db: Db, target: ImportTarget, patch: ImportValues, row: WriteRow) => void;
};

const UPLOADS = "imports";
const DAY = 24 * 60 * 60 * 1000;

/** Preview and apply for every reviewed import, whatever the rows came from. */
export function createReview(db: Db, dataDir: string) {
  const dir = join(dataDir, UPLOADS);
  // `id` is a validated uuid, so it can't leave the folder.
  const file = (id: string) => join(dir, `${id}.json`);
  const handlers: Record<ReviewEntity, ImportHandler> = {
    spools: spoolImport,
    printers: printerImport,
    prints: printImport,
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
    const byId = new Map(targets.map((t) => [t.id, t]));
    const sourced = !!stored.from;
    const bySource = (sourced && handler.bySource?.(db)) || new Map<string, string>();
    const picks = sourced ? handler.picks?.(db) : undefined;
    const held = sourced ? handler.held?.(db) : undefined;
    const parsed = stored.rows.map((r) => {
      const p = parseRow(columns, r.raw);
      if (!p.errors.length) p.errors.push(...(handler.check?.(db, p.values) ?? []));
      // A row from an export carries its id, one from an integration its source key: both beat
      // the matcher.
      const id = String(r.raw.id ?? "").trim();
      const hit = byId.has(id) ? id : (r.source && bySource.get(r.source)) || null;
      return { optional: !!r.optional, hit, row: r.n, ...p };
    });
    const valid = parsed.filter((p) => !p.errors.length);
    const open = valid.filter((p) => !p.hit);
    const linked = new Set(bySource.values());
    const matches = handler.match(
      open.map((p) => p.values),
      sourced && handler.exclusive ? targets.filter((t) => !linked.has(t.id)) : targets,
    );
    const matchOf = new Map(open.map((p, i) => [p.row, matches[i]]));
    return {
      entity: stored.entity,
      dir: stored.dir,
      rows: parsed.map(({ optional, hit, ...p }) => {
        const m = hit
          ? { candidates: [hit], targetId: hit }
          : (matchOf.get(p.row) ?? { candidates: [], targetId: null });
        const target = (m.targetId && byId.get(m.targetId)?.values) || null;
        const s = suggest(columns, p, { candidates: m.candidates, target });
        if (!sourced) return { ...p, ...m, ...s };
        const yours = !!hit && !!handler.handsOff;
        const pick = hit || p.errors.length ? undefined : picks?.suggest(p.values);
        const unpicked = !!pick && Object.values(pick.refs).some((v) => !v);
        return {
          ...p,
          ...m,
          ...s,
          ...((yours || (unpicked && s.action === "create")) && { action: "skip" as const }),
          ...(pick && { refs: pick.refs }),
          auto: autoOf({
            status: s.status,
            // Without a source key the name is the identity, so a match is the row itself.
            linked: !!hit || (!handler.bySource && !!m.targetId),
            held: !!held?.(p.values) || (!!pick && !pick.sure),
            optional: optional || yours,
          }),
        };
      }),
      targets,
      // Picked references are never created, so nothing is announced for them.
      missing: picks
        ? {}
        : handler.missing(
            db,
            valid.map((p) => p.values),
          ),
      ignoredHeaders: stored.ignoredHeaders,
      refOptions: picks?.options,
    };
  }

  /** The writes the decisions ask for. Anything wrong rejects them all. */
  function plan(stored: Stored, decisions: ImportApplyDecision[], policy: MergePolicy) {
    const current = preview(stored);
    const rows = new Map(current.rows.map((r) => [r.row, r]));
    const targets = new Map(current.targets.map((t) => [t.id, t]));
    const source = new Map(stored.rows.map((r) => [r.n, r]));
    const used = new Set<string | number>();
    const ops = decisions.map((d) => {
      const row = rows.get(d.row);
      const from = source.get(d.row);
      if (!row || !from || row.status === "invalid")
        throw new HttpError(400, "invalid_row", `Row ${d.row} can't be imported`);
      const target = d.action === "update" ? targets.get(d.targetId ?? "") : undefined;
      if (d.action === "update" && !target)
        throw new HttpError(400, "target_not_found", `Row ${d.row} has no row to update`);
      // One decision per row, one row per existing row.
      for (const key of target ? [d.row, target.id] : [d.row]) {
        if (used.has(key))
          throw new HttpError(400, "duplicate_decision", `Row ${d.row} is used twice`);
        used.add(key);
      }
      // A picked reference is never created: it has to be one of the offered rows.
      if (!target)
        for (const [column, options] of Object.entries(current.refOptions ?? {}))
          if (!options.some((o) => o.id === d.refs?.[column]))
            throw new HttpError(400, "ref_not_found", `Row ${d.row} needs a ${column} you have`);
      return {
        values: row.values,
        target,
        policy: d.policy ?? policy,
        row: { ...from, refs: d.refs },
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
    let created = 0;
    let updated = 0;
    db.transaction(() => {
      for (const op of ops) {
        if (!op.target) {
          if (handler.create(db, op.values, op.row) !== false) created++;
          continue;
        }
        const patch = mergeValues(columns, op.policy, op.values, op.target.values);
        if (!Object.keys(patch).length) continue;
        handler.update(db, op.target, patch, op.row);
        updated++;
      }
    });
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
    const pending = stored.from ? preview(stored).rows.filter((r) => r.auto).length : 0;
    return { created, updated, skipped, pending };
  }

  return { handlers, save, load, drop, preview, plan, write };
}

export type Review = ReturnType<typeof createReview>;
