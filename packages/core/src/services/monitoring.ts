import type { PrinterStatus } from "../schemas/integrations.ts";

/**
 * What the Printers list says of a printer's live connection (ADR-0015). Display only: the status
 * is in memory, the list is queried from the database.
 *  - `none`: no source reads it, or its integration is paused;
 *  - `online`: it answers, with what it is doing (`state`, and `progress` in percent while it prints);
 *  - `offline`: it doesn't answer;
 *  - `machine_offline`: it is reached through a machine whose connector is offline;
 *  - `error`: its source refuses its access code or key (a wrong one, signed out);
 *  - `checking`: its source has just started and hasn't read yet.
 */
export type Monitoring =
  | { kind: "none" }
  | { kind: "online"; state: PrinterStatus["snapshot"]["state"]; progress?: number }
  | { kind: "offline" }
  | { kind: "machine_offline"; machine: string }
  | { kind: "error" }
  | { kind: "checking" };

/** The best of a printer's sources first: online beats a source error beats offline. */
const rank = (m: Monitoring) =>
  m.kind === "online"
    ? 4
    : m.kind === "error"
      ? 3
      : m.kind === "checking"
        ? 2
        : m.kind === "machine_offline"
          ? 1
          : 0;

/** One source's own reading of its printer. */
export function monitoringOfSource(s: PrinterStatus): Monitoring {
  if (s.failing === "refused") return { kind: "error" };
  if (s.pending) return { kind: "checking" };
  if (s.snapshot.state === "offline")
    return s.via && !s.via.online
      ? { kind: "machine_offline", machine: s.via.deviceName }
      : { kind: "offline" };
  const progress = s.snapshot.job?.progress;
  return {
    kind: "online",
    state: s.snapshot.state,
    ...(s.snapshot.state === "printing" && progress != null && { progress }),
  };
}

/**
 * What to show for a printer from the statuses of all its sources (the ones of other printers are
 * ignored). A printer with several sources (Bambu Cloud + LAN) shows the best one.
 */
export function monitoringOf(printerId: string, all: readonly PrinterStatus[]): Monitoring {
  let best: Monitoring = { kind: "none" };
  let top = -1;
  for (const s of all) {
    if (s.printerId !== printerId) continue;
    const m = monitoringOfSource(s);
    // Among online ones, the one that is doing something (not idle) wins.
    const score = rank(m) * 2 + (m.kind === "online" && m.state !== "idle" ? 1 : 0);
    if (score > top) [best, top] = [m, score];
  }
  return best;
}
