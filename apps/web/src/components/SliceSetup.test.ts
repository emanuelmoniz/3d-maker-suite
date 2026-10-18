import type { FilamentProfile } from "@3d-maker-suite/core";
import { expect, test } from "vitest";
import { defaultFilaments } from "./SliceSetup.tsx";

const profile = (id: string, name: string, extra: Partial<FilamentProfile> = {}) =>
  ({ id, name, sourcePreset: null, archivedAt: null, ...extra }) as FilamentProfile;
const slot = (n: number, profile: string | null) => ({
  slot: n,
  type: "PLA",
  color: null,
  profile,
  grams: null,
  meters: null,
});
const plate = (filaments: ReturnType<typeof slot>[]) =>
  ({ index: 1, filaments }) as Parameters<typeof defaultFilaments>[0];

test("picks the profile named like the 3MF's preset, per slot; null when none fits", () => {
  const profiles = [
    profile("old", "Bambu PLA Matte", { archivedAt: "2026-01-01T00:00:00.000Z" }),
    profile("matte", "Bambu PLA Matte"),
    profile("basic", "Basic", { sourcePreset: "bambu-studio:system/bambu pla basic" }),
  ];
  expect(
    defaultFilaments(
      plate([
        slot(1, "Bambu PLA Matte @BBL A1"),
        slot(3, "Bambu PLA Basic @BBL X1C"),
        slot(4, "Nobody's PETG"),
      ]),
      profiles,
    ),
  ).toEqual(["matte", null, "basic", null]);
  expect(defaultFilaments(plate([]), profiles)).toEqual([]);
});
