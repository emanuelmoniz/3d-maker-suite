// Spike 1 + 3: Bambu LAN MQTT, read-only. Subscribes to the printer's report topic and sends the
// two read requests (get_version, pushall). Nothing here controls the printer.
// node bambu.mjs <.env.spike> <out dir> [minutes, default: until stopped]
// .env.spike: BAMBU_ACCESS_CODE=... and optionally BAMBU_HOST=, BAMBU_SERIAL= (else found by SSDP).
import { createSocket } from "node:dgram";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import mqtt from "mqtt";

const [envFile, out, minutes] = process.argv.slice(2);
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** The printer's NOTIFY (every ~10 s on 2021 and 1990) carries its IP and serial. */
const discover = () =>
  new Promise((resolve, reject) => {
    const s = createSocket({ type: "udp4", reuseAddr: true });
    s.on("message", (buf) => {
      const text = buf.toString();
      if (!text.includes("urn:bambulab-com:device:3dprinter:1")) return;
      const h = (k) => new RegExp(`^${k}: *(.*)$`, "mi").exec(text)?.[1].trim();
      s.close();
      resolve({ host: h("Location"), serial: h("USN") });
    });
    s.bind(2021, () => {
      for (const i of Object.values(networkInterfaces()).flat())
        if (i.family === "IPv4" && !i.internal) try { s.addMembership("239.255.255.250", i.address); } catch {}
    });
    setTimeout(() => reject(new Error("no Bambu printer announced itself in 30 s")), 30_000).unref();
  });

const found = env.BAMBU_HOST && env.BAMBU_SERIAL ? {} : await discover();
const host = env.BAMBU_HOST ?? found.host;
const serial = env.BAMBU_SERIAL ?? found.serial;
const client = mqtt.connect(`mqtts://${host}:8883`, {
  username: "bblp",
  password: env.BAMBU_ACCESS_CODE,
  rejectUnauthorized: false, // the printer's certificate is signed by Bambu's own CA ("BBL CA")
  reconnectPeriod: 5000,
});
const request = (payload) => client.publish(`device/${serial}/request`, JSON.stringify(payload));
let seq = 0;
let last = "";

client.on("connect", () => {
  log("connected");
  client.subscribe(`device/${serial}/report`, (err, granted) => {
    log("subscribe", err?.message ?? `qos ${granted?.[0]?.qos}`);
    request({ info: { sequence_id: String(seq++), command: "get_version" } });
    request({ pushing: { sequence_id: String(seq++), command: "pushall" } });
  });
});
client.on("error", (e) => log("error", e.message, e.code ?? ""));
client.on("close", () => log("closed"));
client.on("message", (_topic, buf) => {
  const at = new Date().toISOString();
  let msg;
  try {
    msg = JSON.parse(buf.toString());
  } catch {
    msg = { raw: buf.toString() };
  }
  appendFileSync(join(out, "mqtt.ndjson"), `${JSON.stringify({ at, bytes: buf.length, msg })}\n`);
  const p = msg.print;
  if (!p) return log("message", Object.keys(msg).join(","), msg.info?.command ?? "");
  // One line whenever something the job tracker cares about changes.
  const line = ["gcode_state", "mc_percent", "layer_num", "total_layer_num", "mc_remaining_time", "subtask_name", "task_id", "subtask_id", "job_id", "gcode_start_time", "print_error"]
    .filter((k) => p[k] !== undefined)
    .map((k) => `${k}=${p[k]}`)
    .join(" ");
  if (line && line !== last) log(`${p.command} (${Object.keys(p).length} keys, ${buf.length} B)`, (last = line));
});
// P1 and A1 printers push only what changed; a full status needs pushall (Bambu asks: not more often than every 5 min).
setInterval(() => client.connected && request({ pushing: { sequence_id: String(seq++), command: "pushall" } }), 5 * 60_000);
if (minutes) setTimeout(() => client.end(false, () => process.exit(0)), Number(minutes) * 60_000);
