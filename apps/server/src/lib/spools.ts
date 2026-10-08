import type { WeightEntryKind } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";

const { spools, spoolWeightEntries } = schema;

/**
 * The only way to change `spools.remainingGrams`: sets it and appends the ledger entry in one
 * transaction. Returns the updated spool, or `null` when the weight is unchanged (no entry).
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
    const deltaGrams = remainingGrams - spool.remainingGrams;
    if (deltaGrams === 0) return null;
    tx.insert(spoolWeightEntries)
      .values({ spoolId, kind, deltaGrams, remainingAfter: remainingGrams, note })
      .run();
    return tx
      .update(spools)
      .set({ remainingGrams })
      .where(eq(spools.id, spoolId))
      .returning()
      .get();
  });
}
