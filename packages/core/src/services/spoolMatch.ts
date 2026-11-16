export type SpoolCandidate = {
  id: string;
  number: number | null;
  material: string;
  /** `#rrggbb` of the spool. */
  colorHex: string;
  status: "new" | "in_use" | "empty";
  /** When it was bought, if known. */
  purchasedAt: string | null;
  openedAt: string | null;
  /** When it was entered in the app: an older print only links it, so needs none of its grams. */
  createdAt: string;
  /** Null = not known yet: the spool can take any slot. */
  initialGrams: number | null;
  remainingGrams: number | null;
};

export type SlotToMatch = {
  material?: string;
  colorHex?: string;
  grams: number;
  startedAt: string;
};

/** The spool picked for a slot; `sure` = the only one that fits, else a person should check it. */
export type SpoolMatch = { id: string | null; sure: boolean };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether a print that started at `startedAt` can have used the spool: not before the day it was
 * opened. By day, as the opening date is entered without a time. A spool not opened yet (no date)
 * can take any print.
 */
export const usableOn = (spool: { openedAt: string | null }, startedAt: string) =>
  !spool.openedAt || localDay(startedAt) >= spool.openedAt.slice(0, 10);

/**
 * The calendar day a moment falls on where the user lives (`YYYY-MM-DD`). A date typed without a
 * time is stored at noon UTC, so its first 10 characters are the day as typed; a print's start
 * is a real moment, and 00:31 on the 5th in Lisbon is still the 4th in UTC.
 */
export const localDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const opened = (s: SpoolCandidate) =>
  s.status === "in_use" ||
  (s.remainingGrams != null && s.initialGrams != null && s.remainingGrams < s.initialGrams);
/** Missing dates last. */
const byDate = (a: string | null, b: string | null) =>
  a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b);
/** The oldest first: opened before new, then by opening date, purchase date and number. */
const oldest = (a: SpoolCandidate, b: SpoolCandidate) =>
  Number(opened(b)) - Number(opened(a)) ||
  byDate(a.openedAt, b.openedAt) ||
  byDate(a.purchasedAt, b.purchasedAt) ||
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER);

/**
 * Picks the spool an imported print's slot used. It needs the vendor's material and colour, and a
 * spool with that exact material + colour that was there on the print's day (not bought or opened
 * later) and holds the slot's grams. One such spool is a sure match. Several: the first of them in `recent` (the spools the
 * printer used before, most likely first: a spool stays in the AMS until swapped), else the oldest;
 * not sure, so a person checks it. Pass active spools only (not archived or empty).
 */
export function matchSpool(
  slot: SlotToMatch,
  spools: SpoolCandidate[],
  recent: string[] = [],
): SpoolMatch {
  const { material, colorHex, startedAt } = slot;
  if (!material || !colorHex) return { id: null, sure: false };
  const day = localDay(startedAt);
  const hits = spools.filter(
    (s) =>
      (!s.purchasedAt || s.purchasedAt.slice(0, 10) <= day) &&
      usableOn(s, startedAt) &&
      (s.remainingGrams == null || s.remainingGrams >= slot.grams) &&
      same(s.material, material) &&
      same(s.colorHex, colorHex),
  );
  if (hits.length === 1) return { id: hits[0]?.id ?? null, sure: true };
  const last = recent.find((id) => hits.some((s) => s.id === id));
  return { id: last ?? [...hits].sort(oldest)[0]?.id ?? null, sure: false };
}

/**
 * `matchSpool` for every slot of one print. A spool goes to one slot only. Two slots of the same
 * material + colour are two spools (the AMS switched to a second roll when the first ran out), so
 * none of them is sure. `recent` gives the printer's recent spools for a slot (its AMS position).
 * A slot's `loaded` spool comes first (ADR-0015), when it is one of `spools`: sure, unless the
 * printer reported another material for the slot (then it is only a guess a person checks) or it
 * can't hold the grams (then nothing is picked).
 */
export function matchPrint(
  slots: (SlotToMatch & { slot?: number | null })[],
  spools: SpoolCandidate[],
  recent: (slot: number | null | undefined) => string[] = () => [],
  loaded: (slot: number | null | undefined) => string | undefined = () => undefined,
): SpoolMatch[] {
  // ponytail: the printer's own spool id / RFID would come before the loaded spool; no spool
  // stores one yet (Spoolman's ids arrive with its two-way sync).
  const loadedOf = (s: { slot?: number | null }) => {
    const id = loaded(s.slot);
    return id ? spools.find((c) => c.id === id) : undefined;
  };
  const taken = new Set(slots.flatMap((s) => loadedOf(s)?.id ?? []));
  const key = (s: SlotToMatch) => `${s.material?.toLowerCase()}|${s.colorHex?.toLowerCase()}`;
  return slots.map((s, i) => {
    const l = loadedOf(s);
    if (l)
      return l.remainingGrams == null || l.remainingGrams >= s.grams
        ? { id: l.id, sure: !s.material || same(l.material, s.material) }
        : { id: null, sure: false };
    const m = matchSpool(
      s,
      spools.filter((c) => !taken.has(c.id)),
      recent(s.slot),
    );
    if (m.id) taken.add(m.id);
    const twin = slots.some((o, j) => j !== i && key(o) === key(s));
    return twin ? { ...m, sure: false } : m;
  });
}
