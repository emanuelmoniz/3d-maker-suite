import { type ExternalPrinter, printerOfSource } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, isNotNull } from "drizzle-orm";

// One printer, several sources (ADR-0015): the printer row keeps the source that brought it in,
// and a later source of the same serial (Bambu LAN next to Bambu Cloud) is linked to it in
// `printer_sources` instead of importing the printer twice.

const { printers, printerSources } = schema;

/** `<integrationId>:<externalId>` → printer id, for every source of every printer. */
export function sourcePrinters(db: Db): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of db
    .select({ id: printers.id, integrationId: printers.integrationId, ext: printers.externalId })
    .from(printers)
    .where(isNotNull(printers.externalId))
    .all())
    if (p.integrationId) out.set(`${p.integrationId}:${p.ext}`, p.id);
  for (const l of db.select().from(printerSources).all())
    out.set(`${l.integrationId}:${l.externalId}`, l.printerId);
  return out;
}

/** The printers a source names, by its own id: those it brought in and those linked to it. */
export function printersOfSource(db: Db, integrationId: string): Map<string, string> {
  const out = new Map(
    db
      .select({ ext: printerSources.externalId, id: printerSources.printerId })
      .from(printerSources)
      .where(eq(printerSources.integrationId, integrationId))
      .all()
      .map((l) => [l.ext, l.id]),
  );
  for (const p of db
    .select({ id: printers.id, ext: printers.externalId })
    .from(printers)
    .where(eq(printers.integrationId, integrationId))
    .all())
    if (p.ext) out.set(p.ext, p.id);
  return out;
}

/**
 * The printers a source offers that are its own to import. One another source brought in (same
 * serial) is linked to that printer here and left out, so it is never imported twice and its
 * values stay the first source's. A printer added by hand with the serial is linked on create,
 * as before (`printerImport.create`).
 */
export function linkSourcePrinters(
  db: Db,
  integrationId: string,
  items: ExternalPrinter[],
): ExternalPrinter[] {
  const linked = printersOfSource(db, integrationId);
  const all = db
    .select({
      id: printers.id,
      integrationId: printers.integrationId,
      externalId: printers.externalId,
      serial: printers.serial,
    })
    .from(printers)
    .all();
  return items.filter((p) => {
    const known = linked.get(p.externalId);
    if (known) return all.some((o) => o.id === known && o.integrationId === integrationId);
    const twin = printerOfSource(all, { integrationId, ...p });
    // Its own row, one added by hand, or none: imported as before.
    if (!twin?.integrationId || twin.integrationId === integrationId) return true;
    db.insert(printerSources)
      .values({ printerId: twin.id, integrationId, externalId: p.externalId })
      .onConflictDoNothing()
      .run();
    return false;
  });
}
