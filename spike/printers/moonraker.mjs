// Spike 1: Moonraker payloads from the virtual Klipper printer (docker-compose.yml).
//   node moonraker.mjs <out dir> <file.gcode> finish          print the file to the end
//   node moonraker.mjs <out dir> <file.gcode> cancel:0.4      cancel it at 40% (0 = now)
// A print that is already running is joined instead of started. A Spoolman spool is made active
// first. Saves every REST answer as <name>.json and appends every websocket message to ws.ndjson.
// The simulated MCU can't keep real time: `docker restart` the container before a run and keep
// `microsteps: 1` in its config addons, or Klipper shuts down with "Timer too close".
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [out, file, mode = "finish"] = process.argv.slice(2);
const cancelAt = mode.startsWith("cancel") ? Number(mode.split(":")[1] ?? 0) : null;
const MR = process.env.MOONRAKER ?? "http://localhost:7125";
const SM = process.env.SPOOLMAN ?? "http://localhost:7913"; // the throwaway one, never a real Spoolman
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (base, path, init) => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, text };
  }
};
const save = (name, data) => (writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2)), data);
const get = async (name, path, base = MR) => save(name, await call(base, path));
const post = (path, body, base = MR) =>
  call(base, path, {
    method: "POST",
    ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
const OBJECTS = "print_stats&virtual_sdcard&display_status&extruder&heater_bed&toolhead&webhooks&idle_timeout&gcode_move";
const query = (name) => get(name, `/printer/objects/query?${OBJECTS}`);
const stats = async () => (await call(MR, "/printer/objects/query?print_stats&virtual_sdcard")).result.status;

for (let i = 0; i < 60 && (await call(MR, "/printer/info")).result?.state !== "ready"; i++) await sleep(1000);

// Websocket: everything Moonraker pushes, with our receive time.
const ws = new WebSocket(`${MR.replace("http", "ws")}/websocket`);
await new Promise((r) => ws.addEventListener("open", r));
ws.addEventListener("message", (m) =>
  appendFileSync(join(out, "ws.ndjson"), `${JSON.stringify({ at: new Date().toISOString(), msg: JSON.parse(m.data) })}\n`),
);
const objects = Object.fromEntries(OBJECTS.split("&").map((o) => [o, null]));
ws.send(JSON.stringify({ jsonrpc: "2.0", method: "printer.objects.subscribe", params: { objects }, id: 1 }));

const name = basename(file);
const id = name.replace(/\.\w+$/, "");
let spoolId = (await call(MR, "/server/spoolman/spool_id")).result.spool_id;

if ((await stats()).print_stats.state !== "printing") {
  await get("server-info", "/server/info");
  await get("printer-info", "/printer/info");
  await get("objects-list", "/printer/objects/list");
  await query("status-idle");
  if (!spoolId) {
    const vendor = await post("/api/v1/vendor", { name: "Spike" }, SM);
    const filament = await post("/api/v1/filament", { name: "PLA Spike", vendor_id: vendor.id, material: "PLA", density: 1.24, diameter: 1.75, weight: 1000, color_hex: "29B2B2" }, SM);
    spoolId = (await post("/api/v1/spool", { filament_id: filament.id, initial_weight: 1000 }, SM)).id;
    save("spoolman-set-active", await post("/server/spoolman/spool_id", { spool_id: spoolId }));
  }
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)]), name);
  save(`upload-${id}`, await call(MR, "/server/files/upload", { method: "POST", body: form }));
  await sleep(3000); // metadata is extracted after the upload
  await get(`metadata-${id}`, `/server/files/metadata?filename=${encodeURIComponent(name)}`);
  const started = save(`start-${id}`, await post(`/printer/print/start?filename=${encodeURIComponent(name)}`));
  if (started.error) throw new Error(`start failed: ${started.error.message}`);
}
await get("spoolman-spool-id", "/server/spoolman/spool_id");
await get("spoolman-status", "/server/spoolman/status");
const before = await call(SM, `/api/v1/spool/${spoolId}`);

let mid = false;
let end;
for (;;) {
  await sleep(2000);
  const s = await stats();
  process.stdout.write(`\r${mode} ${s.print_stats.state} ${(s.virtual_sdcard.progress * 100).toFixed(1)}%  `);
  if (!mid && s.print_stats.print_duration > 0) (mid = true), await query(`status-printing-${id}`);
  if (cancelAt !== null && mid && s.virtual_sdcard.progress >= cancelAt && s.print_stats.state === "printing")
    save("cancel", await post("/printer/print/cancel"));
  if (["complete", "cancelled", "error"].includes(s.print_stats.state)) {
    end = s.print_stats.state;
    break;
  }
}
console.log();
await query(`status-${end}`);
await sleep(8000); // history and the Spoolman report follow the end of the job
await get(`history-list-after-${end}`, "/server/history/list?limit=10&order=desc");
save(`spoolman-spool-around-${end}`, { before, after: await call(SM, `/api/v1/spool/${spoolId}`) });
await get(`spoolman-status-after-${end}`, "/server/spoolman/status");
await get("history-totals", "/server/history/totals");
ws.close();
