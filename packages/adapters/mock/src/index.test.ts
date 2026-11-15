import { printerSnapshotSchema, type TrackerState, track } from "@3d-maker-suite/core";
import { expect, it } from "vitest";
import { fixture, LIVE_CYCLE_SEC, liveStatus, mockAdapter } from "./index.ts";

it("the live printer's loop is one finished print for the job tracker, every cycle", () => {
  const start = Date.UTC(2026, 10, 14, 10); // a cycle starts on the hour
  let state: TrackerState = { phase: "unknown" };
  const prints = [];
  for (let s = 0; s < LIVE_CYCLE_SEC * 2; s += 5) {
    const out = track(state, printerSnapshotSchema.parse(liveStatus(start + s * 1000)));
    state = out.state;
    prints.push(...out.prints);
  }
  expect(prints).toHaveLength(2);
  expect(prints[0]).toEqual({
    print: {
      externalId: "live-1794650400",
      printerExternalId: "mock-1",
      title: "Mock live print",
      startedAt: "2026-11-14T10:01:00.000Z",
      durationSec: 480,
      outcome: "success",
      filaments: [{ slot: 0, material: "PLA", colorHex: "#ff8800", grams: 12 }],
    },
    partial: false,
    endSeen: true,
    job: { file: "mock-live.gcode", progress: 100, layer: 50, totalLayers: 50 },
  });
  expect(prints[1]?.print.startedAt).toBe("2026-11-14T10:11:00.000Z");
});

it("reads the status the test set, else the live loop", async () => {
  const state = fixture();
  const secrets = { get: async () => "t", set: async () => {}, delete: async () => {} };
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const ctx = { config: {}, secrets, log, signal: new AbortController().signal };
  const status = mockAdapter(state).create?.(ctx).status;
  expect(await status?.readStatus()).toMatchObject([{ printerExternalId: "mock-1" }]);
  state.status = [];
  expect(await status?.readStatus()).toEqual([]);
});
