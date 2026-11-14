// Spike 2: slice a model with OrcaSlicer for a Klipper printer, to get a real Orca G-code header.
// Run from the repo root (it reuses packages/slicer-presets to flatten Orca's system presets):
//   node spike/printers/orca-klipper.mjs <orca config dir> <orca-slicer exe> <model.stl> <out dir> [machine regex]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [configDir, exe, model, out, want = "Voron 2\\.4 300 0\\.4"] = process.argv.slice(2);
const { systemPresets } = await import(
  pathToFileURL(join(process.cwd(), "packages/slicer-presets/src/index.ts")).href
);
mkdirSync(out, { recursive: true });

const pick = async (kind, test) => {
  const all = await systemPresets(configDir, kind);
  for (const [name, file] of all.systemFiles) {
    if (!test(name)) continue;
    const preset = await all.load(file);
    if (preset?.instantiation !== "true") continue;
    return { name, flat: await all.flatten(preset, file) };
  }
  throw new Error(`no ${kind} preset`);
};

const machine = await pick("machine", (n) => new RegExp(want).test(n));
const vendor = machine.name.split(" ")[0];
const proc = await pick("process", (n) => n.startsWith("0.20mm Standard") && n.includes(vendor));
const fil = await pick("filament", (n) => /Generic PLA/.test(n) && n.includes(vendor)).catch(() =>
  pick("filament", (n) => /^Generic PLA @System/.test(n)),
);
console.log(machine.name, "|", proc.name, "|", fil.name, "| flavor:", machine.flat.gcode_flavor);

const file = (n, o) => {
  const f = join(out, n);
  writeFileSync(f, JSON.stringify(o));
  return f;
};
const r = spawnSync(
  exe,
  [
    "--slice", "0", "--allow-newer-file", "--logfile", join(out, "log.txt"), "--outputdir", out,
    "--load-settings",
    `${file("machine.json", machine.flat)};${file("process.json", { ...proc.flat, compatible_printers: [machine.name] })}`,
    "--load-filaments", file("filament.json", fil.flat),
    model,
  ],
  { timeout: 120_000, encoding: "utf8" },
);
console.log("exit", r.status, (r.stdout + r.stderr).split(/\r?\n/).slice(-4).join("\n"));
