import { expect, test } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEnergy,
  formatRelative,
  formatWeight,
  parseDateText,
  setDateTimePrefs,
} from "./format.ts";

test("formats base units for the en locale", () => {
  expect(formatWeight(850)).toBe("850 g");
  expect(formatWeight(12.34)).toBe("12 g");
  expect(formatWeight(1250)).toBe("1,250 g");
  expect(formatDuration(7500)).toBe("2h 5m");
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(7200)).toBe("2h");
  expect(formatCurrency(12.5)).toBe("€12.50");
  expect(formatEnergy(1.234)).toBe("1.23 kWh");
});

test("dates default to YYYY/MM/DD 24h and follow the preferences", () => {
  const d = new Date(2026, 2, 5, 14, 30);
  expect(formatDateTime(d)).toBe("2026/03/05 14:30");
  setDateTimePrefs({ dateFormat: "DD.MM.YYYY", timeFormat: "12h" });
  expect(formatDate(d)).toBe("05.03.2026");
  expect(formatDateTime(d)).toMatch(/^05\.03\.2026 2:30\sPM$/);
  setDateTimePrefs({ dateFormat: "YYYY/MM/DD", timeFormat: "24h" });
});

test("relative times use the largest whole unit", () => {
  const now = Date.UTC(2026, 9, 22, 12);
  const ago = (s: number) => formatRelative(now - s * 1000, now);
  expect(ago(20)).toBe("now");
  expect(ago(5 * 60)).toBe("5 min. ago");
  expect(ago(2 * 3600 + 59 * 60)).toBe("2 hr. ago");
  expect(ago(86400)).toBe("yesterday");
  expect(ago(400 * 86400)).toBe("last yr.");
});

test("parseDateText reads the saved format and rejects impossible days", () => {
  setDateTimePrefs({ dateFormat: "DD/MM/YYYY", timeFormat: "24h" });
  expect(parseDateText("05/03/2026")).toBe("2026-03-05");
  expect(parseDateText("5.3.2026")).toBe("2026-03-05");
  expect(parseDateText("31/02/2026")).toBeNull();
  expect(parseDateText("2026-03-05")).toBeNull();
  setDateTimePrefs({ dateFormat: "MM/DD/YYYY", timeFormat: "24h" });
  expect(parseDateText("03/05/2026")).toBe("2026-03-05");
  setDateTimePrefs({ dateFormat: "YYYY/MM/DD", timeFormat: "24h" });
});
