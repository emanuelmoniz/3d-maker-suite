import type { ImportTarget, ImportValues } from "../schemas/import.ts";

export type ImportMatch = { candidates: string[]; targetId: string | null };

/** A name the way a person compares it: no case, no outer spaces. */
export const lower = (n: unknown) =>
  String(n ?? "")
    .trim()
    .toLowerCase();

/**
 * Per file row, the existing rows that fit, to what the review needs. Never guesses: a row is
 * suggested only when it is the single fit of exactly one file row, so four identical rolls are
 * left for a person.
 */
export function singleFits(fits: string[][]): ImportMatch[] {
  const claims = new Map<string, number>();
  for (const [only, more] of fits) if (only && !more) claims.set(only, (claims.get(only) ?? 0) + 1);
  return fits.map((candidates) => {
    const [only, more] = candidates;
    return { candidates, targetId: only && !more && claims.get(only) === 1 ? only : null };
  });
}

/** Targets by key, for lookups that stay fast with thousands of rows. */
function byKey(targets: ImportTarget[], key: (t: ImportTarget) => string) {
  const map = new Map<string, ImportTarget[]>();
  for (const t of targets) {
    const k = key(t);
    if (k) map.set(k, [...(map.get(k) ?? []), t]);
  }
  return map;
}

/**
 * A printer fits on its serial number; a file row without one (or with one you don't have) falls
 * back to the name, unless that printer has a different serial. Pass active printers only.
 */
export function matchPrinterRows(rows: ImportValues[], printers: ImportTarget[]): ImportMatch[] {
  const bySerial = byKey(printers, (t) => lower(t.values.serial));
  const byName = byKey(printers, (t) => lower(t.values.name));
  return singleFits(
    rows.map((r) => {
      const serial = lower(r.serial);
      const hit = serial ? bySerial.get(serial) : undefined;
      const named = (byName.get(lower(r.name)) ?? []).filter(
        (t) => !serial || !lower(t.values.serial),
      );
      return (hit ?? named).map((t) => t.id);
    }),
  );
}

/** Rows fit a target when these columns hold the same names (a brand, a brand + model, ...). */
export const matchRowsOn =
  (...keys: string[]) =>
  (rows: ImportValues[], targets: ImportTarget[]): ImportMatch[] => {
    const key = (v: ImportValues) => keys.map((k) => lower(v[k])).join("|");
    const byName = byKey(targets, (t) => key(t.values));
    return singleFits(rows.map((r) => (byName.get(key(r)) ?? []).map((t) => t.id)));
  };

const printKey = (v: ImportValues) => `${lower(v.printer)}|${v.startedAt ?? ""}|${lower(v.title)}`;

/** A print fits on its printer, its start time and its title. */
export function matchPrintRows(rows: ImportValues[], prints: ImportTarget[]): ImportMatch[] {
  const byPrint = byKey(prints, (t) => printKey(t.values));
  return singleFits(rows.map((r) => (byPrint.get(printKey(r)) ?? []).map((t) => t.id)));
}
