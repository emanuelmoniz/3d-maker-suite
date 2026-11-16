import type { ReviewPolicy } from "../schemas/enums.ts";

/** The level that applies to a print: the most specific one set (ADR-0015). Null = follow the level above. */
export const reviewPolicyOf = (l: {
  printer?: ReviewPolicy | null;
  source?: ReviewPolicy | null;
  global: ReviewPolicy;
}): ReviewPolicy => l.printer ?? l.source ?? l.global;

/** One slot of a print recorded automatically, as the spool chain left it (`matchPrint`). */
export type ReviewSlot = {
  /** The spool the chain picked; null = none. */
  spoolId: string | null;
  /** The only spool that fits. False: a guess among several, or a loaded spool that contradicts the printer. */
  sure: boolean;
  /** `estimated`: a total scaled by how far a stopped print got. `none`: no source had any. */
  grams: "real" | "estimated" | "none";
};

export type SlotOutcome =
  | { action: "charge"; spoolId: string }
  /** Waits in Filament to review; the suggestion charges nothing until a person accepts it. */
  | { action: "wait"; suggestedSpoolId: string | null }
  /** Written as not tracked (`dismissed`): nothing waits. */
  | { action: "dismiss" };

/** What happens to a slot under a review level (ADR-0015; the table in PLAN 6.0.0 Step 6). */
export function slotOutcome(policy: ReviewPolicy, slot: ReviewSlot): SlotOutcome {
  const { spoolId, grams } = slot;
  const sure = !!spoolId && slot.sure && grams !== "none";
  const charge = policy === "never" ? sure : policy === "unmatched" && sure && grams === "real";
  if (spoolId && charge) return { action: "charge", spoolId };
  return policy === "never" ? { action: "dismiss" } : { action: "wait", suggestedSpoolId: spoolId };
}
