import type { Capability, IntegrationAdapter } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { isNull } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { profileColumns } from "../lib/catalog.ts";
import { capableRow, slicerConfigDir } from "./capabilities.ts";

const { filamentProfiles } = schema;

export const profileKey = (p: { brand: string; material: string; name: string }) =>
  [p.brand, p.material, p.name].map((v) => v.trim().toLowerCase()).join("|");

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
 * The active profiles, and the ones a vendor's spool could go on: those with the same brand,
 * material and name, else those named like a slicer preset of it ("PLA Basic" -> "Bambu PLA Basic").
 */
// ponytail: suffix match is a naive heuristic; match on the vendor's filament id if it misfires.
export function spoolProfiles(db: Db) {
  const active = db
    .select(profileColumns)
    .from(filamentProfiles)
    .where(isNull(filamentProfiles.archivedAt))
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
