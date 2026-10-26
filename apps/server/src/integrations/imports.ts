import type { Capability, IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, isNull, like, or } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { profileColumns } from "../lib/catalog.ts";
import { capableRow, slicerConfigDir } from "./capabilities.ts";

const { filamentProfiles } = schema;

export const profileKey = (p: { brand: string; material: string; name: string }) =>
  [p.brand, p.material, p.name].map((v) => v.trim().toLowerCase()).join("|");

/**
 * A vendor's short name as the catalog spells it: the same name, else the one catalog name that
 * ends with it (cloud "A1" -> Studio "Bambu Lab A1", "PLA Basic" -> "Bambu PLA Basic").
 * `candidates`: the catalog's names of the same brand (and material). No single fit = `name`.
 */
// ponytail: suffix match is a naive heuristic; match on the vendor's filament id if it misfires.
export function catalogName(name: string, candidates: string[]) {
  const n = name.trim().toLowerCase();
  if (!n) return name;
  const same = candidates.find((c) => c.trim().toLowerCase() === n);
  if (same) return same;
  // The same name from two slicers is one name.
  const tail = [...new Set(candidates.filter((c) => c.trim().toLowerCase().endsWith(` ${n}`)))];
  return tail.length === 1 ? (tail[0] ?? name) : name;
}

/** An integration's slicer library and its config folder, if it can do `cap` right now. */
export function libraryOf(
  db: Db,
  adapters: IntegrationAdapter[],
  integrationId: string,
  cap: Capability,
) {
  const { row, adapter } = capableRow(db, adapters, integrationId, cap);
  const dir = slicerConfigDir(row, adapter);
  const lib = adapter.library;
  if (!dir || !lib) throw new HttpError(404, "library_not_found", "Slicer config folder not found");
  return { lib, dir };
}

/**
 * The profiles a vendor's spool could go on: Bambu Studio's (local or server, one library) or made
 * by hand, never another slicer's. `fits`: those with the same brand, material and name, else those
 * named like a slicer preset of it ("PLA Basic" -> "Bambu PLA Basic").
 */
// ponytail: only Bambu Cloud has spools; give the adapter a library id when a second vendor does.
// ponytail: suffix match is a naive heuristic; match on the vendor's filament id if it misfires.
export function spoolProfiles(db: Db) {
  const active = db
    .select(profileColumns)
    .from(filamentProfiles)
    .where(
      and(
        isNull(filamentProfiles.archivedAt),
        or(
          isNull(filamentProfiles.sourcePreset),
          like(filamentProfiles.sourcePreset, "bambu-studio:%"),
        ),
      ),
    )
    .all();
  return {
    active,
    fits(s: { brand: string; material: string; name: string }) {
      const same = active.filter((p) => profileKey(p) === profileKey(s));
      if (same.length) return same;
      return active.filter(
        (p) =>
          profileKey({ ...p, name: "" }) === profileKey({ ...s, name: "" }) &&
          p.name.toLowerCase().endsWith(` ${s.name.trim().toLowerCase()}`),
      );
    },
  };
}
