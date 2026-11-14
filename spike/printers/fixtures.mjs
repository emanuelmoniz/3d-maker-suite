// Turns the raw captures into the committed fixtures (run from the repo root, on `dev`):
//   node fixtures.mjs <raw dir> <slice work dir> [.env.spike]
// Raw captures stay out of git: the Bambu ones hold the serial, the IP and the access code's user.
// Everything written here is scrubbed, and the script fails if a secret survives.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [raw, work, envFile] = process.argv.slice(2);
const dest = (...p) => {
  const d = join(process.cwd(), ...p);
  mkdirSync(d, { recursive: true });
  return d;
};
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const ndjson = (f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const write = (dir, name, data) => writeFileSync(join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
const written = [];
const copyAll = (from, to, names) => {
  for (const [src, name = src] of names) {
    if (!existsSync(join(from, `${src}.json`))) continue;
    write(to, `${name}.json`, readJson(join(from, `${src}.json`)));
    written.push(join(to, `${name}.json`));
  }
};

// --- OctoPrint 1.11.8, virtual printer -------------------------------------------------------
if (existsSync(join(raw, "octoprint"))) {
  const from = join(raw, "octoprint");
  const to = dest("packages/adapters/octoprint/fixtures");
  copyAll(from, to, [
    ["version"], ["server"], ["connection"], ["upload"], ["download-range"],
    ["job-offline"], ["printer-offline", "printer-offline-409"], ["printer-idle"],
    ["job-printing-finished", "job-printing"], ["printer-printing-finished", "printer-printing"],
    ["job-finished"], ["job-cancelled"], ["file"], ["file-after-finished"], ["file-after-cancelled"],
  ]);
  // The push stream of both prints: every event, and the `current` messages around them.
  const push = ndjson(join(from, "ws.ndjson")).filter(({ msg }) => !msg.plugin && !msg.timelapse && !msg.history);
  write(to, "push-sequence.json", push);
  written.push(join(to, "push-sequence.json"));
}

// --- Moonraker (virtual-klipper-printer) + Spoolman -------------------------------------------
if (existsSync(join(raw, "moonraker", "history-totals.json"))) {
  const from = join(raw, "moonraker");
  const to = dest("packages/adapters/moonraker/fixtures");
  const scrub = (o) => JSON.parse(JSON.stringify(o).replace(/"cpu_info":"[^"]*"/, '"cpu_info":"4 core simulated"'));
  for (const f of readdirSync(from).filter((f) => f.endsWith(".json"))) {
    write(to, f, scrub(readJson(join(from, f))));
    written.push(join(to, f));
  }
  for (const f of ["status-error", "history-list-after-error", "printer-info-shutdown"])
    if (existsSync(join(raw, "moonraker-shutdown", `${f}.json`))) {
      write(to, `${f}.json`, scrub(readJson(join(raw, "moonraker-shutdown", `${f}.json`))));
      written.push(join(to, `${f}.json`));
    }
  // The websocket stream, thinned: Klipper sends a status update every 250 ms. Kept: everything
  // that isn't a status update or a load report, and the status updates that say something about
  // the job (print_stats, or every 20th one for progress).
  let n = 0;
  const ws = ndjson(join(from, "ws.ndjson")).filter(({ msg }) => {
    if (msg.method === "notify_proc_stat_update") return false;
    if (msg.method !== "notify_status_update") return true;
    return msg.params[0].print_stats?.state || n++ % 20 === 0;
  });
  write(to, "ws-sequence.json", ws);
  written.push(join(to, "ws-sequence.json"));
}

// --- PrusaLink: no printer here. Payloads published from real printers (see SOURCE.md) ---------
{
  const to = dest("packages/adapters/prusalink/fixtures");
  const file = {
    refs: { icon: "/thumb/s/usb/TabletStand3~4.BGC", thumbnail: "/thumb/l/usb/TabletStand3~4.BGC", download: "/usb/TabletStand3~4.BGC" },
    name: "TabletStand3~4.BGC",
    display_name: "TabletStand3.bgcode",
    path: "/usb",
    size: 754535,
    m_timestamp: 1698686881,
  };
  const all = {
    version: { api: "2.0.0", server: "2.1.2", text: "PrusaLink", hostname: "PrusaXL", firmware: "6.1.2+11023" },
    info: { nozzle_diameter: 0.4, mmu: false, serial: "serial-1337", hostname: "PrusaXL", min_extrusion_temp: 170, location: "Workshop", sd_ready: true, farm_mode: false },
    "legacy-printer": { telemetry: { material: "PLA" } },
    "status-idle": {
      storage: { path: "/usb/", name: "usb", read_only: false },
      printer: { state: "IDLE", temp_bed: 41.9, target_bed: 60.5, temp_nozzle: 47.8, target_nozzle: 210.1, axis_z: 1.8, axis_x: 7.9, axis_y: 8.4, flow: 100, speed: 100, fan_hotend: 100, fan_print: 75, status_connect: { ok: true, message: "" } },
    },
    "status-printing": {
      job: { id: 129, progress: 37.0, time_remaining: 73020, time_printing: 43987 },
      storage: { path: "/usb/", name: "usb", read_only: false },
      printer: { state: "PRINTING", temp_bed: 53.9, target_bed: 85.0, temp_nozzle: 6.0, target_nozzle: 0.0, axis_z: 5.0, flow: 100, speed: 100, fan_hotend: 5000, fan_print: 2500, status_connect: { ok: true, message: "" } },
    },
    "job-printing": { id: 129, state: "PRINTING", progress: 37.0, time_remaining: 73020, time_printing: 43987, file },
    "job-idle-mk3": { id: 129, state: "IDLE", progress: 0.0, time_remaining: null, time_printing: 0, file },
  };
  for (const [name, data] of Object.entries(all)) {
    write(to, `${name}.json`, data);
    written.push(join(to, `${name}.json`));
  }
}

// --- Job file headers -------------------------------------------------------------------------
if (work && existsSync(work)) {
  const to = dest("packages/3mf/fixtures/job-headers");
  for (const [src, name] of [
    ["cube_orca.gcode", "orcaslicer-klipper.gcode"],
    ["cube_prusaslicer.gcode", "prusaslicer-klipper.gcode"],
    ["cube_prusaslicer.bgcode", "prusaslicer.bgcode"],
    ["bbs/out.3mf", "bambu-studio.gcode.3mf"],
  ])
    copyFileSync(join(work, src), join(to, name));
  // Bambu Studio's plain G-code is large; its totals are in the first lines.
  for (const [src, name] of [["bbs/plate_1.gcode", "bambu-studio-1-filament.gcode.head"], ["bbs_multi/plate_1.gcode", "bambu-studio-4-filaments.gcode.head"]]) {
    const text = readFileSync(join(work, src), "utf8");
    writeFileSync(join(to, name), text.slice(0, text.indexOf("; CONFIG_BLOCK_START")).replace(/^; Certain features are offered.*$/m, "; (legal notice cut)"));
  }
}

// Nothing secret may survive.
if (envFile && existsSync(envFile)) {
  const secrets = readFileSync(envFile, "utf8").split(/\r?\n/).map((l) => l.slice(l.indexOf("=") + 1).trim()).filter((v) => v.length >= 6);
  for (const f of written) for (const s of secrets) if (readFileSync(f, "utf8").includes(s)) throw new Error(`secret left in ${f}`);
}
console.log(`${written.length} json fixtures written`);
