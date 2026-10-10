import type { ImportTarget, ImportValues } from "../schemas/import.ts";
import { type ImportMatch, lower, singleFits } from "./importMatch.ts";

const key = (v: ImportValues) => [v.brand, v.material, v.profile].map(lower).join("|");

/**
 * Per file row: the spools it could be, and the one to suggest. A spool fits when brand, material
 * and profile name are the same and, if the file gives a colour, the colour too. Never guesses:
 * a spool is suggested only when it is the single fit of exactly one file row, so four identical
 * rolls are left for a person. Pass active spools only.
 */
export function matchSpoolRows(rows: ImportValues[], spools: ImportTarget[]): ImportMatch[] {
  return singleFits(
    rows.map((r) =>
      spools
        .filter(
          (s) =>
            key(s.values) === key(r) && (r.colorHex == null || s.values.colorHex === r.colorHex),
        )
        .map((s) => s.id),
    ),
  );
}
