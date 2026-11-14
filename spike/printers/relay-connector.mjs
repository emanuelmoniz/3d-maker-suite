// Spike 5: stand-in connector (runs on the host, next to the printers). Only outbound connections:
// SSE from the hub, POST to the hub. It polls the printers the hub assigned and relays a snapshot
// per poll; while the hub is away it keeps only the latest snapshot per printer.
// HUB=http://localhost:8099 node relay-connector.mjs [printing poll ms] [idle poll ms]
const HUB = process.env.HUB ?? "http://localhost:8099";
const [fast = 2000, slow = 10_000] = process.argv.slice(2).map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const timers = new Map();
const pending = new Map();
let online = false;

const post = async (path, data) => {
  const t = performance.now();
  const res = await fetch(HUB + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(String(res.status));
  return performance.now() - t;
};

/** Moonraker status → the snapshot shape of ADR-0015 (state, job file, progress, ETA, layer, temperatures). */
async function moonraker(p) {
  const r = await fetch(`${p.host}/printer/objects/query?print_stats&virtual_sdcard&display_status&extruder&heater_bed`, { signal: AbortSignal.timeout(4000) });
  const s = (await r.json()).result.status;
  const ps = s.print_stats;
  const progress = s.virtual_sdcard.progress;
  return {
    printerId: p.id,
    at: new Date().toISOString(),
    state: ps.state,
    file: ps.filename || null,
    progress,
    etaSec: progress > 0 && ps.state === "printing" ? Math.round(ps.print_duration / progress - ps.print_duration) : null,
    layer: ps.info?.current_layer ?? null,
    layers: ps.info?.total_layer ?? null,
    filamentUsedMm: ps.filament_used,
    temps: { nozzle: s.extruder.temperature, nozzleTarget: s.extruder.target, bed: s.heater_bed.temperature, bedTarget: s.heater_bed.target },
  };
}

const rtt = [];
async function relay(p) {
  let snap;
  try {
    snap = await moonraker(p);
  } catch {
    snap = { printerId: p.id, at: new Date().toISOString(), state: "offline" };
  }
  pending.set(p.id, snap);
  if (online)
    try {
      rtt.push(await post("/printers/status", snap));
      pending.delete(p.id);
    } catch {}
  timers.set(p.id, setTimeout(() => relay(p), snap.state === "printing" || snap.state === "paused" ? fast : slow));
}

async function onEvent(type, data) {
  if (type === "printers.assign") {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    log("assigned", data.printers.map((p) => p.id).join(","), "resending", pending.size, "held snapshot(s)");
    for (const p of data.printers) relay(p);
  }
  if (type === "printer.history") {
    // One fixed read; nothing the hub sends is run as a command (ADR-0014).
    const jobs = (await (await fetch("http://localhost:7125/server/history/list?limit=50&order=desc")).json()).result.jobs;
    await post(`/reply/${data.requestId}`, { jobs });
  }
}

for (;;) {
  try {
    const res = await fetch(`${HUB}/events`);
    online = true;
    log("hub connected");
    let buf = "";
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      buf += chunk;
      for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
        const block = buf.slice(0, i);
        const type = /^event: (.*)$/m.exec(block)?.[1];
        if (type) onEvent(type, JSON.parse(/^data: (.*)$/m.exec(block)[1])).catch((e) => log("event failed", e.message));
      }
    }
  } catch {}
  if (online) log("hub lost; POST round trip ms: median", rtt.sort((a, b) => a - b)[rtt.length >> 1]?.toFixed(1), "max", rtt.at(-1)?.toFixed(1), "n", rtt.length);
  online = false;
  await sleep(1000);
}
