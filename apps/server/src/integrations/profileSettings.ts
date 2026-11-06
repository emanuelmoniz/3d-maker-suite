import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IntegrationAdapter, ProfileSettings } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { parsePreset } from "@3d-maker-suite/host";
import { asc, eq } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { inheritors, PRESET_KINDS } from "../import/gone.ts";
import type { Rights } from "../lib/auth.ts";
import { type PresetKind, presetInUse } from "../lib/dependents.ts";
import { readPreferences } from "../lib/preferences.ts";
import { catalogDir, policyOf } from "./capabilities.ts";
import { cloudPresetsDir } from "./cloudPresets.ts";
import { namedPreset } from "./presetLibrary.ts";

/** The sync type that brings a profile kind's user presets. */
const USER_TYPE = {
  filamentProfiles: "userFilamentProfiles",
  machineProfiles: "userMachineProfiles",
  printProfiles: "userPrintProfiles",
} as const;

const TABLES = {
  filamentProfiles: schema.filamentProfiles,
  machineProfiles: schema.machineProfiles,
  printProfiles: schema.printProfiles,
};

/** The row's `<library>:<scope>/<name>`, or an error if the row isn't there. */
function sourceOf(db: Db, kind: PresetKind, id: string) {
  const table = TABLES[kind];
  const row = db.select({ s: table.sourcePreset }).from(table).where(eq(table.id, id)).get();
  if (!row) throw new HttpError(404, "not_found", "Profile not found");
  return row.s;
}

/**
 * Where a profile's slicer files can be read on this server, best first: each row's folder (its
 * install, a managed slicer's config), then a Bambu Cloud account's copy. A hub's library is read
 * by name (`namedPreset`), not from a folder.
 */
function foldersOf(db: Db, dataDir: string, adapters: IntegrationAdapter[], library: string) {
  const rows = db
    .select()
    .from(schema.integrations)
    .orderBy(asc(schema.integrations.createdAt))
    .all();
  const dirs = rows.flatMap((row) => {
    const adapter = adapters.find((a) => a.id === row.adapterId);
    const dir = adapter?.library?.id === library ? catalogDir(db, dataDir, row, adapter) : null;
    return dir ? [dir] : [];
  });
  const cloud = rows.map((r) => (dataDir ? cloudPresetsDir(dataDir, r.id) : "")).filter(existsSync);
  return { rows, dirs: [...new Set([...dirs, ...cloud])] };
}

/**
 * Every setting of a profile's file, parents filled in (ADR-0020), read when asked: from the
 * slicer's folder on this server, the hub's library for a user preset, or a Bambu Cloud copy. A
 * source that can't be read says why instead of failing.
 */
export async function profileSettings(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  kind: PresetKind,
  id: string,
): Promise<ProfileSettings> {
  const source = sourceOf(db, kind, id);
  const no = (reason: "hand_made" | "no_source" | "not_found"): ProfileSettings => ({
    status: "unreadable",
    reason,
    source,
    parents: [],
    missing: null,
    settings: [],
    waiting: null,
  });
  const m = /^([^:]+):(system|user)\/(.+)$/.exec(source ?? "");
  if (!m) return no("hand_made");
  const [, library = "", scope = "", name = ""] = m;
  const lib = adapters.find((a) => a.library?.id === library)?.library;
  if (!lib?.settings) return no("no_source");

  const presetKind = PRESET_KINDS[kind];
  const ref = { scope: scope as "system" | "user", name };
  const { rows, dirs } = foldersOf(db, dataDir, adapters, library);
  // Parents come from the first folder that has system presets; a hub's own copy is the user preset.
  const withSystem = dirs.filter((d) => existsSync(join(d, "system")));
  const hubRow =
    scope === "user" && readPreferences(db).hubEnabled
      ? namedPreset(db, { library, kind: presetKind, name })
      : undefined;
  const own = hubRow && !hubRow.deleted ? parsePreset(hubRow.json) : undefined;

  let found = own
    ? await lib.settings(withSystem[0] ?? dirs[0] ?? "", presetKind, ref, own)
    : undefined;
  const searched = scope === "system" ? withSystem : dirs;
  for (const d of found ? [] : searched) {
    found = await lib.settings(d, presetKind, ref);
    if (found) break;
  }
  if (!found) return no(searched.length ? "not_found" : "no_source");

  // ponytail: the type's count, not this row's; the review lists which rows changed.
  const type = scope === "user" ? USER_TYPE[kind] : kind;
  const waiting = rows
    .filter((r) => adapters.find((a) => a.id === r.adapterId)?.library?.id === library)
    .map((r) => ({ integrationId: r.id, type, count: policyOf(db, r.id, type).pending }))
    .find((w) => w.count > 0);
  return { status: "ok", reason: null, source, ...found, waiting: waiting ?? null };
}

/**
 * Where a profile is used (`presetInUse`), with the presets in the slicer's folders that inherit
 * from it when that folder is on this server.
 */
export function profileUse(
  db: Db,
  dataDir: string,
  adapters: IntegrationAdapter[],
  user: Rights | undefined,
  kind: PresetKind,
  id: string,
) {
  const source = sourceOf(db, kind, id);
  const m = /^([^:]+):[^/]+\/(.+)$/.exec(source ?? "");
  const dir = m && foldersOf(db, dataDir, adapters, m[1] ?? "").dirs[0];
  const inherited = (dir && m && inheritors(dir).get(`${PRESET_KINDS[kind]}/${m[2]}`)) || [];
  return presetInUse(db, user, kind, id, inherited);
}
