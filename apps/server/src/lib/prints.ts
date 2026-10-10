import type { PrintUsageInput } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { round, setRemaining } from "./spools.ts";

const { printFilamentUsages, printers, spools } = schema;

/** An explicit energy value is "measured". Otherwise estimate from printer power x duration. */
export const energyFor = (
  db: Db,
  printerId: string,
  durationSec: number | null,
  override: number | null | undefined,
) => {
  if (override != null) return { energyWh: override, energySource: "measured" as const };
  const powerW = db.select().from(printers).where(eq(printers.id, printerId)).get()?.powerW;
  return powerW && durationSec
    ? { energyWh: (powerW * durationSec) / 3600, energySource: "estimated" as const }
    : { energyWh: null, energySource: null };
};

/**
 * Replaces a print's filament rows and books the net difference per spool in the ledger
 * (append-only: an edit or delete adds a "print" entry, it never rewrites history).
 * Throws inside the caller's transaction, which rolls everything back.
 */
export const syncUsages = (
  tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0],
  printId: string,
  title: string,
  next: PrintUsageInput[],
) => {
  const old = tx
    .select()
    .from(printFilamentUsages)
    .where(and(eq(printFilamentUsages.printId, printId), isNotNull(printFilamentUsages.spoolId)))
    .all();
  const net = new Map<string, number>(); // spoolId -> grams to give back (+) or take (-)
  for (const u of old) if (u.spoolId) net.set(u.spoolId, (net.get(u.spoolId) ?? 0) + u.grams);
  for (const u of next) net.set(u.spoolId, (net.get(u.spoolId) ?? 0) - u.grams);

  const profileOf = new Map<string, string>();
  for (const [spoolId, grams] of net) {
    const spool = tx.select().from(spools).where(eq(spools.id, spoolId)).get();
    if (!spool) throw new HttpError(400, "invalid_spool", "Spool not found");
    profileOf.set(spoolId, spool.profileId);
    const remaining = round(spool.remainingGrams + grams);
    if (remaining < 0)
      throw new HttpError(400, "insufficient_filament", "Spool has less filament than used");
    if (round(grams) !== 0) setRemaining(tx, spoolId, "print", remaining, title);
  }
  // Slots without a spool (the review queue) are kept: the edit form doesn't show them.
  tx.delete(printFilamentUsages)
    .where(and(eq(printFilamentUsages.printId, printId), isNotNull(printFilamentUsages.spoolId)))
    .run();
  if (next.length)
    tx.insert(printFilamentUsages)
      .values(
        next.map((u) => ({
          printId,
          spoolId: u.spoolId,
          profileId: profileOf.get(u.spoolId),
          grams: u.grams,
          slot: u.slot ?? null,
        })),
      )
      .run();
};
