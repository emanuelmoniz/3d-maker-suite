import { z } from "zod";

const bytes = z.number().nonnegative();

/** One drive, with the app's folders on it (several folders on one drive are one disk). */
export const systemDiskSchema = z.object({
  /** The drive root on Windows (`C:\`), else the first folder. */
  label: z.string(),
  paths: z.array(z.string()),
  total: bytes,
  free: bytes,
});

/**
 * A machine's live figures (Step 12 of 6.1.0): read on the machine, never stored. A connector
 * reports it every `SYSTEM_REPORT_MS` while connected; the hub keeps the last one in memory.
 */
export const systemInfoSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  cores: z.number().int().nonnegative(),
  memory: z.object({ total: bytes, used: bytes }),
  disks: z.array(systemDiskSchema).max(50),
  /** Non-internal IPv4 addresses. */
  addresses: z.array(z.string().max(64)).max(50),
  at: z.iso.datetime(),
});

/** A machine's last report; null while it's offline or hasn't reported yet. */
export const deviceSystemSchema = z.object({
  system: systemInfoSchema.nullable(),
  /** The address the hub sees the connector from. */
  seenFrom: z.string().nullable(),
});

/** This server's figures; in Docker, the addresses are the container's, so none are given. */
export const serverSystemSchema = systemInfoSchema.extend({ docker: z.boolean() });

/** How often a connected connector reports its system info, and how often a page refreshes it. */
export const SYSTEM_REPORT_MS = 30_000;

export type SystemInfo = z.infer<typeof systemInfoSchema>;
export type SystemDisk = z.infer<typeof systemDiskSchema>;
export type DeviceSystem = z.infer<typeof deviceSystemSchema>;
export type ServerSystem = z.infer<typeof serverSystemSchema>;
