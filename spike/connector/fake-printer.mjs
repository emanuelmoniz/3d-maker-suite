// 6.3.0 Step 1 spike S5: a printer on the "LAN" (its own network namespace, 10.99.0.2).
// Sends the A1's NOTIFY (fixture) every 2 s by each path, each named after the path so the listener
// can tell which ones arrive; answers HTTP and one WebSocket frame on 7125 (stands in for Moonraker,
// OctoPrint, PrusaLink and Spoolman). MQTT-TLS on 8883 is mosquitto, started next to it.
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const [fixture, ip = "10.99.0.2"] = process.argv.slice(2);
const base = readFileSync(fixture, "utf8").replace(/^Location:.*$/m, `Location: ${ip}`);
const msg = (name) => Buffer.from(base.replace(/^DevName\.bambu\.com:.*$/m, `DevName.bambu.com: ${name}`));

const s = createSocket({ type: "udp4", reuseAddr: true });
s.bind(() => {
  s.setBroadcast(true);
  s.setMulticastTTL(4);
  const paths = [
    ["bcast-subnet", "10.99.0.255"],
    ["bcast-all", "255.255.255.255"],
    ["mcast", "239.255.255.250"],
  ];
  setInterval(() => {
    for (const port of [2021, 1990])
      for (const [name, to] of paths) s.send(msg(`${name}-${port}`), port, to, () => {});
  }, 2000);
});

const http = createServer((_, res) => res.end(JSON.stringify({ result: "printer http ok" })));
http.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const text = Buffer.from("printer ws ok");
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
});
http.listen(7125, ip, () => console.log(`fake printer on ${ip}`));
