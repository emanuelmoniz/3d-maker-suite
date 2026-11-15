import type { PrinterStatus } from "@3d-maker-suite/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api.ts";

const KEY = ["printers", "status"];

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
    events.onmessage = (e) => qc.setQueryData(KEY, JSON.parse(e.data) as PrinterStatus[]);
    return () => events.close();
  }, [qc]);
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<PrinterStatus[]>("GET", "/api/printers/status"),
    // The stream keeps it fresh; a refetch would only race it.
    staleTime: Number.POSITIVE_INFINITY,
  });
}
