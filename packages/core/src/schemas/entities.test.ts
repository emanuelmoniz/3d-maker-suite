import { describe, expect, it } from "vitest";
import { printSchema } from "./entities.ts";

const print = {
  id: crypto.randomUUID(),
  printerId: crypto.randomUUID(),
  projectId: null,
  title: "Benchy",
  plate: 1,
  startedAt: "2026-01-01T10:00:00.000Z",
  durationSec: 3600,
  outcome: "success",
  failureReason: null,
  notes: null,
  energyWh: 120,
  energySource: "estimated",
  costSnapshot: null,
  coverUrl: null,
  sourceUrl: null,
  origin: "manual",
  integrationId: null,
  externalId: null,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
};

describe("printSchema", () => {
  it("accepts a valid print", () => {
    expect(printSchema.safeParse(print).success).toBe(true);
  });

  it("rejects a failure reason on success, allows it on failure", () => {
    expect(printSchema.safeParse({ ...print, failureReason: "Clog" }).success).toBe(false);
    expect(
      printSchema.safeParse({ ...print, outcome: "failed", failureReason: "Clog" }).success,
    ).toBe(true);
  });

  it("requires energy and its source together", () => {
    expect(printSchema.safeParse({ ...print, energySource: null }).success).toBe(false);
    expect(printSchema.safeParse({ ...print, energyWh: null, energySource: null }).success).toBe(
      true,
    );
  });

  it("rejects dates that are not UTC ISO with milliseconds", () => {
    expect(printSchema.safeParse({ ...print, startedAt: "2026-01-01 10:00" }).success).toBe(false);
    expect(
      printSchema.safeParse({ ...print, startedAt: "2026-01-01T10:00:00+02:00" }).success,
    ).toBe(false);
  });
});
