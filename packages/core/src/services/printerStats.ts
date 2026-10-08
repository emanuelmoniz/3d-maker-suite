import type { PrintOutcome } from "../schemas/enums.ts";
import type { PrintStats } from "../schemas/printers.ts";

export interface PrintForStats {
  durationSec: number | null;
  outcome: PrintOutcome;
  energyWh: number | null;
}

/**
 * Sums prints into totals. A print without recorded energy is estimated from `powerW` and its
 * duration (when both are known). Pure: callers fetch and filter the rows (printer, period).
 */
export function summarizePrints(
  prints: Iterable<PrintForStats>,
  powerW: number | null,
): PrintStats {
  const out: PrintStats = {
    printCount: 0,
    successCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    totalSec: 0,
    energyWh: 0,
  };
  for (const p of prints) {
    out.printCount++;
    if (p.outcome === "success") out.successCount++;
    else if (p.outcome === "failed") out.failedCount++;
    else out.cancelledCount++;
    out.totalSec += p.durationSec ?? 0;
    out.energyWh +=
      p.energyWh ?? (powerW !== null && p.durationSec ? (powerW * p.durationSec) / 3600 : 0);
  }
  return out;
}
