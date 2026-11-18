import { stat, statfs } from "node:fs/promises";
import { cpus, freemem, networkInterfaces, totalmem } from "node:os";
import { win32 } from "node:path";
import type { SystemDisk, SystemInfo } from "@3d-maker-suite/core";

/** Between the two CPU samples: Windows has no load average, so CPU % is measured over this. */
const CPU_SAMPLE_MS = 500;

/** The machine's non-internal IPv4 addresses. */
export function detectedIps(nets: ReturnType<typeof networkInterfaces> = networkInterfaces()) {
  return Object.values(nets)
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => (i as { address: string }).address);
}

type Deps = {
  cpus: typeof cpus;
  totalmem: typeof totalmem;
  freemem: typeof freemem;
  networkInterfaces: typeof networkInterfaces;
  stat: (path: string) => Promise<{ dev: number | bigint }>;
  statfs: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  wait: (ms: number) => Promise<void>;
  platform: NodeJS.Platform;
};

const realDeps: Deps = {
  cpus,
  totalmem,
  freemem,
  networkInterfaces,
  stat,
  statfs,
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  platform: process.platform,
};

const cpuTimes = (list: ReturnType<typeof cpus>) =>
  list.reduce(
    (sum, { times }) => {
      sum.idle += times.idle;
      sum.total += times.user + times.nice + times.sys + times.idle + times.irq;
      return sum;
    },
    { idle: 0, total: 0 },
  );

/** The folders grouped by the drive they're on, with that drive's size; unreadable ones skipped. */
async function readDisks(paths: string[], deps: Deps): Promise<SystemDisk[]> {
  const drives = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    try {
      const key = String((await deps.stat(path)).dev);
      drives.set(key, [...(drives.get(key) ?? []), path]);
    } catch {
      // Missing or not readable (a removed shared folder, a drive not plugged in).
    }
  }
  const disks: SystemDisk[] = [];
  for (const group of drives.values()) {
    const first = group[0] as string;
    try {
      const fs = await deps.statfs(first);
      disks.push({
        label: deps.platform === "win32" ? win32.parse(first).root || first : first,
        paths: group,
        total: fs.blocks * fs.bsize,
        free: fs.bavail * fs.bsize,
      });
    } catch {
      // A drive that went between the two calls.
    }
  }
  return disks;
}

/**
 * This machine's CPU, memory, the drives of `paths`, and addresses (Step 12 of 6.1.0). Takes
 * `CPU_SAMPLE_MS`: CPU % comes from two samples, the same on every OS.
 */
export async function readSystemInfo(
  paths: string[],
  overrides: Partial<Deps> = {},
): Promise<SystemInfo> {
  const deps = { ...realDeps, ...overrides };
  const before = cpuTimes(deps.cpus());
  const [disks] = await Promise.all([readDisks(paths, deps), deps.wait(CPU_SAMPLE_MS)]);
  const now = deps.cpus();
  const after = cpuTimes(now);
  const total = after.total - before.total;
  const busy = total > 0 ? 1 - (after.idle - before.idle) / total : 0;
  const memTotal = deps.totalmem();
  return {
    cpuPercent: Math.min(100, Math.max(0, Math.round(busy * 1000) / 10)),
    cores: now.length,
    memory: { total: memTotal, used: Math.max(0, memTotal - deps.freemem()) },
    disks,
    addresses: detectedIps(deps.networkInterfaces()),
    at: new Date().toISOString(),
  };
}
