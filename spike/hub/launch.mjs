// Spike 2: starts a slicer with a file the way the connector would, then logs when the spawned
// process exits and, every 2 s, how many slicer processes run (`match` = a fragment of the command
// line on macOS/Linux, the image name for tasklist), so a
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
    const procs = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.includes(match) && !l.includes("launch.mjs"));
    const key = procs.join("|");
    if (key !== seen) log("  ", procs.map((l) => l.trim().slice(0, 140)).join("\n        ") || "(none)");
    seen = key;
    return procs.length;
  } catch {
    return 0;
  }
};
let seen = "";

log("before", count(), "running");
// detached: on Windows a non-detached child sits in libuv's kill-on-close job object and dies with us.
const child = spawn(cmd, args, { stdio: "ignore", detached: true });
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
