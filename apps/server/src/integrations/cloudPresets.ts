import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  defaultPolicy,
  type FilamentLibrary,
  type IntegrationAdapter,
  type SlicerPresetKind,
  type SyncLogEntry,
  USER_PRESET_ENTITY,
  type USER_PRESET_TYPES,
  type UserPresetSource,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { parsePreset, presetFileName, presetSha, presetText } from "@3d-maker-suite/host";
import { asc } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { PRESET_KINDS } from "../import/gone.ts";
import { readPreferences } from "../lib/preferences.ts";
import { catalogDir, policyOf } from "./capabilities.ts";
import { zipFilled } from "./managedSlicer.ts";
import {
  deletePreset,
  namedPreset,
  presetUses,
  type SavedBy,
  uploadPreset,
} from "./presetLibrary.ts";

// An account's user presets (ADR-0019): read into a folder of their own, so the slicer's reader
// turns them into catalog rows like any folder's, then copied to where slicing finds them.

const { integrations, syncPolicies } = schema;
type Row = typeof integrations.$inferSelect;
type UserPresetType = (typeof USER_PRESET_TYPES)[number];

/** A copy this route placed for slicing: the library version it left (0 off a hub) and its sha. */
type Placed = { version: number; sha: string; held?: boolean };
/** The type's `cursor`: each listed preset's time when last fetched, and the copies placed. */
type Cursor = { ids: Record<string, string>; placed: Record<string, Placed> };

const kindOf = (type: UserPresetType) => PRESET_KINDS[USER_PRESET_ENTITY[type]];
const folderOf = (dir: string, kind: SlicerPresetKind) => join(dir, "user", "cloud", kind);
/** Where an account's presets are read from: `user/cloud/<kind>`, and `system` linked. */
export const cloudPresetsDir = (dataDir: string, integrationId: string) =>
  join(dataDir, "cloud-presets", integrationId);

function readCursor(db: Db, integrationId: string, type: UserPresetType): Cursor {
  try {
    const c = JSON.parse(policyOf(db, integrationId, type).cursor ?? "");
    return { ids: c.ids ?? {}, placed: c.placed ?? {} };
  } catch {
    return { ids: {}, placed: {} };
  }
}

function saveCursor(db: Db, integrationId: string, type: UserPresetType, c: Cursor) {
  const cursor = JSON.stringify(c);
  db.insert(syncPolicies)
    .values({ integrationId, type, ...defaultPolicy(type), mode: "manual", cursor })
    .onConflictDoUpdate({
      target: [syncPolicies.integrationId, syncPolicies.type],
      set: { cursor },
    })
    .run();
}

/**
 * `system` in `dir` links to the system presets of the oldest row of `library` that has them, so
 * the presets' parents resolve. None: no link, and a preset that needs its parent waits for review.
 */
function linkSystem(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  dir: string,
  library: string,
) {
  const target = db
    .select()
    .from(integrations)
    .orderBy(asc(integrations.createdAt))
    .all()
    .map((row) => {
      const adapter = adapters.find((a) => a.id === row.adapterId);
      const config = adapter?.library?.id === library && catalogDir(db, dataDir, row, adapter);
      return config ? join(config, "system") : null;
    })
    .find((d) => d && existsSync(d));
  const link = join(dir, "system");
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const want = target ? real(target) : null;
  if (real(link) === want) return;
  const st = lstatSync(link, { throwIfNoEntry: false });
  if (st && !st.isSymbolicLink()) return;
  if (st) unlinkSync(link);
  if (want) symlinkSync(want, link, "junction");
}

/**
 * Brings the account's presets of `type` into its folder and returns the library that reads them.
 * Only a preset whose time changed is fetched. Everything is fetched before the folder changes, so a
 * failed or changed answer (it throws) leaves it as it was: a short list never counts as removals.
 */
export async function fetchCloudPresets(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  row: Row,
  type: UserPresetType,
  source: UserPresetSource,
): Promise<{ lib: FilamentLibrary; dir: string }> {
  const lib = adapters.find((a) => a.library?.id === source.library)?.library;
  if (!lib || !dataDir)
    throw new HttpError(404, "library_not_found", `No slicer reads "${source.library}" presets`);
  const kind = kindOf(type);
  const dir = cloudPresetsDir(dataDir, row.id);
  const folder = folderOf(dir, kind);
  const cursor = readCursor(db, row.id, type);
  const listed = (await source.list()).filter((e) => e.kind === kind);
  const fresh: [string, Record<string, unknown>][] = [];
  for (const e of listed) {
    const file = join(folder, presetFileName(e.name));
    if (cursor.ids[e.id] !== e.updatedAt || !existsSync(file))
      fresh.push([file, await source.get(e.id)]);
  }
  mkdirSync(folder, { recursive: true });
  linkSystem(db, dataDir, adapters, dir, source.library);
  for (const [file, json] of fresh) writeFileSync(file, presetText(json, "    "));
  const keep = new Set(listed.map((e) => presetFileName(e.name)));
  for (const f of readdirSync(folder)) if (!keep.has(f)) rmSync(join(folder, f), { force: true });
  saveCursor(db, row.id, type, {
    ...cursor,
    ids: Object.fromEntries(listed.map((e) => [e.id, e.updatedAt])),
  });
  return { lib, dir };
}

// Not settings: a slicer or its cloud writes them, so a copy differing in them alone is the same.
const META = new Set(["from", "version", "updated_time", "setting_id", "base_id", "user_id"]);
// The cloud writes a value as one string, text in quotes (`"255"`, `"\"PLA\""`), where a slicer's
// file has a list (`["255"]`, `["PLA"]`): the same setting once unwrapped.
const plain = (v: unknown) =>
  (Array.isArray(v) ? v : [v]).map((x) =>
    typeof x === "string" ? x.replace(/^"(.*)"$/s, "$1") : x,
  );
const settings = (j: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(j)
      .filter(([k]) => !META.has(k))
      .map(([k, v]) => [k, plain(v)]),
  );

/** Off a hub, a server slicer's copy: in its `config/user`, where slicing finds it. */
const managedCopy = (
  dataDir: string,
  integrationId: string,
  kind: SlicerPresetKind,
  name: string,
) => join(folderOf(join(dataDir, "slicers", integrationId, "config"), kind), presetFileName(name));

/**
 * A copy gone from the account, if nothing uses it (ADR-0019). On a hub only the version this route
 * left goes: one edited since is someone's, and the edit wins. False = in use, try again later.
 */
function removeCopy(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  library: string,
  kind: SlicerPresetKind,
  name: string,
  placed: Placed,
  by: SavedBy,
) {
  if (presetUses(db, { library, kind, name }).length) return false;
  const row = namedPreset(db, { library, kind, name });
  if (row && !row.deleted && row.version === placed.version) deletePreset(db, dataDir, row.id, by);
  for (const id of zipFilled(db, adapters, library))
    rmSync(managedCopy(dataDir, id, kind, name), { force: true });
  return true;
}

/**
 * A run's copies for slicing (ADR-0019): the account's presets of `type` to the hub's library, or to
 * each server slicer's `config/user`. A desktop slicer's folder is never written. A preset changes
 * only when the account's copy did, and only if its settings did once flattened: a cloud copy drops
 * what equals its parent's. Copies gone from the account go if free, unless too many went at once
 * (or all of them: likely another account), which holds them for a person's Delete in the review.
 */
export async function placeCloudPresets(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  row: Row,
  { type, library }: { type: UserPresetType; library: string },
  note: (e: SyncLogEntry) => void,
) {
  const lib = adapters.find((a) => a.library?.id === library)?.library;
  if (!lib || !dataDir) return;
  const kind = kindOf(type);
  const dir = cloudPresetsDir(dataDir, row.id);
  const by: SavedBy = { device: row.adapterId };
  const prefs = readPreferences(db);
  const servers = zipFilled(db, adapters, library);
  const cursor = readCursor(db, row.id, type);
  const placed = { ...cursor.placed };
  const before = Object.keys(placed).filter((n) => !placed[n]?.held);
  const folder = folderOf(dir, kind);
  const flat = await lib.flattener?.(dir, kind);
  const resolved = async (j: Record<string, unknown>) =>
    presetSha(settings(flat ? await flat(j) : j));
  const listed = new Set<string>();
  for (const f of existsSync(folder) ? readdirSync(folder) : []) {
    const text = readFileSync(join(folder, f), "utf8");
    const json = parsePreset(text);
    if (typeof json?.name !== "string") continue;
    const name = json.name;
    listed.add(name);
    const sha = presetSha(json);
    const last = placed[name];
    if (prefs.hubEnabled) {
      // Nothing new from the account: a hub edit or delete since stays.
      if (last?.sha === sha) {
        placed[name] = { version: last.version, sha };
        continue;
      }
      const old = namedPreset(db, { library, kind, name });
      if (
        old &&
        !old.deleted &&
        (await resolved(json)) === (await resolved(JSON.parse(old.json)))
      ) {
        placed[name] = { version: old.version, sha };
        continue;
      }
      const base = last?.version ?? old?.version ?? 0;
      const r = uploadPreset(db, dataDir, { library, kind, name, base, text }, null, by);
      if (r.result !== "invalid") placed[name] = { version: r.version, sha };
      continue;
    }
    // A newer zip replaces `config/user`, so a copy it took away is written again.
    for (const id of servers) {
      const file = managedCopy(dataDir, id, kind, name);
      if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, text);
    }
    if (servers.length) placed[name] = { version: 0, sha };
  }
  const removed = before.filter((n) => !listed.has(n));
  // ponytail: the account has no id to tell another one by, so all of a kind gone at once holds.
  const hold =
    removed.length > prefs.hubDeleteGuard ||
    (removed.length > 1 && removed.length === before.length);
  if (hold) note({ event: "held", count: removed.length });
  for (const name of removed) {
    const p = placed[name];
    if (!p) continue;
    if (hold) placed[name] = { ...p, held: true };
    else if (removeCopy(db, dataDir, adapters, library, kind, name, p, by)) delete placed[name];
  }
  saveCursor(db, row.id, type, { ...cursor, placed });
}

/**
 * A person's Delete in the review of a row gone from the account: its copy for slicing goes too,
 * held or not, if nothing uses it. The caller has deleted the row.
 */
export function deleteCloudCopy(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  row: Row,
  type: UserPresetType,
  library: string,
  name: string,
) {
  const cursor = readCursor(db, row.id, type);
  const p = cursor.placed[name];
  if (!p) return;
  if (!removeCopy(db, dataDir, adapters, library, kindOf(type), name, p, { device: row.adapterId }))
    return;
  const { [name]: _, ...placed } = cursor.placed;
  saveCursor(db, row.id, type, { ...cursor, placed });
}
