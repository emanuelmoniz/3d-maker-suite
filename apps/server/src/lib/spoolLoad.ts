import type { SpoolLoader } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq } from "drizzle-orm";

const { spools } = schema;

/** A spool out of every printer slot. */
export const UNLOADED = {
  loadedPrinterId: null,
  loadedSlot: null,
  loadedAt: null,
  loadedBy: null,
} as const;

/**
 * Puts a spool in a printer slot (ADR-0015), or empties the slot with `null`: whatever was there
 * leaves it, and the spool leaves the slot it was in (one place at a time). `by` says who: you
 * (`PUT /printers/:id/slots`) or the printer's reading of the slot (`autoLoad`, Step 19b). A spool
 * already there keeps its `loadedAt`, so the prints since still charge it; one you confirm becomes
 * yours. False when nothing changed.
 */
export function loadSpool(
  db: Db,
  printerId: string,
  slot: number,
  spoolId: string | null,
  by: SpoolLoader,
): boolean {
  const inSlot = and(eq(spools.loadedPrinterId, printerId), eq(spools.loadedSlot, slot));
  const there = db.select({ id: spools.id, by: spools.loadedBy }).from(spools).where(inSlot).get();
  if (there?.id === spoolId) {
    if (!spoolId || by !== "user" || there?.by === "user") return false;
    db.update(spools).set({ loadedBy: "user" }).where(eq(spools.id, spoolId)).run();
    return true;
  }
  db.transaction((tx) => {
    tx.update(spools).set(UNLOADED).where(inSlot).run();
    if (spoolId)
      tx.update(spools)
        .set({
          loadedPrinterId: printerId,
          loadedSlot: slot,
          loadedAt: new Date().toISOString(),
          loadedBy: by,
        })
        .where(eq(spools.id, spoolId))
        .run();
  });
  return true;
}
