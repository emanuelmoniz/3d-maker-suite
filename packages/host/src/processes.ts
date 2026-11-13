import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.exe$/, "")
    .replace(/[-_ ]/g, "");

/** `tasklist /fo csv /nh` or `ps -A -o comm=`; no output = we can't tell = running. */
export function isRunningIn(out: string, name: string) {
  if (!out.trim()) return true;
  return out.split(/\r?\n/).some((l) => {
    const proc = l.startsWith('"')
      ? l.slice(1, l.indexOf('"', 1))
      : (l.trim().split("/").at(-1) ?? "");
    return norm(proc) === norm(name);
  });
}

/** Every process's name, to tell whether a slicer is running. */
export const listProcesses = (platform: string = process.platform) =>
  exec(
    platform === "win32" ? "tasklist" : "ps",
    platform === "win32" ? ["/fo", "csv", "/nh"] : ["-A", "-o", "comm="],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  ).then(
    (r) => r.stdout,
    () => "",
  );
