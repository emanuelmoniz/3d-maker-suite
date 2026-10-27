// Spike 3: the connector's side. fetch streaming, reconnect with Last-Event-ID after 1 s, log
// latency per live event, every gap in ids and every disconnect. Usage: node sse-client.mjs <url> <seconds>
const [url, seconds = "60"] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);
const end = t0 + Number(seconds) * 1000;
let lastId = null;
let beats = 0;

while (Date.now() < end) {
  const since = Date.now();
  try {
    const ctl = new AbortController();
    const stop = setTimeout(() => ctl.abort(), end - Date.now());
    const res = await fetch(url, { signal: ctl.signal, headers: lastId ? { "last-event-id": String(lastId) } : {} });
    log("connected", res.status, res.headers.get("content-type"), res.headers.get("content-encoding") ?? "");
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const msg = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (msg.startsWith(":")) { beats++; continue; }
        const id = Number(/^id: (\d+)/m.exec(msg)?.[1]);
        const lag = Date.now() - JSON.parse(/^data: (.*)$/m.exec(msg)[1]).t;
        if (lastId && id !== lastId + 1) log("GAP", lastId, "->", id);
        if (lag > 1500) log("late/replayed", id, `${lag} ms`);
        else if (id % 5 === 0) log("event", id, `${lag} ms`);
        lastId = id;
      }
    }
    clearTimeout(stop);
    log("stream ended by peer after", ((Date.now() - since) / 1000).toFixed(1), "s");
  } catch (e) {
    if (Date.now() >= end) break;
    log("error after", ((Date.now() - since) / 1000).toFixed(1), "s:", e.cause?.code ?? e.message);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
log("done, heartbeats", beats, "last id", lastId);
process.exit(0);
