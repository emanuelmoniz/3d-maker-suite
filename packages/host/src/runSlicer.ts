import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SliceRun } from "@3d-maker-suite/core";

const LINGER_MS = 3000;

/** The exit code as the program returned it: Windows passes 32 bits, POSIX only the low 8. */
export const signedExit = (code: number, platform = process.platform) =>
  platform === "win32" ? code | 0 : (code << 24) >> 24;

/**
 * Runs the slicer CLI until it exits, or until it wrote `result.json` and then lingers: some
 * results (e.g. PLA and PETG on one plate) leave it waiting on a warning box nobody can see, after
 * the work is done. It gets a few seconds to exit on its own, then it's killed. Resolves with the
 * signed exit code, or null when it was killed or crashed. Used on the server and on slice workers.
 */
export const runSlicer = (program: string, args: string[], cwd: string, signal: AbortSignal) =>
  new Promise<number | null>((ok, fail) => {
    const child = spawn(program, args, { cwd, signal, windowsHide: true, stdio: "ignore" });
    let doneAt = 0;
    const poll = setInterval(() => {
      if (!doneAt && existsSync(join(cwd, "result.json"))) doneAt = Date.now();
      if (doneAt && Date.now() - doneAt > LINGER_MS) child.kill();
    }, 500);
    child.once("error", (e) => {
      clearInterval(poll);
      fail(e);
    });
    child.once("exit", (code) => {
      clearInterval(poll);
      ok(code === null ? null : signedExit(code));
    });
  });

/**
 * The arguments of a slicer that starts through a command (`flatpak run <id>`, 6.2.0 Step 3h):
 * `command` goes before the slicer's own `args`. A Flatpak is sandboxed, so it is also given the
 * work folder (to write) and the folder of the 3MF (to read), which it can't see otherwise.
 */
export function commandArgs(
  program: string,
  command: string[],
  args: string[],
  file: string,
  dir: string,
) {
  const [first, ...rest] = command;
  const sandbox =
    basename(program) === "flatpak" && first === "run"
      ? [first, `--filesystem=${dir}`, `--filesystem=${dirname(file)}:ro`, ...rest]
      : command;
  return [...sandbox, ...args, file];
}

/** Runs a slicer through a command, as `commandArgs` builds it. */
export const runCommand =
  (command: string[]): SliceRun =>
  (program, args, file, dir, signal) =>
    runSlicer(program, commandArgs(program, command, args, file, dir), dir, signal);
