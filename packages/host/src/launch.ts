import { spawn } from "node:child_process";

/**
 * Starts a program detached and resolves with its pid once the OS accepted it (rejects if it
 * can't start). Detached, so a slicer outlives the process that started it (ADR-0014).
 */
export const launch = (cmd: string, args: string[]) =>
  new Promise<number | undefined>((ok, fail) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", fail);
    child.once("spawn", () => {
      child.unref();
      ok(child.pid);
    });
  });

/** Opens a folder in the OS file manager (Windows explorer, macOS open, Linux xdg-open). */
export const openFolder = (dir: string) =>
  launch(
    process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open",
    [dir],
  );
