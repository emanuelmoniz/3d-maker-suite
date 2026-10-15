/** Prints of the same printer needed before its own pace is trusted over everyone's. */
export const MIN_PRINTER_SAMPLES = 5;

export interface RateSample {
  printerId: string;
  grams: number;
  durationSec: number;
}

/**
 * Grams per hour for an estimate: this printer's own prints when it has enough, else all prints,
 * else the preference. Each pool is total grams over total hours, so long prints weigh more.
 * Samples without grams or duration are ignored.
 */
export function gramsPerHour(
  samples: RateSample[],
  printerId: string,
  fallback: number,
  minPrinterSamples = MIN_PRINTER_SAMPLES,
): number {
  const usable = samples.filter((s) => s.grams > 0 && s.durationSec > 0);
  const pace = (list: RateSample[]) =>
    list.reduce((g, s) => g + s.grams, 0) / (list.reduce((t, s) => t + s.durationSec, 0) / 3600);
  const own = usable.filter((s) => s.printerId === printerId);
  if (own.length >= minPrinterSamples) return pace(own);
  return usable.length ? pace(usable) : fallback;
}

export const estimateDurationSec = (grams: number, gph: number) => Math.round((grams / gph) * 3600);
