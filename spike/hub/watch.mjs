// Spike 1: what recursive fs.watch reports while a slicer saves, plus a 10 ms poll that also
// catches short-lived temp files and size/mtime steps. Usage: node watch.mjs <dir> [seconds]
import { watch, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const seconds = Number(process.argv[3] ?? 0);
const t0 = performance.now();
const ms = () => (performance.now() - t0).toFixed(0).padStart(6);
const log = (...a) => console.log(ms(), ...a);

watch(dir, { recursive: true }, (event, name) => log("watch", event, name));

let last = new Map();
function snapshot() {
  const now = new Map();
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    try {
      const s = statSync(p);
      now.set(p.slice(dir.length + 1), `${s.size} ${s.mtimeMs.toFixed(0)} ino=${s.ino}`);
    } catch {} // gone between readdir and stat
  }
  return now;
}
last = snapshot();
log("start", [...last].map(([k, v]) => `${k} ${v}`).join(" | "));
setInterval(() => {
  const now = snapshot();
  for (const [k, v] of now) if (last.get(k) !== v) log("poll", last.has(k) ? "changed" : "added", k, v);
  for (const k of last.keys()) if (!now.has(k)) log("poll", "removed", k);
  last = now;
}, 10);
if (seconds) setTimeout(() => process.exit(0), seconds * 1000);
