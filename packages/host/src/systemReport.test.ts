import type { CpuInfo, NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { detectedIps, readSystemInfo } from "./systemReport.ts";

const cpu = (idle: number, busy: number): CpuInfo => ({
  model: "x",
  speed: 1,
  times: { user: busy, nice: 0, sys: 0, idle, irq: 0 },
});

const nic = (address: string, family: "IPv4" | "IPv6", internal = false) =>
  ({ address, family, internal }) as NetworkInterfaceInfo;

/** Two CPU samples, then fixed memory, drives and network. */
function fakes(drives: Record<string, number>, sizes: Record<number, [number, number]> = {}) {
  const samples = [
    [cpu(100, 100), cpu(100, 100)],
    [cpu(150, 250), cpu(150, 250)],
  ];
  let call = 0;
  return {
    cpus: () => samples[Math.min(call++, 1)] as CpuInfo[],
    totalmem: () => 16_000,
    freemem: () => 6_000,
    networkInterfaces: () => ({
      lo: [nic("127.0.0.1", "IPv4", true)],
      eth0: [nic("192.168.1.20", "IPv4"), nic("fe80::1", "IPv6")],
    }),
    stat: async (path: string) => {
      const dev = drives[path];
      if (dev === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { dev };
    },
    statfs: async (path: string) => {
      const [blocks, bavail] = sizes[drives[path] as number] ?? [100, 40];
      return { bsize: 4096, blocks, bavail };
    },
    wait: async () => {},
    platform: "linux" as const,
  };
}

describe("readSystemInfo", () => {
  it("takes CPU % from two samples, and memory used from total minus free", async () => {
    const info = await readSystemInfo([], fakes({}));
    // Per core: 50 idle and 150 busy more, so 75 % busy.
    expect(info.cpuPercent).toBe(75);
    expect(info.cores).toBe(2);
    expect(info.memory).toEqual({ total: 16_000, used: 10_000 });
    expect(Date.parse(info.at)).not.toBeNaN();
  });

  it("gives one disk per drive, with every folder on it, and skips a missing folder", async () => {
    const info = await readSystemInfo(
      ["/data", "/data/projects", "/mnt/usb", "/gone", "/data"],
      fakes({ "/data": 1, "/data/projects": 1, "/mnt/usb": 2 }, { 1: [1000, 250], 2: [10, 10] }),
    );
    expect(info.disks).toEqual([
      { label: "/data", paths: ["/data", "/data/projects"], total: 4_096_000, free: 1_024_000 },
      { label: "/mnt/usb", paths: ["/mnt/usb"], total: 40_960, free: 40_960 },
    ]);
  });

  it("labels a Windows disk by its drive", async () => {
    const info = await readSystemInfo(["C:\\Users\\me\\3D Maker Suite"], {
      ...fakes({ "C:\\Users\\me\\3D Maker Suite": 7 }),
      platform: "win32",
    });
    expect(info.disks[0]?.label).toBe("C:\\");
  });

  it("lists only the external IPv4 addresses", async () => {
    expect((await readSystemInfo([], fakes({}))).addresses).toEqual(["192.168.1.20"]);
    expect(detectedIps({ lo: [nic("127.0.0.1", "IPv4", true)] })).toEqual([]);
  });
});
