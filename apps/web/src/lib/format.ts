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

/** Typed text in the saved date format (any of / - . as separator) to "yyyy-mm-dd"; null if it is not a real day. */
export function parseDateText(text: string) {
  const nums = text
    .trim()
    .match(/^(\d+)\D(\d+)\D(\d+)$/)
    ?.slice(1);
  if (!nums) return null;
  const order = dateFormat.match(/YYYY|MM|DD/g) ?? ([] as string[]);
  const pick = (k: string) => Number(nums[order.indexOf(k)]);
  const [y, m, d] = [pick("YYYY"), pick("MM"), pick("DD")];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (y < 1000 || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return null;
  return day.toISOString().slice(0, 10);
}

/** The format as a placeholder, e.g. "DD/MM/YYYY". */
export const dateFormatHint = () => dateFormat;
export const uses12h = () => timeFormat === "12h";

/** A 0–23 hour as the 12-hour clock shows it: 12 AM is 0, 12 PM is 12. */
export const to12h = (h: number) => ({ hour: h % 12 || 12, pm: h >= 12 });
export const from12h = (hour: number, pm: boolean) => (hour % 12) + (pm ? 12 : 0);

export const formatTime = (d: Date | string | number) =>
  new Intl.DateTimeFormat(locale(), {
    hour: timeFormat === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hourCycle: timeFormat === "24h" ? "h23" : "h12",
  }).format(new Date(d));

export const formatDateTime = (d: Date | string | number) => `${formatDate(d)} ${formatTime(d)}`;

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
/** "5 min. ago", "yesterday", "in 2 hr.": the largest whole unit, "now" under a minute. */
export function formatRelative(d: Date | string | number, now = Date.now()) {
  const s = (new Date(d).getTime() - now) / 1000;
  const [unit, size] = STEPS.find(([, size]) => Math.abs(s) >= size) ?? ["second", 1];
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto", style: "short" });
  return rtf.format(unit === "second" ? 0 : Math.trunc(s / size), unit);
}

/** Grams in, whole grams out: "850 g", "1,250 g". Never kg, never decimals. */
/** Null = a spool whose weight isn't known yet: "Not set". */
export const formatWeight = (grams: number | null) =>
  grams == null
    ? i18n.t("common:weightUnknown")
    : num({ style: "unit", unit: "gram", maximumFractionDigits: 0 }).format(grams);

/** Bytes in, "12.3 MB" out. */
export const formatMegabytes = (bytes: number) =>
  num({ style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1024 ** 2);

/** Bytes in, "340 kB" or "12.3 MB" out. */
export const formatSize = (bytes: number) =>
  bytes < 1024 ** 2
    ? num({ style: "unit", unit: "kilobyte", maximumFractionDigits: 0 }).format(bytes / 1024)
    : formatMegabytes(bytes);

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

// <input type="datetime-local"> works in local time; the API stores UTC.
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
