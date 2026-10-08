import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { SlicerLauncher } from "@3d-maker-suite/core";

/** Starts a program detached and resolves once the OS accepted it (rejects if it can't start). */
export const launch = (cmd: string, args: string[]) =>
  new Promise<void>((ok, fail) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", fail);
    child.once("spawn", () => {
      child.unref();
      ok();
    });
  });

/** Opens a folder in the OS file manager (Windows explorer, macOS open, Linux xdg-open). */
export const openFolder = (dir: string) =>
  launch(
    process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open",
    [dir],
  );

export const slicerLauncher = (slicerPath: string): SlicerLauncher => ({
  canOpen: () => slicerPath !== "",
  open: (filePath) => launch(slicerPath, [filePath]),
});

/**
 * The real path of `target` if it is `root` itself or inside one of the `roots`, else null.
 * Real paths on both sides, so `..` and symlinks can't escape. Missing paths give null.
 */
export async function insideRoots(target: string, roots: string[]): Promise<string | null> {
  const real = await realpath(resolve(target)).catch(() => null);
  if (!real) return null;
  for (const r of roots) {
    const rr = await realpath(resolve(r)).catch(() => null);
    if (!rr) continue;
    const rel = relative(rr, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return real;
  }
  return null;
}
