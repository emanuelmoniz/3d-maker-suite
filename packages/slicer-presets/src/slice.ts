import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { parse3mf, read3mfEntry } from "@3d-maker-suite/3mf";
import { IntegrationError, type SliceRequest, type Slicer } from "@3d-maker-suite/core";
import { baseName, dirs, jsonFiles, readJson, systemPresets } from "./index.ts";

// Bambu Studio's CLI, as found in ADR-0007: one plate per run, in a fresh temp dir that is also
// the cwd. A process preset only applies together with a machine preset, and only when its
// `compatible_printers` lists that machine, so a temp copy gets the list set. Success and errors
// come from `result.json`; the exe prints nothing and its exit code isn't reliable.

const TIMEOUT_MS = 10 * 60_000;

const failed = (why: string) => new IntegrationError("slice_failed", why);

/** The 3MF's own machine preset name (`printer_settings_id`), if any. */
async function machineOf(file: string): Promise<string | undefined> {
  const raw = await read3mfEntry(file, "Metadata/project_settings.config").catch(() => null);
  if (!raw) return;
  try {
    const id = JSON.parse(new TextDecoder().decode(raw)).printer_settings_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return;
  }
}

/** A user preset's file by its name, in any account folder. */
async function userFile(dir: string, kind: string, name: string) {
  for (const account of await dirs(join(dir, "user")))
    for (const f of await jsonFiles(join(dir, "user", account, kind), true)) {
      const p = await readJson(f);
      if ((typeof p?.name === "string" ? p.name : parse(f).name) === name) return f;
    }
}

const run = (program: string, args: string[], cwd: string, signal: AbortSignal) =>
  new Promise<void>((ok, fail) => {
    const child = spawn(program, args, { cwd, signal, windowsHide: true, stdio: "ignore" });
    child.once("error", fail);
    child.once("exit", () => ok());
  });

export function cliSlicer(timeoutMs = TIMEOUT_MS): Slicer {
  return {
    async slice(program, configDir, req: SliceRequest, signal) {
      const out = await mkdtemp(join(tmpdir(), "3dms-slice-"));
      try {
        const args = ["--slice", String(req.plate), "--outputdir", out, "--export-3mf", "out.3mf"];
        const wantsFilament = req.filaments?.some(Boolean);
        const machine = req.process || wantsFilament ? await machineOf(req.file) : undefined;

        if (req.process) {
          const machines = await systemPresets(configDir, "machine");
          const machineFile = machine && machines.systemFiles.get(machine);
          // ponytail: system machine presets only (ADR-0007: user ones are refused by the CLI).
          if (!machine || !machineFile)
            throw failed(`No system printer preset "${machine ?? "?"}"`);
          const procs = await systemPresets(configDir, "process");
          const [scope, name = ""] = req.process.split(/\/(.*)/);
          const procFile =
            scope === "system"
              ? procs.systemFiles.get(name)
              : await userFile(configDir, "process", name);
          const proc = procFile && (await readJson(procFile));
          if (!proc) throw failed(`Print preset not found: ${name}`);
          const copy = join(out, "process.json");
          await writeFile(copy, JSON.stringify({ ...proc, compatible_printers: [machine] }));
          args.push("--load-settings", `${machineFile};${copy}`);
        }

        if (wantsFilament && req.filaments) {
          const fils = await systemPresets(configDir, "filament");
          const files: string[] = [];
          for (const id of req.filaments) {
            if (!id) {
              files.push("");
              continue;
            }
            const [scope, name = ""] = id.split(/\/(.*)/);
            let file: string | undefined;
            if (scope === "user") file = await userFile(configDir, "filament", name);
            else {
              // System ids drop the " @BBL A1" suffix: take the variant made for this machine.
              const variants = [...fils.systemFiles].filter(([n]) => baseName(n) === name);
              for (const [, f] of variants) {
                const p = await fils.load(f);
                if (p?.instantiation !== "true") continue;
                file ??= f;
                if (
                  machine &&
                  (await fils.resolver(p)).list("compatible_printers").includes(machine)
                ) {
                  file = f;
                  break;
                }
              }
            }
            if (!file) throw failed(`Filament preset not found: ${name}`);
            files.push(file);
          }
          args.push("--load-filaments", files.join(";"));
        }

        await run(
          program,
          [...args, req.file],
          out,
          AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        ).catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") throw failed(`Slicer program not found: ${program}`);
          if (e.name === "AbortError") throw failed("Slicing took too long and was stopped");
          throw e;
        });

        const result = await readFile(join(out, "result.json"), "utf8")
          .then((t) => JSON.parse(t) as { return_code?: number; error_string?: string })
          .catch(() => null);
        if (!result) throw failed("The slicer crashed");
        if (result.return_code !== 0)
          throw failed(`${result.error_string ?? "Unknown error"} (${result.return_code})`);

        const info = await parse3mf(join(out, "out.3mf")).catch(() => null);
        const plate = info?.plates.find((p) => p.index === req.plate);
        if (!plate?.sliced || plate.printTimeSeconds == null) throw failed("No slice results");
        const filaments = plate.filaments.map((f) => ({
          slot: f.slot,
          grams: f.grams ?? 0,
          material: f.type,
        }));
        return {
          printTimeSeconds: Math.round(plate.printTimeSeconds),
          weightGrams: plate.weightGrams ?? filaments.reduce((g, f) => g + f.grams, 0),
          filaments,
        };
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    },
  };
}
