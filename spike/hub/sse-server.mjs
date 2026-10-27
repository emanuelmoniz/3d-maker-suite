// Spike 3: SSE like GET /api/hub/events. Event ids are time-based (one per 2 s), so a restarted
// server still knows them and a reconnect with Last-Event-ID replays what was missed.
// /events?hb=15 (comment heartbeat, s, 0 = off) &quiet=1 (heartbeats only) &xaccel=0 (no X-Accel-Buffering)
import { createServer } from "node:http";

const EVERY = 2000;
const idNow = () => Math.floor(Date.now() / EVERY);
const event = (id) => `id: ${id}\ndata: {"t":${id * EVERY}}\n\n`;

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/events") return res.writeHead(404).end();
  const hb = Number(url.searchParams.get("hb") ?? 15);
  const quiet = url.searchParams.get("quiet") === "1";
  const headers = { "content-type": "text/event-stream", "cache-control": "no-cache" };
  if (url.searchParams.get("xaccel") !== "0") headers["x-accel-buffering"] = "no";
  res.writeHead(200, headers);
  res.write(": open\n\n");
  let last = Number(req.headers["last-event-id"] ?? idNow());
  const tick = setInterval(() => {
    if (quiet) return;
    while (last < idNow()) res.write(event(++last)); // replay after a reconnect, then live
  }, 100);
  const beat = hb ? setInterval(() => res.write(": hb\n\n"), hb * 1000) : null;
  req.on("close", () => (clearInterval(tick), clearInterval(beat)));
}).listen(8080, () => console.log("sse on 8080"));
