import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import {
  SLICER_PRESET_KINDS,
  type SliceRequest,
  type SlicerPresetKind,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { raise } from "../alerts/evaluate.ts";
import { readPreferences } from "../lib/preferences.ts";

// The hub's slicer preset library (ADR-0017). The `slicer_presets` table is the source of truth;
// `<dataDir>/presets/<library>/default/<kind>/` holds its live presets, rebuilt at start and kept
// current on each change. Managed slicers' `config/user` is a junction to `<dataDir>/presets/<library>`.

const { slicerPresets, slicerPresetVersions } = schema;
type Row = typeof slicerPresets.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Who saved a change (names as they were); none = on the hub. */
export type SavedBy = { user?: string | null; device?: string | null };

const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
        )
      : v;

/** Of the canonical json: sorted keys, no whitespace. The clouds re-serialize, so bytes don't compare. */
export const presetSha = (json: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sorted(json)))
    .digest("hex");

/** The json object in `text`, or null. `"nil"` values are valid: they inherit. */
export function parsePreset(text: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(text);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const libraryDir = (dataDir: string, library: string) => join(dataDir, "presets", library);
// ponytail: two names that differ only in these characters share a file; the later write wins.
const fileName = (name: string) =>
  `${name.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").replace(/[. ]+$/, "") || "preset"}.json`;
const fileOf = (dataDir: string, r: Pick<Row, "library" | "kind" | "name">) =>
  join(libraryDir(dataDir, r.library), "default", r.kind, fileName(r.name));

function writeLive(dataDir: string, row: Row) {
  if (!dataDir) return;
  const file = fileOf(dataDir, row);
  if (row.deleted) return rmSync(file, { force: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, row.json);
}

/** Every library's live folder from the table: at start, so the folder is only a cache. */
export function rebuildLibraries(db: Db, dataDir: string) {
  if (!dataDir) return;
  const base = join(dataDir, "presets");
  for (const lib of existsSync(base) ? readdirSync(base) : [])
    rmSync(join(base, lib, "default"), { recursive: true, force: true });
  for (const row of db.select().from(slicerPresets).where(eq(slicerPresets.deleted, false)).all())
    writeLive(dataDir, row);
}

const nextSeq = (tx: Tx) =>
  (tx
    .select({ n: max(slicerPresets.seq) })
    .from(slicerPresets)
    .get()?.n ?? 0) + 1;

/** Keeps `row`'s content as an earlier version; only the `hubVersionsKeep` newest stay. */
function archive(tx: Tx, row: Row, keep: number) {
  tx.insert(slicerPresetVersions)
    .values({
      presetId: row.id,
      version: row.version,
      json: row.json,
      sha256: row.sha256,
      savedUser: row.savedUser,
      savedDevice: row.savedDevice,
      savedAt: row.savedAt,
    })
    .onConflictDoNothing()
    .run();
  const old = tx
    .select({ id: slicerPresetVersions.id })
    .from(slicerPresetVersions)
    .where(eq(slicerPresetVersions.presetId, row.id))
    .orderBy(desc(slicerPresetVersions.version))
    .all()
    .slice(keep);
  if (old.length)
    tx.delete(slicerPresetVersions)
      .where(
        inArray(
          slicerPresetVersions.id,
          old.map((v) => v.id),
        ),
      )
      .run();
}

/**
 * Stores a preset (`json` must parse, see `parsePreset`): new, changed (the old content becomes a
 * version) or back from a delete. The same canonical sha is no change. Returns the row if it changed.
 */
export function savePreset(
  db: Db,
  dataDir: string,
  p: { library: string; kind: SlicerPresetKind; name: string; json: string },
  by: SavedBy = {},
) {
  const sha256 = presetSha(JSON.parse(p.json));
  const keep = readPreferences(db).hubVersionsKeep;
  const row = db.transaction((tx) => {
    const old = tx
      .select()
      .from(slicerPresets)
      .where(
        and(
          eq(slicerPresets.library, p.library),
          eq(slicerPresets.kind, p.kind),
          eq(slicerPresets.name, p.name),
        ),
      )
      .get();
    if (old && !old.deleted && old.sha256 === sha256) return undefined;
    const set = {
      json: p.json,
      sha256,
      deleted: false,
      seq: nextSeq(tx),
      savedUser: by.user ?? null,
      savedDevice: by.device ?? null,
      savedAt: new Date().toISOString(),
    };
    if (!old)
      return tx
        .insert(slicerPresets)
        .values({ ...p, ...set, version: 1 })
        .returning()
        .get();
    archive(tx, old, keep);
    return tx
      .update(slicerPresets)
      .set({ ...set, version: old.version + 1 })
      .where(eq(slicerPresets.id, old.id))
      .returning()
      .get();
  });
  if (row) writeLive(dataDir, row);
  return row;
}

/**
 * Deletes a live preset on the hub: a tombstone (its last json kept), gone from the folder and so
 * from the hub slicer and workers. Desktops keep theirs (ADR-0017: their cloud brings it back).
 */
export function deletePreset(db: Db, dataDir: string, id: string, by: SavedBy = {}) {
  const row = db.transaction((tx) => {
    const old = tx.select().from(slicerPresets).where(eq(slicerPresets.id, id)).get();
    if (!old || old.deleted) return undefined;
    return tx
      .update(slicerPresets)
      .set({
        deleted: true,
        seq: nextSeq(tx),
        savedUser: by.user ?? null,
        savedDevice: by.device ?? null,
        savedAt: new Date().toISOString(),
      })
      .where(eq(slicerPresets.id, id))
      .returning()
      .get();
  });
  if (row) writeLive(dataDir, row);
  return row;
}

/**
 * A slicer config's user presets (`<user>/<account>/<kind>/**.json`) merged into the library: new
 * names added, other content saved as the next version, nothing removed. Of one name in several
 * accounts the first wins, as the reader does. Json that doesn't parse is skipped with an alert.
 * Returns how many presets changed.
 */
export function mergeUserPresets(
  db: Db,
  dataDir: string,
  library: string,
  user: string,
  by: SavedBy = {},
) {
  const seen = new Set<string>();
  let changed = 0;
  for (const account of existsSync(user) ? readdirSync(user) : [])
    for (const kind of SLICER_PRESET_KINDS) {
      const dir = join(user, account, kind);
      if (!existsSync(dir)) continue;
      for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
        if (!rel.endsWith(".json")) continue;
        const text = readFileSync(join(dir, rel), "utf8");
        const json = parsePreset(text);
        const name = typeof json?.name === "string" && json.name ? json.name : parse(rel).name;
        if (seen.has(`${kind}/${name}`)) continue;
        seen.add(`${kind}/${name}`);
        if (!json) {
          raise(db, {
            kind: "preset_skipped",
            severity: "warning",
            module: "hub",
            task: `presets:${library}`,
            entityType: "preset",
            entityId: `${library}:${kind}:${name}:${createHash("sha256").update(text).digest("hex")}`,
            context: { library, kind, name, reason: "invalid_json" },
          });
          continue;
        }
        if (savePreset(db, dataDir, { library, kind, name, json: text }, by)) changed++;
      }
    }
  return changed;
}

/**
 * The live library presets a slice uses, id → sha256, for `slicedPresets`: its `user/` process and
 * filaments. ponytail: an unpicked slot's own user filament (the 3MF's) isn't tracked, and user
 * machine presets can't be passed (ADR-0007).
 */
export function usedPresets(db: Db, library: string, req: SliceRequest): Record<string, string> {
  const wanted: [SlicerPresetKind, string][] = [];
  if (req.process?.startsWith("user/")) wanted.push(["process", req.process.slice(5)]);
  for (const f of req.filaments ?? [])
    if (f?.startsWith("user/")) wanted.push(["filament", f.slice(5)]);
  if (!wanted.length) return {};
  const rows = db
    .select()
    .from(slicerPresets)
    .where(
      and(
        eq(slicerPresets.library, library),
        eq(slicerPresets.deleted, false),
        inArray(
          slicerPresets.name,
          wanted.map(([, n]) => n),
        ),
      ),
    )
    .all();
  return Object.fromEntries(
    rows
      .filter((r) => wanted.some(([k, n]) => k === r.kind && n === r.name))
      .map((r) => [r.id, r.sha256]),
  );
}

/** Whether a plate's sliced presets changed since: another sha now, or deleted. */
export function presetsChanged(db: Db) {
  const live = new Map(
    db
      .select({ id: slicerPresets.id, sha256: slicerPresets.sha256 })
      .from(slicerPresets)
      .where(eq(slicerPresets.deleted, false))
      .all()
      .map((r) => [r.id, r.sha256]),
  );
  return (r: { slicedPresets: Record<string, string> | null }) =>
    Object.entries(r.slicedPresets ?? {}).some(([id, sha]) => live.get(id) !== sha);
}

/** The library's last change, for cache keys. */
export const presetsSeq = (db: Db) =>
  db
    .select({ n: max(slicerPresets.seq) })
    .from(slicerPresets)
    .get()?.n ?? 0;
