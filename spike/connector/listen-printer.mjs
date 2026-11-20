// 6.3.0 Step 1 spike S5, run inside a connector container: the Bambu LAN adapter's own discovery
// (ssdp.ts) for 20 s, then MQTT over TLS by typed IP (user bblp, the access code), then HTTP and a
// WebSocket by typed IP. Prints one RESULT line per check.
import { createRequire } from "node:module";

const ip = process.argv[2] ?? "10.99.0.2";
const mode = process.argv[3] ?? "?";
const r = (s) => console.log(`RESULT ${mode}: ${s}`);
const { watchPrinters } = await import("/app/packages/adapters/bambu/src/lan/ssdp.ts");
const mqtt = createRequire("/app/packages/adapters/bambu/package.json")("mqtt");

const heard = new Map();
const stop = watchPrinters(
  (a) => heard.set(a.name, (heard.get(a.name) ?? 0) + 1),
  (port, code) => r(`listen on ${port} failed: ${code}`),
);
await new Promise((d) => setTimeout(d, 20_000));
stop();
r(`heard in 20 s: ${heard.size ? [...heard].map(([n, c]) => `${n}×${c}`).join(", ") : "nothing"}`);

await new Promise((done) => {
  const c = mqtt.connect(`mqtts://${ip}:8883`, {
    username: "bblp",
    password: "12345678",
    rejectUnauthorized: false,
    connectTimeout: 8000,
    reconnectPeriod: 0,
  });
  const end = (s) => {
    r(s);
    c.end(true);
    done();
  };
  c.on("connect", () => end(`mqtts://${ip}:8883 connected`));
  c.on("error", (e) => end(`mqtts://${ip}:8883 failed: ${e.message}`));
  setTimeout(() => end(`mqtts://${ip}:8883 timed out`), 10_000);
});

try {
  const res = await fetch(`http://${ip}:7125/`, { signal: AbortSignal.timeout(5000) });
  r(`http://${ip}:7125 ${res.status} ${await res.text()}`);
} catch (e) {
  r(`http://${ip}:7125 failed: ${e.message}`);
}
await new Promise((done) => {
  const ws = new WebSocket(`ws://${ip}:7125/ws`);
  const t = setTimeout(() => {
    r(`ws://${ip}:7125 timed out`);
    done();
  }, 5000);
  ws.onmessage = (m) => {
    clearTimeout(t);
    r(`ws://${ip}:7125 got "${m.data}"`);
    ws.close();
    done();
  };
  ws.onerror = () => {
    clearTimeout(t);
    r(`ws://${ip}:7125 failed`);
    done();
  };
});
process.exit(0);
