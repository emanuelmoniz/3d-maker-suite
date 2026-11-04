import { expect, it } from "vitest";
import { skippedCount } from "./skipCount.ts";

it("doesn't subtract fixed invalid rows from Skip", () => {
  const rows = [
    { status: "invalid", action: "create" }, // fixed by an edit
    { status: "invalid", action: "skip" },
    { status: "new", action: "skip" },
  ];
  expect(skippedCount(rows)).toBe(1);
});
