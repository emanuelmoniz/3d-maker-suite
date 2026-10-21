import { expect, test } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEnergy,
  formatWeight,
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
