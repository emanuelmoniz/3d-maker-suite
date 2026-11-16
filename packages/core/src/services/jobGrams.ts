import type { ExternalPrint } from "../schemas/integrations.ts";
import type { TrackedPrint } from "./jobTracker.ts";

// The grams a printer didn't report (ADR-0015, "Grams"): the job file's totals, else the project
// plate's, scaled by how far a stopped print got. Pure; reading the file is the server's job.

/** One filament's total. Without `slot` the position is all there is (Bambu's G-code lists only the filaments used). */
export interface GramTotal {
  slot?: number;
  grams: number;
}

export interface GramTotals {
  file?: GramTotal[];
  plate?: GramTotal[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The share of the material a job reached: its layer over its layer count, since the printer's
 * percent often counts time (Bambu said 40% on layer 6 of 45); the percent only where there is no
 * layer. Undefined when neither is known.
 */
export function materialShare({ progress, layer, totalLayers }: TrackedPrint["job"]) {
  if (layer != null && totalLayers) return Math.min(1, layer / totalLayers);
  return progress == null ? undefined : Math.min(1, progress / 100);
}

/**
 * The print with grams on every filament the printer left empty that a total covers. A finished
 * print takes the whole total; a cancelled or failed one the total × `materialShare`, marked
 * estimated. A filament no total covers is left as it was.
 */
export function fillGrams(
  print: ExternalPrint,
  job: TrackedPrint["job"],
  totals: GramTotals,
): ExternalPrint {
  const share = print.outcome === "success" ? 1 : materialShare(job);
  return {
    ...print,
    filaments: print.filaments.map((f, i) => {
      if (f.grams != null) return { ...f, gramsSource: f.gramsSource ?? "printer" };
      if (share == null) return f;
      for (const source of ["file", "plate"] as const) {
        const list = totals[source] ?? [];
        const found = list.some((t) => t.slot != null)
          ? list.find((t) => t.slot === f.slot)
          : list[i];
        if (found && found.grams > 0)
          return {
            ...f,
            grams: round(found.grams * share),
            gramsSource: source,
            ...(share < 1 && { gramsEstimated: true }),
          };
      }
      return f;
    }),
  };
}
