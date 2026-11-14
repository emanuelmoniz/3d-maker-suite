// Spike 5: stand-in hub (runs in the `hub` container, on a network without the printers).
// The ADR-0014 channel shape: SSE down (GET /events), POST up. The hub never opens a connection.
//   GET  /events            SSE to the connector: `printers.assign` on connect, `printer.history` on demand
//   POST /printers/status   a snapshot from the connector
//   POST /reply/<id>        the answer to a request event
//   GET  /ask-history       asks the connector for a printer's history, answers with the round trip
//   GET  /stats             what arrived: count, bytes, per printer the last snapshot
//   GET  /probe?url=        the hub tries the printer itself (expected to fail)
import { createServer } from "node:http";

const PRINTERS = JSON.parse(process.env.PRINTERS ?? '[{"id":"mr1","adapter":"moonraker","host":"http://localhost:7125"}]');
const started = Date.now();
let stream = null;
let eventId = 0;
const waiting = new Map();
const stats = { snapshots: 0, bytes: 0, connects: 0, last: {}, perState: {} };
const body = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)).on("end", () => r(Buffer.concat(c))); });
const send = (type, data) => stream?.write(`id: ${++eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (res, o, code = 200) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" });
    res.write(": open\n\n");
    stream = res;
    stats.connects++;
    send("printers.assign", { printers: PRINTERS });
    const beat = setInterval(() => res.write(": hb\n\n"), 15_000);
    req.on("close", () => (clearInterval(beat), stream === res && (stream = null)));
    return;
  }
  if (url.pathname === "/printers/status" && req.method === "POST") {
    const raw = await body(req);
    const snap = JSON.parse(raw);
    stats.snapshots++;
    stats.bytes += raw.length;
    const s = (stats.perState[snap.state] ??= { snapshots: 0, bytes: 0 });
    s.snapshots++;
    s.bytes += raw.length;
    stats.last[snap.printerId] = { receivedAt: new Date().toISOString(), delayMs: Date.now() - Date.parse(snap.at), snap };
    return json(res, { ok: true });
  }
  if (url.pathname.startsWith("/reply/") && req.method === "POST") {
    waiting.get(url.pathname.slice(7))?.(JSON.parse(await body(req)));
    return json(res, { ok: true });
  }
  if (url.pathname === "/ask-history") {
    if (!stream) return json(res, { error: "connector offline" }, 503);
    const requestId = crypto.randomUUID();
    const t = Date.now();
    const reply = await new Promise((r) => {
      waiting.set(requestId, r);
      send("printer.history", { requestId, printerId: url.searchParams.get("printer") ?? PRINTERS[0].id });
      setTimeout(() => r(null), 10_000);
    });
    waiting.delete(requestId);
    return json(res, { roundTripMs: Date.now() - t, jobs: reply?.jobs?.length ?? null, bytes: JSON.stringify(reply ?? "").length });
  }
  if (url.pathname === "/stats") return json(res, { upSec: Math.round((Date.now() - started) / 1000), connected: !!stream, ...stats });
  if (url.pathname === "/probe")
    return json(res, await fetch(url.searchParams.get("url"), { signal: AbortSignal.timeout(4000) }).then((r) => ({ reached: true, status: r.status }), (e) => ({ reached: false, error: String(e.cause?.code ?? e.cause ?? e.message) })));
  res.writeHead(404).end();
}).listen(8080, () => console.log("relay hub on 8080"));
