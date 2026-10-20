import { type DateFormat, PREFERENCE_DEFAULTS, type TimeFormat } from "@3d-maker-suite/core";
import i18n from "../i18n.ts";

// Values are stored in base units (UTC ISO dates, grams, seconds, kWh) and formatted at render time.
const locale = () => i18n.resolvedLanguage ?? "en";
const num = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale(), opts);

export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) => num(opts).format(n);

export const formatCurrency = (amount: number, currency = "EUR") =>
  num({ style: "currency", currency }).format(amount);

// The only place dates are formatted. AppShell pushes the saved preferences in and remounts on change.
let dateFormat: DateFormat = PREFERENCE_DEFAULTS.dateFormat;
let timeFormat: TimeFormat = PREFERENCE_DEFAULTS.timeFormat;
export function setDateTimePrefs(p: { dateFormat: DateFormat; timeFormat: TimeFormat }) {
  dateFormat = p.dateFormat;
  timeFormat = p.timeFormat;
}

export const formatDate = (d: Date | string | number) => {
  const parts = new Intl.DateTimeFormat(locale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(d));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return dateFormat
    .replace("YYYY", get("year"))
    .replace("MM", get("month"))
    .replace("DD", get("day"));
};

export const formatTime = (d: Date | string | number) =>
  new Intl.DateTimeFormat(locale(), {
    hour: timeFormat === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hourCycle: timeFormat === "24h" ? "h23" : "h12",
  }).format(new Date(d));

export const formatDateTime = (d: Date | string | number) => `${formatDate(d)} ${formatTime(d)}`;

/** Grams in, "850 g" or "1.2 kg" out. */
export const formatWeight = (grams: number) =>
  Math.abs(grams) >= 1000
    ? num({ style: "unit", unit: "kilogram", maximumFractionDigits: 2 }).format(grams / 1000)
    : num({ style: "unit", unit: "gram", maximumFractionDigits: 2 }).format(grams);

/** Bytes in, "12.3 MB" out. */
export const formatMegabytes = (bytes: number) =>
  num({ style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1024 ** 2);

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

// Date-only form fields are stored as noon UTC so every time zone shows the same calendar day.
export const dateInputToIso = (d: string) => new Date(`${d}T12:00:00Z`).toISOString();
export const isoToDateInput = (iso: string | null) => iso?.slice(0, 10) ?? "";
