// Spike 4/5 stand-in: loads what the connector will (core schemas, the 3MF parser), parses a file,
// uploads it and holds the SSE stream open. node src/main.ts <file.3mf> [hub url]
import { readFile } from "node:fs/promises";
import { parse3mf } from "@3d-maker-suite/3mf";
import * as core from "@3d-maker-suite/core";

const t0 = performance.now();
const bytes = await readFile(process.argv[2]);
const info = await parse3mf(bytes);
console.log("core exports", Object.keys(core).length, "plates", info.plates.length, `${(performance.now() - t0).toFixed(0)} ms`);
const hub = process.argv[3];
if (hub) {
  const up = await fetch(`${hub}/upload`, { method: "POST", body: bytes });
  console.log("upload", up.status, await up.text());
  const res = await fetch(`${hub}/events?hb=15`);
  for await (const chunk of res.body!) console.log(new TextDecoder().decode(chunk).trim());
}
