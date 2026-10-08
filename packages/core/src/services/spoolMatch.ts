export type SpoolCandidate = {
  id: string;
  material: string;
  /** `#rrggbb` of the spool. */
  colorHex: string;
  remainingGrams: number;
  createdAt: string;
};

export type SlotToMatch = {
  material?: string;
  colorHex?: string;
  grams: number;
  startedAt: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Picks the spool an imported print used, or `null` when a person has to decide.
 * Never guesses: it needs the vendor's material and colour, and exactly ONE spool with that exact
 * material + colour. Spools added after the print started can't have been used and are ignored.
 * The single match must also hold enough filament, otherwise booking it would fail.
 * Pass active spools only (not archived or empty).
 */
export function matchSpool(slot: SlotToMatch, spools: SpoolCandidate[]): string | null {
  const { material, colorHex } = slot;
  if (!material || !colorHex) return null;
  const hits = spools.filter(
    (s) =>
      s.createdAt <= slot.startedAt && same(s.material, material) && same(s.colorHex, colorHex),
  );
  const [only] = hits;
  return hits.length === 1 && only && only.remainingGrams >= slot.grams ? only.id : null;
}
