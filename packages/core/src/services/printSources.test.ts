import { describe, expect, it } from "vitest";
import { printerOfSource, samePrint } from "./printSources.ts";

describe("printerOfSource", () => {
  const cloud = { id: "a", integrationId: "cloud", externalId: "00M00A1", serial: "00M00A1" };
  const byHand = { id: "b", integrationId: null, externalId: null, serial: "PRUSA-7" };
  const klipper = { id: "c", integrationId: "moon", externalId: "voron", serial: null };
  const printers = [cloud, byHand, klipper];

  it("finds the printer imported from the source, else the one with its serial", () => {
    const of = (integrationId: string, externalId: string, serial?: string) =>
      printerOfSource(printers, { integrationId, externalId, serial })?.id;
    expect(of("cloud", "00M00A1", "00M00A1")).toBe("a");
    // The same machine through another source, its serial spelled another way.
    expect(of("lan", "192.168.1.20", " 00m00a1 ")).toBe("a");
    expect(of("link", "prusa", "PRUSA-7")).toBe("b");
    // Its own source key wins over a serial that changed.
    expect(of("moon", "voron", "PRUSA-7")).toBe("c");
  });

  it("a printer without a serial is no other source's", () => {
    expect(
      printerOfSource(printers, { integrationId: "lan", externalId: "voron" }),
    ).toBeUndefined();
    expect(
      printerOfSource(printers, { integrationId: "lan", externalId: "x", serial: " " }),
    ).toBeUndefined();
  });
});

describe("samePrint", () => {
  // The two A1 prints of the spike: cloud start, and what the LAN source records.
  const cloud = [
    { id: "1", externalId: "100000001", startedAt: "2026-11-14T11:25:04.000Z" },
    { id: "5", externalId: "100000005", startedAt: "2026-11-14T11:49:26.000Z" },
  ];

  it("by the id the printer names, whatever the times say", () => {
    const lan = { externalId: "x", peerId: "100000005", startedAt: "2026-11-14T11:25:04.000Z" };
    expect(samePrint(lan, cloud)?.id).toBe("5");
    // The other way round: the cloud's print arrives after the LAN's.
    const stored = [{ id: "9", externalId: "x", peerId: "100000005", startedAt: lan.startedAt }];
    expect(
      samePrint({ externalId: "100000005", startedAt: cloud[1]?.startedAt ?? "" }, stored)?.id,
    ).toBe("9");
  });

  it("else by a start within 60 seconds, the closest one", () => {
    // A print started over LAN has no cloud id; the LAN saw it 2.7 s after the cloud's start.
    const at = (startedAt: string) => samePrint({ externalId: "x", startedAt }, cloud)?.id;
    expect(at("2026-11-14T11:25:06.677Z")).toBe("1");
    expect(at("2026-11-14T11:24:04.000Z")).toBe("1");
    expect(at("2026-11-14T11:26:04.001Z")).toBeUndefined();
    expect(at("2026-11-14T11:49:00.000Z")).toBe("5");
    expect(
      samePrint({ externalId: "x", startedAt: "2026-11-14T11:25:04.000Z" }, []),
    ).toBeUndefined();
  });

  it("an id that names no print there falls back to the start", () => {
    const lan = { externalId: "x", peerId: "nope", startedAt: "2026-11-14T11:25:05.000Z" };
    expect(samePrint(lan, cloud)?.id).toBe("1");
  });
});
