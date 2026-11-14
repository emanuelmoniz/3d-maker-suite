// Spike 1: OctoPrint payloads from the official image with its virtual printer (docker-compose.yml).
// OCTO_KEY=<api key> node octoprint.mjs <out dir> <file.gcode>
// Prints the file to the end, then again and cancels near 40%. REST answers as <name>.json,
// push messages (SockJS raw websocket, Node's global WebSocket) in ws.ndjson.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [out, file] = process.argv.slice(2);
const OP = process.env.OCTOPRINT ?? "http://localhost:5000";
const headers = { "X-Api-Key": process.env.OCTO_KEY };
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, init = {}) => {
  const res = await fetch(OP + path, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, text: text.slice(0, 500) };
  }
};
const save = (name, data) => (writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2)), data);
const get = async (name, path) => save(name, await call(path));
const post = (path, body) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const name = basename(file);

await get("version", "/api/version");
await get("server", "/api/server");
await get("job-offline", "/api/job");
save("printer-offline", await call("/api/printer")); // 409 while not connected

// Push: log in passively with the key to get a session, then authenticate the socket with it.
const login = await post("/api/login", { passive: true });
const ws = new WebSocket(`${OP.replace("http", "ws")}/sockjs/websocket`);
await new Promise((r) => ws.addEventListener("open", r));
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.history) msg.history = { logs: "(cut)", messages: "(cut)", ...msg.history, logs_: undefined };
  for (const k of ["current", "history"]) if (msg[k]) (msg[k].logs = `(${msg[k].logs?.length} lines cut)`), (msg[k].messages = "(cut)");
  appendFileSync(join(out, "ws.ndjson"), `${JSON.stringify({ at: new Date().toISOString(), msg })}\n`);
});
ws.send(JSON.stringify({ auth: `${login.name}:${login.session}` }));
ws.send(JSON.stringify({ throttle: 4 })); // one `current` every 2 s instead of every 500 ms

await post("/api/connection", { command: "connect", port: "VIRTUAL", baudrate: 115200 });
for (let i = 0; i < 20 && (await call("/api/connection")).current.state !== "Operational"; i++) await sleep(1000);
await get("connection", "/api/connection");
await get("printer-idle", "/api/printer");

const form = new FormData();
form.append("file", new Blob([readFileSync(file)]), name);
save("upload", await call("/api/files/local", { method: "POST", body: form }));
for (let i = 0; i < 30 && !(await call(`/api/files/local/${name}`)).gcodeAnalysis; i++) await sleep(1000);
await get("file", `/api/files/local/${name}`);
const range = await fetch(`${OP}/downloads/files/local/${name}`, { headers: { ...headers, Range: "bytes=-2048" } });
save("download-range", { status: range.status, contentRange: range.headers.get("content-range"), bytes: (await range.arrayBuffer()).byteLength });

for (const [label, cancelAt] of [["finished"], ["cancelled", 40]]) {
  await post(`/api/files/local/${name}`, { command: "select", print: true });
  let mid = false;
  for (;;) {
    await sleep(2000);
    const j = await call("/api/job");
    process.stdout.write(`\r${label} ${j.state} ${Math.round(j.progress.completion ?? 0)}%   `);
    if (!mid && j.progress.completion > 20) (mid = true), save(`job-printing-${label}`, j), await get(`printer-printing-${label}`, "/api/printer");
    if (cancelAt && j.progress.completion >= cancelAt && j.state === "Printing") await post("/api/job", { command: "cancel" });
    if (mid && j.state === "Operational") break;
  }
  console.log();
  await get(`job-${label}`, "/api/job");
  await get(`file-after-${label}`, `/api/files/local/${name}`);
}
await get("files", "/api/files?recursive=true");
await post("/api/connection", { command: "disconnect" });
await sleep(2000);
ws.close();
