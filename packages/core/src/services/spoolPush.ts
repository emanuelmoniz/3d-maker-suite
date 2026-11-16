// What a spool library (Spoolman) should hold per print slot, against what was sent to it
// (`spoolUsage`). Pure: the server reads the rows, calls the source for each difference, and stores
// what went through. A difference is sent until it goes through, so a retry or a restart never
// charges twice, and an edit or a delete of a print sends only the change.

/** A charged slot on an app spool that is linked to the library's spool `vendorSpoolId`. */
export type PushUsage = {
  printId: string;
  slot: number | null;
  appSpoolId: string;
  vendorSpoolId: string;
  grams: number;
};

/** What the library holds for a key, as last confirmed. */
export type PushSent = {
  key: string;
  vendorSpoolId: string;
  appSpoolId: string;
  sentGrams: number;
};

export type PushTarget = {
  key: string;
  vendorSpoolId: string;
  appSpoolId: string;
  /** What the library's spool should hold for the key; 0 gives back what was sent. */
  grams: number;
  sent: number;
};

/** One print slot: the idempotency key a write carries (ADR-0015). */
export const pushKey = (printId: string, slot: number | null) => `${printId}:${slot ?? "-"}`;

const round = (n: number) => Math.round(n * 100) / 100;
const pair = (key: string, vendorSpoolId: string) => `${key}\u0000${vendorSpoolId}`;

/**
 * The writes to make: each (key, library spool) whose grams differ from what was sent. `linked`
 * gives an app spool's library spool now. A sent row whose app spool isn't linked to that library
 * spool any more is dropped without a write (`drop`): a link that changes gives nothing back, only
 * a print that changes does.
 */
export function pushTargets(
  usages: PushUsage[],
  sent: PushSent[],
  linked: (appSpoolId: string) => string | undefined,
): { targets: PushTarget[]; drop: PushSent[] } {
  const want = new Map<string, Omit<PushTarget, "sent">>();
  for (const u of usages) {
    const key = pushKey(u.printId, u.slot);
    const k = pair(key, u.vendorSpoolId);
    const w = want.get(k);
    want.set(k, {
      key,
      vendorSpoolId: u.vendorSpoolId,
      appSpoolId: u.appSpoolId,
      grams: round((w?.grams ?? 0) + u.grams),
    });
  }
  const drop: PushSent[] = [];
  const had = new Map<string, PushSent>();
  for (const s of sent) {
    if (linked(s.appSpoolId) !== s.vendorSpoolId && !want.has(pair(s.key, s.vendorSpoolId)))
      drop.push(s);
    else had.set(pair(s.key, s.vendorSpoolId), s);
  }
  const targets: PushTarget[] = [];
  for (const [k, w] of want) {
    const sentGrams = had.get(k)?.sentGrams ?? 0;
    if (round(sentGrams) !== w.grams) targets.push({ ...w, sent: sentGrams });
  }
  for (const [k, s] of had)
    if (!want.has(k) && round(s.sentGrams) !== 0)
      targets.push({
        key: s.key,
        vendorSpoolId: s.vendorSpoolId,
        appSpoolId: s.appSpoolId,
        grams: 0,
        sent: s.sentGrams,
      });
  return { targets, drop };
}
