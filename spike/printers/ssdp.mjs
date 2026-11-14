// Spike 4: passive listen for Bambu's SSDP NOTIFY (239.255.255.250, ports 2021 and 1990).
// node ssdp.mjs [seconds] [out.json]   Sends nothing.
import { createSocket } from "node:dgram";
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

const secs = Number(process.argv[2] ?? 60);
const out = process.argv[3];
const seen = [];
const ifaces = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i.family === "IPv4" && !i.internal)
  .map((i) => i.address);

for (const port of [2021, 1990, 1900]) {
  const s = createSocket({ type: "udp4", reuseAddr: true });
  s.on("error", (e) => console.error(port, e.message));
  s.on("message", (buf, from) => {
    const text = buf.toString();
    if (!/bambu|bblp|3dprinter/i.test(text)) return;
    const first = !seen.some((m) => m.port === port && m.from === from.address);
    seen.push({ at: new Date().toISOString(), port, from: from.address, text });
    if (first) console.log(`--- port ${port} from ${from.address}\n${text}`);
  });
  s.bind(port, () => {
    for (const a of ifaces) {
      try {
        s.addMembership("239.255.255.250", a);
      } catch (e) {
        console.error(port, a, e.message);
      }
    }
  });
  setTimeout(() => s.close(), secs * 1000);
}
setTimeout(() => {
  const gaps = seen.slice(1).map((m, i) => Date.parse(m.at) - Date.parse(seen[i].at));
  console.log(`messages: ${seen.length}, gaps ms: ${gaps.join(",")}`);
  if (out) writeFileSync(out, JSON.stringify(seen, null, 2));
}, secs * 1000 - 50);
