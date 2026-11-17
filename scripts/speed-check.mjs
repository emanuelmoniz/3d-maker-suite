// Quick machine check (~1 s) run before unit tests, so the developer can pick the
// test scope and timeouts. Reports CPU load, memory, power source and a short
// single-core benchmark. No dependencies.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";

const SAMPLE_MS = 500;

function cpuTimes() {
  return os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

function power() {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus"',
        { encoding: "utf8", timeout: 3000 },
      ).trim();
      if (!out) return "no battery";
      return out === "1" ? "on battery" : "battery, plugged in";
    }
    if (process.platform === "darwin") {
      const out = execSync("pmset -g batt", { encoding: "utf8", timeout: 3000 });
      if (!/InternalBattery/.test(out)) return "no battery";
      return /Battery Power/.test(out) ? "on battery" : "battery, plugged in";
    }
    const dir = "/sys/class/power_supply";
    if (!existsSync(dir)) return "unknown";
    const entries = readdirSync(dir);
    if (!entries.some((e) => e.startsWith("BAT"))) return "no battery";
    const ac = entries.find((e) => e.startsWith("A"));
    if (!ac) return "battery";
    return readFileSync(`${dir}/${ac}/online`, "utf8").trim() === "0"
      ? "on battery"
      : "battery, plugged in";
  } catch {
    return "unknown";
  }
}

// Fixed workload; the time it takes is the speed figure (lower = faster).
function bench() {
  const start = performance.now();
  let x = 0;
  for (let i = 0; i < 30_000_000; i++) x = (x + i * 7) % 1_000_003;
  const arr = Array.from({ length: 200_000 }, (_, i) => (i * 2654435761) % 1_000_000);
  arr.sort((a, b) => a - b);
  return { ms: Math.round(performance.now() - start), x };
}

const before = cpuTimes();
await new Promise((r) => setTimeout(r, SAMPLE_MS));
const after = cpuTimes();
let idle = 0;
let total = 0;
after.forEach((c, i) => {
  idle += c.idle - before[i].idle;
  total += c.total - before[i].total;
});
const cpuLoad = total > 0 ? Math.round((1 - idle / total) * 100) : 0;

const { ms } = bench();
const totalMem = os.totalmem();
const freeMem = os.freemem();
const gb = (b) => (b / 1024 ** 3).toFixed(1);

console.log(`CPU:       ${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads)`);
console.log(`CPU load:  ${cpuLoad}% (sampled ${SAMPLE_MS} ms)`);
console.log(
  `Memory:    ${gb(totalMem - freeMem)} / ${gb(totalMem)} GB used (${Math.round(((totalMem - freeMem) / totalMem) * 100)}%)`,
);
console.log(`Power:     ${power()}`);
console.log(`Benchmark: ${ms} ms (single core, lower is faster)`);
