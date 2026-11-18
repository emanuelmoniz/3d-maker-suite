import { SYSTEM_REPORT_MS, type SystemInfo } from "@3d-maker-suite/core";
import { readSystemInfo } from "@3d-maker-suite/host";
import type { Request } from "./roots.ts";

/**
 * Tells the hub this machine's CPU, memory, disks and addresses (Step 12 of 6.1.0), for its
 * machine page: at once when connected, then every `SYSTEM_REPORT_MS`. The hub only keeps the last
 * one in memory, so a missed report just waits for the next.
 */
export function createSystemReport({
  request,
  paths,
  read = readSystemInfo,
  everyMs = SYSTEM_REPORT_MS,
}: {
  request: Request;
  /** The folders whose disks it reports: its data folder, synced folder and shared folders. */
  paths: () => string[];
  read?: (paths: string[]) => Promise<SystemInfo>;
  everyMs?: number;
}) {
  let timer: NodeJS.Timeout | undefined;

  const send = async () => {
    try {
      // A hub before 6.1.0 answers 404: nothing to do about it.
      await request("/system", { method: "PUT", body: await read(paths()) });
    } catch {
      // Offline between ticks: the next connect starts again.
    }
  };

  function stop() {
    clearInterval(timer);
    timer = undefined;
  }

  return {
    stop,
    start() {
      stop();
      timer = setInterval(() => void send(), everyMs);
      timer.unref();
      return send();
    },
  };
}
