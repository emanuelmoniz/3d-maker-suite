import {
  type ExternalPrinter,
  type ImportValues,
  type IntegrationAdapter,
  isNetworkPrinter,
  PRINTER_SERIAL_FIELD,
  type PrinterChoice,
  printerOfSource,
  readsPrinterSerial,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { HttpError } from "../errors.ts";
import { printerImport } from "../import/printers.ts";
import { printerRows } from "./sourceRows.ts";

// One printer, several sources (ADR-0015): the printer row keeps the source that brought it in,
// and a later source of the same serial (Bambu LAN next to Bambu Cloud) is linked to it in
// `printer_sources` instead of importing the printer twice.

const { integrations, printers, printerSources } = schema;

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
 * The printers whose enabled sources all give no live status (Bambu Cloud alone): "Synced only" in
 * Monitoring, not "Not monitored". A printer with no enabled source, or a paused one only, isn't here.
 */
export function syncOnlyPrinters(
  db: Db,
  adapters: Pick<IntegrationAdapter, "id" | "capabilities">[],
): Set<string> {
  const live = new Set(
    adapters.filter((a) => a.capabilities.includes("printerStatus")).map((a) => a.id),
  );
  const enabled = new Map<string, boolean[]>();
  const add = (printerId: string | null, adapterId: string, on: boolean) => {
    if (printerId && on)
      enabled.set(printerId, [...(enabled.get(printerId) ?? []), live.has(adapterId)]);
  };
  for (const r of db
    .select({ id: printers.id, adapterId: integrations.adapterId, on: integrations.enabled })
    .from(printers)
    .innerJoin(integrations, eq(integrations.id, printers.integrationId))
    .all())
    add(r.id, r.adapterId, r.on);
  for (const r of db
    .select({
      id: printerSources.printerId,
      adapterId: integrations.adapterId,
      on: integrations.enabled,
    })
    .from(printerSources)
    .innerJoin(integrations, eq(integrations.id, printerSources.integrationId))
    .all())
    add(r.id, r.adapterId, r.on);
  return new Set([...enabled].filter(([, lives]) => !lives.includes(true)).map(([id]) => id));
}

/** A printer's sources: the one that brought it in first, then the ones linked to it. */
export function sourcesOfPrinter(db: Db, printerId: string) {
  const own = db
    .select({ integrationId: integrations.id, adapterId: integrations.adapterId })
    .from(printers)
    .innerJoin(integrations, eq(integrations.id, printers.integrationId))
    .where(eq(printers.id, printerId))
    .all();
  const linked = db
    .select({ integrationId: integrations.id, adapterId: integrations.adapterId })
    .from(printerSources)
    .innerJoin(integrations, eq(integrations.id, printerSources.integrationId))
    .where(eq(printerSources.printerId, printerId))
    .all();
  return [...own, ...linked.filter((l) => !own.some((o) => o.integrationId === l.integrationId))];
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

/**
 * The printer each printer on the network is (ADR-0015, one per source): integration id → printer
 * id. A link in `printer_sources` wins over a printer it brought in before 6.0.0.
 */
export function networkPrinters(db: Db, adapters: IntegrationAdapter[]): Map<string, string> {
  const ids = db
    .select({ id: integrations.id, adapterId: integrations.adapterId })
    .from(integrations)
    .all()
    .filter((r) => isNetworkPrinter(adapters.find((a) => a.id === r.adapterId)))
    .map((r) => r.id);
  const out = new Map<string, string>();
  if (!ids.length) return out;
  for (const p of db
    .select({ id: printers.id, integrationId: printers.integrationId })
    .from(printers)
    .where(inArray(printers.integrationId, ids))
    .all())
    if (p.integrationId) out.set(p.integrationId, p.id);
  for (const l of db
    .select()
    .from(printerSources)
    .where(inArray(printerSources.integrationId, ids))
    .all())
    out.set(l.integrationId, l.printerId);
  return out;
}

const printerOf = (db: Db, id: string) =>
  db.select().from(printers).where(eq(printers.id, id)).get();

/** The printer a source on the network is linked to, if any. */
export function linkedPrinter(db: Db, integrationId: string) {
  const link = db
    .select({ id: printerSources.printerId })
    .from(printerSources)
    .where(eq(printerSources.integrationId, integrationId))
    .get();
  return link
    ? printerOf(db, link.id)
    : db.select().from(printers).where(eq(printers.integrationId, integrationId)).get();
}

/**
 * A source's config as its adapter reads it. A source that names its printer by serial (Bambu LAN)
 * reads it from its printer: `printerId` (the form's pick), else the one it is linked to. The serial
 * it was set up with before 6.0.0 is the fallback until it has one.
 */
export function sourceConfig(
  db: Db,
  row: { id?: string; config: unknown },
  adapter: IntegrationAdapter,
  printerId?: PrinterChoice,
): Record<string, unknown> {
  const config = { ...(row.config as Record<string, unknown>) };
  if (!readsPrinterSerial(adapter) || printerId === "new") return config;
  const printer = printerId
    ? printerOf(db, printerId)
    : row.id
      ? linkedPrinter(db, row.id)
      : undefined;
  const serial = printer?.serial?.trim();
  if (serial) config[PRINTER_SERIAL_FIELD] = serial;
  return config;
}

/** What a test found, with the source's own id of it: what a link is made from. */
export type FoundLink = Omit<ExternalPrinter, "nozzleDiameterMm">;

const sameSerial = (a?: string | null, b?: string | null) =>
  !!a?.trim() && a.trim().toLowerCase() === b?.trim().toLowerCase();

/**
 * Links a printer on the network to the one printer it is (ADR-0015), when it is saved: `new`
 * makes it from what it found (or links your printer with the same serial, e.g. its Bambu Cloud
 * one), else your printer `choice`, which keeps its name, model and costs. An earlier link moves:
 * the printer it had stays, unlinked. A serial it found is written to a printer that has none.
 * Run inside the save's transaction. Returns the printer's id.
 */
export function linkNetworkPrinter(
  db: Db,
  adapters: IntegrationAdapter[],
  integrationId: string,
  found: FoundLink,
  choice: PrinterChoice,
): string {
  const taken = networkPrinters(db, adapters);
  taken.delete(integrationId);
  const others = new Set(taken.values());
  const pick = choice === "new" ? undefined : printerOf(db, choice);
  if (choice !== "new" && !pick) throw new HttpError(404, "not_found", "Printer not found");
  if (pick && others.has(pick.id))
    throw new HttpError(409, "printer_has_source", "Another network source is that printer");
  // The old link goes; the printer it brought in stays, unlinked (as when it is deleted).
  db.delete(printerSources).where(eq(printerSources.integrationId, integrationId)).run();
  db.update(printers)
    .set({ integrationId: null, externalId: null })
    .where(eq(printers.integrationId, integrationId))
    .run();
  const twin =
    pick ??
    (found.serial
      ? db
          .select()
          .from(printers)
          .all()
          .find((p) => !others.has(p.id) && sameSerial(p.serial, found.serial))
      : undefined);
  let printerId: string;
  if (twin) {
    db.insert(printerSources)
      .values({ printerId: twin.id, integrationId, externalId: found.externalId })
      .run();
    printerId = twin.id;
    if (found.serial && !twin.serial?.trim())
      db.update(printers).set({ serial: found.serial }).where(eq(printers.id, twin.id)).run();
  } else {
    const [row] = printerRows(db, integrationId, [found]);
    if (!row) throw new HttpError(500, "link_failed", "No printer to make");
    printerId = printerImport.create(db, row.raw as ImportValues, row);
  }
  return printerId;
}
