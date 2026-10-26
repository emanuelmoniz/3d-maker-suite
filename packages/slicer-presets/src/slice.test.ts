import { expect, it } from "vitest";
import { lastLogError, signedExit } from "./slice.ts";

it("reads Orca's last error line without its prefix", () => {
  const log = [
    "[2026-10-26 10:00:00.1] [0x1] [info]    Loading 3mf",
    "[2026-10-26 10:00:00.2] [0x1] [error]   first problem",
    "[2026-10-26 10:00:00.3] [0x1] [error]   The 3mf is from a newer Bambu Studio",
    "[2026-10-26 10:00:00.4] [0x1] [info]    exit",
  ].join("\r\n");
  expect(lastLogError(log)).toBe("The 3mf is from a newer Bambu Studio");
  expect(lastLogError("[info] fine")).toBeUndefined();
});

it("turns exit codes back into the slicer's negative codes", () => {
  expect(signedExit(4294967272, "win32")).toBe(-24);
  expect(signedExit(232, "linux")).toBe(-24);
  expect(signedExit(0, "linux")).toBe(0);
});
