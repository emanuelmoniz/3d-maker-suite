import type { SystemInfo } from "@3d-maker-suite/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSystemReport } from "./system.ts";

const info: SystemInfo = {
  cpuPercent: 10,
  cores: 4,
  memory: { total: 8, used: 4 },
  disks: [],
  addresses: [],
  at: new Date(0).toISOString(),
};

describe("system report", () => {
  afterEach(() => vi.useRealTimers());

  it("reports at once when connected, then on each tick, and stops when told", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const request = vi.fn(
      async (_path: string, _init?: object) => new Response(null, { status: 204 }),
    );
    const read = vi.fn(async (_paths: string[]) => info);
    const report = createSystemReport({
      request,
      paths: () => ["/data", "/shared"],
      read,
      everyMs: 30_000,
    });

    await report.start();
    expect(read).toHaveBeenCalledWith(["/data", "/shared"]);
    expect(request).toHaveBeenCalledWith("/system", { method: "PUT", body: info });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(2);

    report.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("shrugs off a hub that can't take it", async () => {
    const report = createSystemReport({
      request: async () => {
        throw new Error("offline");
      },
      paths: () => [],
      read: async () => info,
    });
    await expect(report.start()).resolves.toBeUndefined();
    report.stop();
  });
});
