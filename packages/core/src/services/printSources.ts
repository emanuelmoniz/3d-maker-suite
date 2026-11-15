import type { ExternalPrint } from "../schemas/integrations.ts";

// One printer can have several sources (Bambu Cloud for its history, Bambu LAN for its status):
// one printer and one print each, whatever the number of sources (ADR-0015).

/**
 * Two sources name the start of one print this far apart at most. Measured: the LAN saw a start
 * 2.3 to 2.7 s after the cloud's; the two closest starts in 222 real prints were 106 s apart.
 */
export const SAME_PRINT_SEC = 60;

const key = (serial?: string | null) => serial?.trim().toLowerCase() || undefined;

/**
 * The printer a source's printer is: the one imported from that source, else the one with its
 * serial, whoever brought it in. A printer without a serial is only ever its own source's.
 */
export function printerOfSource<
  T extends { integrationId: string | null; externalId: string | null; serial: string | null },
>(
  printers: T[],
  source: { integrationId: string; externalId: string; serial?: string | null },
): T | undefined {
  const serial = key(source.serial);
  return (
    printers.find(
      (p) => p.integrationId === source.integrationId && p.externalId === source.externalId,
    ) ?? (serial ? printers.find((p) => key(p.serial) === serial) : undefined)
  );
}

/**
 * The print that `print` is, among the prints the same printer has from its other sources: the
 * one either side names by id, else the one that started closest, within `SAME_PRINT_SEC`.
 */
export function samePrint<
  T extends { externalId: string | null; startedAt: string; peerId?: string | null },
>(print: Pick<ExternalPrint, "externalId" | "peerId" | "startedAt">, others: T[]): T | undefined {
  const named = others.find(
    (o) =>
      (!!print.peerId && o.externalId === print.peerId) ||
      (!!o.peerId && o.peerId === print.externalId),
  );
  if (named) return named;
  const apart = (o: T) => Math.abs(Date.parse(o.startedAt) - Date.parse(print.startedAt));
  const [closest] = [...others].sort((a, b) => apart(a) - apart(b));
  return closest && apart(closest) <= SAME_PRINT_SEC * 1000 ? closest : undefined;
}
