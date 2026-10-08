import { expect, test } from "vitest";
import { formatCurrency, formatDuration, formatEnergy, formatWeight } from "./format.ts";

test("formats base units for the en locale", () => {
  expect(formatWeight(850)).toBe("850 g");
  expect(formatWeight(1250)).toBe("1.25 kg");
  expect(formatDuration(7500)).toBe("2h 5m");
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(7200)).toBe("2h");
  expect(formatCurrency(12.5)).toBe("€12.50");
  expect(formatEnergy(1.234)).toBe("1.23 kWh");
});
