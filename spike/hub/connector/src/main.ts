// Spike 4 stand-in: loads what the connector will (core schemas, the 3MF parser), parses a file and
// opens the SSE stream. node src/main.ts <file.3mf> [events url]
import { readFile } from "node:fs/promises";
import { parse3mf } from "@3d-maker-suite/3mf";
import * as core from "@3d-maker-suite/core";

const t0 = performance.now();
const info = await parse3mf(await readFile(process.argv[2]));
console.log("core exports", Object.keys(core).length, "plates", info.plates.length, `${(performance.now() - t0).toFixed(0)} ms`);
if (process.argv[3]) {
  const res = await fetch(process.argv[3]);
  for await (const chunk of res.body!) console.log(new TextDecoder().decode(chunk).trim());
}
