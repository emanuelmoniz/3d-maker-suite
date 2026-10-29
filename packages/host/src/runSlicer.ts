import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
