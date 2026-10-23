import type { WeightEntryKind } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { nextNumber } from "./numbers.ts";

const { spools, spoolWeightEntries } = schema;

/** The status a new weight gives a spool: empty at 0 g, in use once some is taken or refilled. */
const statusAt = (spool: typeof spools.$inferSelect, remainingGrams: number) => {
  if (remainingGrams <= 0) return "empty" as const;
  if (spool.status === "empty" || remainingGrams < (spool.remainingGrams ?? remainingGrams))
    return "in_use" as const;
  return spool.status;
};

/**
 * The only way to change `spools.remainingGrams`: sets it (and the status that follows, see
 * `statusAt`) and appends the ledger entry in one transaction. Returns the updated spool, or
 * `null` when the weight is unchanged (no entry). A spool whose weight wasn't known gets its
 * opening entry.
 */
export function setRemaining(
  db: Pick<Db, "transaction">,
  spoolId: string,
  kind: WeightEntryKind,
  remainingGrams: number,
  note?: string | null,
) {
  return db.transaction((tx) => {
    const spool = tx.select().from(spools).where(eq(spools.id, spoolId)).get();
    if (!spool) throw new Error(`Spool ${spoolId} not found`);
    const deltaGrams = remainingGrams - (spool.remainingGrams ?? 0);
    if (spool.remainingGrams != null && deltaGrams === 0) return null;
    tx.insert(spoolWeightEntries)
      .values({ spoolId, kind, deltaGrams, remainingAfter: remainingGrams, note })
      .run();
    return tx
      .update(spools)
      .set({ remainingGrams, status: statusAt(spool, remainingGrams) })
      .where(eq(spools.id, spoolId))
      .returning()
      .get();
  });
}

/**
 * Inserts a spool plus its opening ledger entry, so the ledger sums to the weight from day one.
 * Without a number it gets the next one (max + 1). No weight (null) = no entry until one is set.
 */
export function createSpool(
  db: Pick<Db, "transaction">,
  values: typeof spools.$inferInsert & { remainingGrams: number | null },
) {
  return db.transaction((tx) => {
    const spool = tx
      .insert(spools)
      .values({
        ...values,
        number: values.number ?? nextNumber(spools),
      })
      .returning()
      .get();
    if (values.remainingGrams != null)
      tx.insert(spoolWeightEntries)
        .values({
          spoolId: spool.id,
          kind: "manual",
          deltaGrams: values.remainingGrams,
          remainingAfter: values.remainingGrams,
        })
        .run();
    return spool;
  });
}

export const round = (g: number) => Math.round(g * 1000) / 1000;

/**
 * Takes `grams` from a spool through the ledger (kind "print"). Returns the spool's profile id,
 * or `null` with nothing booked when the spool is missing or holds less than `grams`. A spool
 * whose weight isn't known takes the print without booking anything.
 */
export function takeFromSpool(
  db: Pick<Db, "transaction">,
  spoolId: string,
  grams: number,
  title: string,
): string | null {
  return db.transaction((tx) => {
    const spool = tx.select().from(spools).where(eq(spools.id, spoolId)).get();
    if (!spool) return null;
    if (spool.remainingGrams == null) return spool.profileId;
    const remaining = round(spool.remainingGrams - grams);
    if (remaining < 0) return null;
    if (round(grams) !== 0) setRemaining(tx, spoolId, "print", remaining, title);
    return spool.profileId;
  });
}
