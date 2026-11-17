import { describe, expect, it } from "vitest";
import type { PrinterStatus } from "../schemas/integrations.ts";
import { monitoringOf } from "./monitoring.ts";

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
    expect(monitoringOf("p1", [status("a", "offline", { failing: true })])).toEqual({
      kind: "error",
    });
  });

  it("with several sources the best one shows: online beats the rest", () => {
    expect(
      monitoringOf("p1", [
        status("cloud", "offline"),
        status("lan", "printing", {}, 10),
        status("other", "offline", { failing: true }),
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
        status("b", "offline", { failing: true }),
      ]),
    ).toEqual({ kind: "error" });
  });
});
