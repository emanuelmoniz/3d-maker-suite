import { readFileSync } from "node:fs";
import { join, parse } from "node:path";
import { type ImportGone, isUserPresetType, type SlicerPresetKind } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { parsePreset, presetName } from "@3d-maker-suite/host";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { userPresetFiles } from "../integrations/presetLibrary.ts";
import { othersRoutes } from "../integrations/presetRoutes.ts";
import type { Rights } from "../lib/auth.ts";
import { type PresetKind, presetInUse } from "../lib/dependents.ts";
import { keyLibrary, type Review, type Stored } from "./review.ts";

const { importSnapshots } = schema;

/** The kind of preset each profile type holds. */
export const PRESET_KINDS: Record<PresetKind, SlicerPresetKind> = {
  filamentProfiles: "filament",
  machineProfiles: "machine",
  printProfiles: "process",
};
export const isPresetKind = (entity: string): entity is PresetKind => entity in PRESET_KINDS;

/** By `<kind>/<parent name>`: the names of the user presets in a slicer folder that inherit from it. */
function inheritors(dir: string) {
  const user = join(dir, "user");
  const out = new Map<string, string[]>();
  for (const f of userPresetFiles(user)) {
    let text: string;
    try {
      text = readFileSync(join(user, f.path), "utf8");
    } catch {
      // Gone since the listing.
      continue;
    }
    const json = parsePreset(text);
    if (typeof json?.inherits !== "string" || !json.inherits) continue;
    const key = `${f.kind}/${json.inherits}`;
    out.set(key, [...(out.get(key) ?? []), presetName(json, parse(f.file).name)]);
  }
  return out;
}

/** A preset's name in its key (`<library>:<scope>/<name>`). */
const nameOf = (source: string | null) => (source ?? "").slice((source ?? "").indexOf("/") + 1);

/** What uses a gone row, with the presets in `parents` (`inheritors`) that inherit from it. */
const usesOf = (
  db: Db,
  user: Rights | undefined,
  entity: PresetKind,
  row: { id: string; source: string | null },
  parents: Map<string, string[]>,
) =>
  presetInUse(
    db,
    user,
    entity,
    row.id,
    parents.get(`${PRESET_KINDS[entity]}/${nameOf(row.source)}`) ?? [],
  );

/**
 * Of the gone rows `ids` that were in use: the ones still in use, and the names of those free now.
 * One archived or deleted since drops out.
 */
export function freedRows(db: Db, entity: PresetKind, ids: string[], dir: string | null) {
  const t = schema[entity] as typeof schema.machineProfiles;
  const parents = dir ? inheritors(dir) : new Map<string, string[]>();
  const rows = db
    .select({ id: t.id, source: t.sourcePreset, name: t.name })
    .from(t)
    .where(and(inArray(t.id, ids), isNull(t.archivedAt)))
    .all();
  const used = rows.filter((r) => usesOf(db, undefined, entity, r, parents).length);
  return {
    still: used.map((r) => r.id),
    free: rows.filter((r) => !used.includes(r)).map((r) => r.name),
  };
}

/**
 * The catalog rows an integration's slicer brought whose preset it no longer has (ADR-0019), of the
 * review's scope: system presets, or the user preset type's. Each with what uses it.
 */
export function goneRows(db: Db, review: Review, stored: Stored, user?: Rights): ImportGone[] {
  const { entity, from } = stored;
  if (from?.kind !== "integration" || !isPresetKind(entity)) return [];
  const library = keyLibrary(stored.rows[0]?.source);
  // ponytail: a source that reads empty (moved, unreadable, an .opc version we can't read) is no
  // removal of everything, so a slicer with none left at all keeps its rows until one comes back.
  if (!library) return [];
  const scope = stored.type && isUserPresetType(stored.type) ? "user" : "system";
  const prefix = `${library}${scope}/`;
  // Loosely typed on purpose: the three tables share these columns.
  const t = schema[entity] as typeof schema.machineProfiles;
  // Another route's presets were left out of `stored`, not removed (ADR-0019).
  const there = new Set([
    ...stored.rows.map((r) => r.source),
    ...othersRoutes(db, from.integrationId, entity),
  ]);
  const rows = db
    .select({ id: t.id, source: t.sourcePreset })
    .from(t)
    .innerJoin(
      importSnapshots,
      and(
        eq(importSnapshots.rowId, t.id),
        eq(importSnapshots.integrationId, from.integrationId),
        eq(importSnapshots.entity, entity),
      ),
    )
    .where(and(isNull(t.archivedAt), like(t.sourcePreset, `${prefix}%`)))
    .all()
    .filter((r) => r.source?.startsWith(prefix) && !there.has(r.source));
  if (!rows.length) return [];
  const targets = new Map(review.handlers[entity].targets(db).map((r) => [r.id, r]));
  const parents = stored.dir ? inheritors(stored.dir) : new Map<string, string[]>();
  return rows.flatMap((r) => {
    const target = targets.get(r.id);
    if (!target) return [];
    return [
      {
        id: r.id,
        label: target.label,
        dependents: usesOf(db, user, entity, r, parents),
      },
    ];
  });
}
