import type { ImportTarget, ImportValues } from "../schemas/import.ts";
import { type ImportMatch, lower, singleFits } from "./importMatch.ts";

const key = (v: ImportValues) => [v.brand, v.material, v.name].map(lower).join("|");

/**
 * Per file row: the spools it could be, and the one to suggest. A row with a number fits the spool
 * with that number only. Otherwise a spool fits when brand, material and name are the same
 * and, if the file gives a colour, the colour too. Never guesses: a spool is suggested only when it
 * is the single fit of exactly one file row, so four identical rolls are left for a person. Pass
 * active spools only.
 *
 * `elsewhere`: spools another spool library brought in. Each library names a filament its own way
 * ("Bambu" / "Bambu Lab", "Basic PLA" / "PLA Basic"), so against those a row fits on material and
 * colour alone; the review leaves such a match for a person to confirm.
 */
export function matchSpoolRows(
  rows: ImportValues[],
  spools: ImportTarget[],
  elsewhere: ReadonlySet<string> = new Set(),
): ImportMatch[] {
  const sameFilament = (s: ImportTarget, r: ImportValues) =>
    elsewhere.has(s.id)
      ? lower(s.values.material) === lower(r.material) && r.colorHex != null
      : key(s.values) === key(r);
  return singleFits(
    rows.map((r) =>
      spools
        .filter((s) =>
          r.number != null
            ? s.values.number === r.number
            : sameFilament(s, r) && (r.colorHex == null || s.values.colorHex === r.colorHex),
        )
        .map((s) => s.id),
    ),
  );
}
