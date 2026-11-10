import type { Capability, IntegrationAdapter } from "@3d-maker-suite/core";
import type { Db } from "@3d-maker-suite/db";
import { HttpError } from "../errors.ts";
import { capableRow, catalogDir } from "./capabilities.ts";

export const presetKey = (p: { brand: string; material: string; name: string }) =>
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
  dataDir: string,
) {
  const { row, adapter } = capableRow(db, adapters, integrationId, cap);
  const dir = catalogDir(db, dataDir, row, adapter);
  const lib = adapter.library;
  if (!dir || !lib) throw new HttpError(404, "library_not_found", "Slicer config folder not found");
  return { lib, dir };
}
