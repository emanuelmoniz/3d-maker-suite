// Spike 2: starts a slicer with a file the way the connector would, then logs when the spawned
// process exits and, every 2 s, how many slicer processes run (`match` = the process name for
// pgrep -x, or the image name for tasklist), so a
// launcher that hands off (open -a, single instance) shows up as "spawned exited, slicer still running".
// node launch.mjs <seconds> <match> <cmd> [args...]
import { execFileSync, spawn } from "node:child_process";

const [seconds, match, cmd, ...args] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);
const count = () => {
  try {
    if (process.platform === "win32")
      return execFileSync("tasklist", ["/fi", `imagename eq ${match}`, "/fo", "csv", "/nh"], { encoding: "utf8" })
        .split("\n")
        .filter((l) => l.startsWith('"')).length;
    return execFileSync("pgrep", ["-x", match], { encoding: "utf8" }).trim().split("\n").length;
  } catch {
    return 0; // pgrep exits 1 when nothing matches
  }
};

log("before", count(), "running");
const child = spawn(cmd, args, { stdio: "ignore" });
log("spawned pid", child.pid);
child.on("exit", (code, sig) => log("spawned exited", code, sig ?? ""));
let last = -1;
const timer = setInterval(() => {
  const n = count();
  if (n !== last) log("slicer processes", n);
  last = n;
  if (n === 0 && child.exitCode !== null) end(); // all closed
}, 2000);
const end = () => {
  clearInterval(timer);
  log("end, spawned alive:", child.exitCode === null && child.signalCode === null, "slicer processes", count());
  process.exit(0);
};
setTimeout(end, Number(seconds) * 1000);
