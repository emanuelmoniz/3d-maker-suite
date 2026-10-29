import { spawn } from "node:child_process";

/**
 * Starts a program detached and resolves once the OS accepted it (rejects if it can't start).
 * Detached, so a slicer outlives the process that started it (ADR-0014).
 */
export const launch = (cmd: string, args: string[]) =>
  new Promise<void>((ok, fail) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", fail);
    child.once("spawn", () => {
      child.unref();
      ok();
    });
  });
