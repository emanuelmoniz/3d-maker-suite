import { expect, test } from "vitest";
import { niceTicks } from "./BarSeries.tsx";

test("niceTicks rounds up to a clean top", () => {
  expect(niceTicks(56)).toEqual([0, 20, 40, 60]);
  expect(niceTicks(1)).toEqual([0, 0.5, 1]);
  expect(niceTicks(7)).toEqual([0, 5, 10]);
  expect(niceTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3]);
});
