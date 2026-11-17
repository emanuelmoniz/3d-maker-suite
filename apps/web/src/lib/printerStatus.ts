import type { PrinterStatus } from "@3d-maker-suite/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { api } from "./api.ts";

const KEY = ["printers", "status"];

const loadedOf = (all: PrinterStatus[]) =>
  JSON.stringify(all.map((s) => [s.printerId, s.loaded ?? []]));

/**
 * A printer slot's name, numbered as the live status numbers them: 0-127 the slots of the
 * printer's spool units ("Slot 1"), 128-253 a unit with one slot of its own (Bambu's AMS HT), 254
 * the spool outside any unit (Bambu's back spool).
 */
export const slotName = (t: TFunction, slot: number) =>
  slot === 254
    ? t("printers:slots.external")
    : slot >= 128 && slot < 254
      ? t("printers:slots.single", { n: slot - 127 })
      : t("printers:loaded.slot", { slot: slot + 1 });

/**
 * What each printer is doing now (ADR-0015): read once, then kept current by the server's event
 * stream while the component is shown. Each call opens a stream: call it once per page and hand
 * the cards what it returns.
 */
export function usePrinterStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const events = new EventSource("/api/printers/status/events");
    events.onmessage = (e) => {
      const next = JSON.parse(e.data) as PrinterStatus[];
      const before = qc.getQueryData<PrinterStatus[]>(KEY);
      qc.setQueryData(KEY, next);
      // The printer loaded or unloaded a spool (Step 19b): the spools say where they are.
      if (before && loadedOf(before) !== loadedOf(next))
        void qc.invalidateQueries({ queryKey: ["filament"] });
    };
    return () => events.close();
  }, [qc]);
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<PrinterStatus[]>("GET", "/api/printers/status"),
    // The stream keeps it fresh; a refetch would only race it.
    staleTime: Number.POSITIVE_INFINITY,
  });
}
