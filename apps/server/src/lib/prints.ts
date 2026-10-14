import { type PrintUsageInput, usableOn } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { round, setRemaining, takeFromSpool } from "./spools.ts";

const { printFilamentUsages, printers, prints, spools } = schema;

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
 * A print that started before the spool was entered in the app: the weight entered then already
 * has its filament off, so the print only links the spool and books nothing.
 */
export const predates = (startedAt: string, spool: { createdAt: string }) =>
  startedAt < spool.createdAt;

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Refuses a print from before the spool was opened. The opening date is only ever the user's: one
 * filled in from a print would refuse the older prints a later import brings.
 */
export function assertOpened(spool: { openedAt: string | null }, startedAt: string) {
  if (!usableOn(spool, startedAt))
    throw new HttpError(400, "spool_not_opened", "The spool was opened after the print started");
}

/**
 * One imported slot onto a spool: takes the grams through the ledger, or only links an older
 * print. Returns the spool's profile id, or `null` with nothing booked when the spool holds less.
 * Throws for a print from before the spool was opened (`assertOpened`).
 */
export const bookOrLink = (
  tx: Tx,
  spool: { id: string; profileId: string; createdAt: string; openedAt: string | null },
  grams: number,
  title: string,
  startedAt: string,
) => {
  assertOpened(spool, startedAt);
  return predates(startedAt, spool) ? spool.profileId : takeFromSpool(tx, spool.id, grams, title);
};

/**
 * Replaces a print's filament rows and books the net difference per spool in the ledger
 * (append-only: an edit or delete adds a "print" entry, it never rewrites history).
 * With `ledger` false (a backlog import whose spools are already up to date) the rows are saved
 * but no spool weight is touched. With `startedAt`, a spool entered after the print started is
 * only linked (see `predates`).
 * Throws inside the caller's transaction, which rolls everything back.
 */
export const syncUsages = (
  tx: Tx,
  printId: string,
  title: string,
  /** `material` / `colorHex`: what an import reported for the slot, kept on the row. */
  next: (PrintUsageInput & { material?: string | null; colorHex?: string | null })[],
  ledger = true,
  startedAt?: string,
) => {
  const old = tx
    .select()
    .from(printFilamentUsages)
    .where(and(eq(printFilamentUsages.printId, printId), isNotNull(printFilamentUsages.spoolId)))
    .all();
  const net = new Map<string, number>(); // spoolId -> grams to give back (+) or take (-)
  if (ledger)
    for (const u of old) if (u.spoolId) net.set(u.spoolId, (net.get(u.spoolId) ?? 0) + u.grams);
  for (const u of next) net.set(u.spoolId, (net.get(u.spoolId) ?? 0) - (ledger ? u.grams : 0));

  const profileOf = new Map<string, string>();
  const print = tx.select().from(prints).where(eq(prints.id, printId)).get();
  const using = new Set(next.map((u) => u.spoolId));
  for (const [spoolId, grams] of net) {
    const spool = tx.select().from(spools).where(eq(spools.id, spoolId)).get();
    if (!spool) throw new HttpError(400, "invalid_spool", "Spool not found");
    profileOf.set(spoolId, spool.profileId);
    if (print && using.has(spoolId)) assertOpened(spool, print.startedAt);
    if (startedAt && predates(startedAt, spool)) continue;
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
          material: u.material ?? null,
          colorHex: u.colorHex ?? null,
        })),
      )
      .run();
};
