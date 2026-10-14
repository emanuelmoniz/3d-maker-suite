export type SpoolCandidate = {
  id: string;
  material: string;
  /** `#rrggbb` of the spool. */
  colorHex: string;
  /** When it was bought, if known. */
  purchasedAt: string | null;
};

export type SlotToMatch = {
  material?: string;
  colorHex?: string;
  startedAt: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Picks the spool an imported print used, or `null` when a person has to decide.
 * Never guesses: it needs the vendor's material and colour, and exactly ONE spool with that exact
 * material + colour. A spool bought after the print's day can't have been used and is ignored
 * (when the app was set up is no clue: spools are often entered long after they were bought).
 * Pass active spools only (not archived or empty). Whether it holds enough is the booking's call.
 */
export function matchSpool(slot: SlotToMatch, spools: SpoolCandidate[]): string | null {
  const { material, colorHex } = slot;
  if (!material || !colorHex) return null;
  const day = slot.startedAt.slice(0, 10);
  const hits = spools.filter(
    (s) =>
      (!s.purchasedAt || s.purchasedAt.slice(0, 10) <= day) &&
      same(s.material, material) &&
      same(s.colorHex, colorHex),
  );
  return hits.length === 1 ? (hits[0]?.id ?? null) : null;
}
