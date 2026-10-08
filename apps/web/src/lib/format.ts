import i18n from "../i18n.ts";

// Values are stored in base units (UTC ISO dates, grams, seconds, kWh) and formatted at render time.
const locale = () => i18n.resolvedLanguage ?? "en";
const num = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale(), opts);

export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) => num(opts).format(n);

export const formatCurrency = (amount: number, currency = "EUR") =>
  num({ style: "currency", currency }).format(amount);

export const formatDate = (d: Date | string | number) =>
  new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(d));

export const formatDateTime = (d: Date | string | number) =>
  new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(d),
  );

/** Grams in, "850 g" or "1.2 kg" out. */
export const formatWeight = (grams: number) =>
  Math.abs(grams) >= 1000
    ? num({ style: "unit", unit: "kilogram", maximumFractionDigits: 2 }).format(grams / 1000)
    : num({ style: "unit", unit: "gram", maximumFractionDigits: 1 }).format(grams);

/** Seconds in, "2h 5m" out (narrow unit style). Under a minute shows seconds. */
export function formatDuration(seconds: number) {
  const unit = (value: number, u: "hour" | "minute" | "second") =>
    num({ style: "unit", unit: u, unitDisplay: "narrow" }).format(value);
  const s = Math.round(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [h && unit(h, "hour"), (m || (!h && s >= 60)) && unit(m, "minute")].filter(Boolean);
  return parts.length ? parts.join(" ") : unit(s, "second");
}

/** kWh in. Intl has no kWh unit, so the unit label is a translation. */
export const formatEnergy = (kwh: number) =>
  i18n.t("common:units.kwh", { value: num({ maximumFractionDigits: 2 }).format(kwh) });
