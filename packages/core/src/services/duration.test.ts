import { expect, test } from "vitest";
import { estimateDurationSec, gramsPerHour } from "./duration.ts";

const s = (printerId: string, grams: number, hours: number) => ({
  printerId,
  grams,
  durationSec: hours * 3600,
});
const five = (printerId: string, gph: number) =>
  Array.from({ length: 5 }, () => s(printerId, gph, 1));

test("the printer's own pace wins once it has enough prints", () => {
  expect(gramsPerHour([...five("a", 20), ...five("b", 10)], "a", 15)).toBe(20);
});

test("a printer with too few prints uses all prints", () => {
  expect(gramsPerHour([...five("b", 10), s("a", 40, 1)], "a", 15)).toBeCloseTo(90 / 6);
});

test("no usable prints uses the preference", () => {
  expect(gramsPerHour([], "a", 15)).toBe(15);
  expect(gramsPerHour([s("a", 0, 1), s("a", 10, 0)], "a", 15)).toBe(15);
});

test("pools are total grams over total hours", () => {
  expect(gramsPerHour([s("a", 10, 1), s("a", 90, 3)], "a", 15, 1)).toBe(25);
});

test("estimates the duration from the rate", () => {
  expect(estimateDurationSec(20, 15)).toBe(4800);
});
