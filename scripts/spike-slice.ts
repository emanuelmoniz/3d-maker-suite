// Throwaway proof for ADR-0007 (PLAN Step 12): slices one plate of a 3MF with the installed
// Bambu Studio / OrcaSlicer CLI and prints time and grams. Delete when Step 14 lands.
//   node scripts/spike-slice.ts <slicer exe> <file.3mf> [plate=1] [extra CLI flags...]
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse3mf } from "../packages/3mf/src/index.ts";

const [exe, file, plateArg = "1", ...extra] = process.argv.slice(2);
if (!exe || !file) {
  console.error("usage: node scripts/spike-slice.ts <slicer exe> <file.3mf> [plate] [flags...]");
  process.exit(2);
}
const plate = Number(plateArg);
const out = await mkdtemp(join(tmpdir(), "slice-"));
const args = [
  "--slice",
  String(plate),
  "--debug",
  "2",
  "--outputdir",
  out,
  "--export-3mf",
  "out.3mf",
  ...extra,
  resolve(file),
];

const started = Date.now();
const code = await new Promise<number | null>((ok, fail) => {
  const child = spawn(exe, args, { cwd: out, windowsHide: true, stdio: "ignore" });
  child.once("error", fail);
  child.once("exit", ok);
});
const seconds = (Date.now() - started) / 1000;
console.log(`exit ${code} after ${seconds.toFixed(1)} s, output in ${out}`);

const result = await readFile(join(out, "result.json"), "utf8").catch(() => null);
if (result) console.log("result.json:", result);

const info = await parse3mf(join(out, "out.3mf")).catch((e: Error) => {
  console.error("no sliced 3MF:", e.message);
  process.exit(1);
});
const p = info.plates.find((x) => x.index === plate);
if (!p?.sliced || p.printTimeSeconds == null) {
  console.error(`plate ${plate} has no slice results`);
  process.exit(1);
}
const t = p.printTimeSeconds;
console.log(
  `plate ${plate}: ${Math.floor(t / 3600)}h${String(Math.round((t % 3600) / 60)).padStart(2, "0")}, ` +
    `${p.weightGrams} g, ${seconds.toFixed(1)} s to slice`,
);
for (const f of p.filaments)
  console.log(`  slot ${f.slot} ${f.type} ${f.color} ${f.profile}: ${f.grams} g, ${f.meters} m`);
