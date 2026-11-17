import { describe, expect, it } from "vitest";
import type { PrinterStatus } from "../schemas/integrations.ts";
import { MONITORING_FILTERS, monitoringKey, monitoringOf, monitoringRank } from "./monitoring.ts";

const status = (
  integrationId: string,
  state: PrinterStatus["snapshot"]["state"],
  over: Partial<PrinterStatus> = {},
  progress?: number,
): PrinterStatus => ({
  printerId: "p1",
  integrationId,
  snapshot: {
    printerExternalId: "x",
    at: "2026-11-17T10:00:00.000Z",
    state,
    ...(progress != null && { job: { progress } }),
    slots: [],
  },
  ...over,
});

describe("monitoringOf", () => {
  it("no source reads the printer: not monitored", () => {
    expect(monitoringOf("p1", [])).toEqual({ kind: "none" });
    expect(monitoringOf("p1", [{ ...status("a", "idle"), printerId: "other" }])).toEqual({
      kind: "none",
    });
  });

  it("an online printer says what it does; printing carries its progress", () => {
    expect(monitoringOf("p1", [status("a", "idle")])).toEqual({ kind: "online", state: "idle" });
    expect(monitoringOf("p1", [status("a", "paused")])).toEqual({
      kind: "online",
      state: "paused",
    });
    expect(monitoringOf("p1", [status("a", "printing", {}, 45)])).toEqual({
      kind: "online",
      state: "printing",
      progress: 45,
    });
  });

  it("offline, machine offline and source error are told apart", () => {
    expect(monitoringOf("p1", [status("a", "offline")])).toEqual({ kind: "offline" });
    const via = { deviceId: "d", deviceName: "Workshop PC", online: false };
    expect(monitoringOf("p1", [status("a", "offline", { via })])).toEqual({
      kind: "machine_offline",
      machine: "Workshop PC",
    });
    // Its machine is online and the printer still doesn't answer: the printer is offline.
    expect(monitoringOf("p1", [status("a", "offline", { via: { ...via, online: true } })])).toEqual(
      { kind: "offline" },
    );
    expect(monitoringOf("p1", [status("a", "offline", { failing: "refused" })])).toEqual({
      kind: "error",
    });
  });

  it("a source that fails for another reason, or hasn't read yet, is not a wrong key", () => {
    expect(monitoringOf("p1", [status("a", "offline", { failing: "other" })])).toEqual({
      kind: "offline",
    });
    expect(monitoringOf("p1", [status("a", "offline", { pending: true })])).toEqual({
      kind: "checking",
    });
  });

  it("with several sources the best one shows: online beats the rest", () => {
    expect(
      monitoringOf("p1", [
        status("cloud", "offline"),
        status("lan", "printing", {}, 10),
        status("other", "offline", { failing: "refused" }),
      ]),
    ).toEqual({ kind: "online", state: "printing", progress: 10 });
    // Busy online beats idle online.
    expect(monitoringOf("p1", [status("a", "idle"), status("b", "printing", {}, 3)])).toMatchObject(
      { state: "printing" },
    );
  });

  it("without an online source, an error beats a machine offline beats offline", () => {
    const via = { deviceId: "d", deviceName: "PC", online: false };
    expect(
      monitoringOf("p1", [status("a", "offline"), status("b", "offline", { via })]),
    ).toMatchObject({ kind: "machine_offline" });
    expect(
      monitoringOf("p1", [
        status("a", "offline", { via }),
        status("b", "offline", { failing: "refused" }),
      ]),
    ).toEqual({ kind: "error" });
  });
});

describe("monitoringOf, sync-only sources", () => {
  it("says synced, not none, when the enabled sources only sync", () => {
    expect(monitoringOf("p1", [], true)).toEqual({ kind: "synced" });
    expect(monitoringOf("p1", [], false)).toEqual({ kind: "none" });
    expect(monitoringKey({ kind: "synced" })).toBe("synced");
  });

  it("lets a live reading win over synced", () => {
    expect(monitoringOf("p1", [status("a", "idle")], true)).toEqual({
      kind: "online",
      state: "idle",
    });
  });
});

describe("monitoringKey and monitoringRank", () => {
  it("names a state as the filter does", () => {
    expect(monitoringKey({ kind: "none" })).toBe("none");
    expect(monitoringKey({ kind: "online", state: "printing", progress: 4 })).toBe("printing");
    expect(monitoringKey({ kind: "error" })).toBe("source_error");
    expect(monitoringKey({ kind: "machine_offline", machine: "pc" })).toBe("machine_offline");
  });

  it("ranks the filter values in order, any other state last", () => {
    const ranks = MONITORING_FILTERS.map(monitoringRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(monitoringRank("finished")).toBe(MONITORING_FILTERS.length);
    expect(monitoringRank("checking")).toBe(MONITORING_FILTERS.length);
  });
});
