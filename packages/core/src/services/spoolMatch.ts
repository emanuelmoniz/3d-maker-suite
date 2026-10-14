export type SpoolCandidate = {
  id: string;
  material: string;
  /** `#rrggbb` of the spool. */
  colorHex: string;
  /** When it was bought, if known. */
  purchasedAt: string | null;
  openedAt: string | null;
  initialGrams: number;
  remainingGrams: number;
};

export type SlotToMatch = {
  material?: string;
  colorHex?: string;
  startedAt: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether a print that started at `startedAt` can have used the spool: not before the day it was
 * opened. By day, as the opening date is entered without a time. A spool not opened yet (no date)
 * can take any print.
 */
export const usableOn = (spool: { openedAt: string | null }, startedAt: string) =>
  !spool.openedAt || startedAt.slice(0, 10) >= spool.openedAt.slice(0, 10);

/**
 * Picks the spool an imported print used, or `null` when a person has to decide.
 * It needs the vendor's material and colour, and a spool with that exact material + colour. A spool
 * bought after the print's day can't have been used and is ignored (when the app was set up is no
 * clue: spools are often entered long after they were bought). Several spools of that colour: the
 * first of them in `recent` (the spools the printer used before, most likely first: a spool stays
 * in the AMS until swapped), else the only one already opened; else a person decides.
 * Pass active spools only (not archived or empty). Whether it holds enough is the booking's call.
 */
export function matchSpool(
  slot: SlotToMatch,
  spools: SpoolCandidate[],
  recent: string[] = [],
): string | null {
  const { material, colorHex } = slot;
  if (!material || !colorHex) return null;
  const day = slot.startedAt.slice(0, 10);
  const hits = spools.filter(
    (s) =>
      (!s.purchasedAt || s.purchasedAt.slice(0, 10) <= day) &&
      usableOn(s, slot.startedAt) &&
      same(s.material, material) &&
      same(s.colorHex, colorHex),
  );
  if (hits.length === 1) return hits[0]?.id ?? null;
  const last = recent.find((id) => hits.some((s) => s.id === id));
  if (last) return last;
  // ponytail: "opened" is today's state, not the print's day; an old print may get a spool opened
  // since. Fine for a sync of recent prints; the review shows it either way.
  const opened = hits.filter((s) => s.remainingGrams < s.initialGrams);
  return opened.length === 1 ? (opened[0]?.id ?? null) : null;
}
