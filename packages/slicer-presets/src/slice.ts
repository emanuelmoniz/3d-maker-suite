import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
const LINGER_MS = 3000;

const failed = (why: string) => new IntegrationError("slice_failed", why);

type Settings = Record<string, unknown>;
type Own = {
  machine?: string;
  /** Filament preset name per slot. */
  filaments: string[];
  /** What the 3MF changed from its presets, ready to put on top of a preset. */
  processEdits: Settings;
  machineEdits: Settings;
  filamentEdits: (slot: number) => Settings;
};

/**
 * The 3MF's own presets and its changes to them. `different_settings_to_system` lists the
 * changed keys per preset: the process first, then one entry per filament slot, the printer last.
 */
export async function presetsOf(file: string): Promise<Own> {
  const raw = await read3mfEntry(file, "Metadata/project_settings.config").catch(() => null);
  let j: Settings = {};
  try {
    j = raw ? JSON.parse(new TextDecoder().decode(raw)) : {};
  } catch {}
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const filaments = list(j.filament_settings_id);
  const changed = list(j.different_settings_to_system).map((s) => s.split(";").filter(Boolean));
  const pick = (keys: string[] = []) =>
    Object.fromEntries(keys.filter((k) => k in j).map((k) => [k, j[k]]));
  return {
    machine:
      typeof j.printer_settings_id === "string" ? j.printer_settings_id || undefined : undefined,
    filaments,
    processEdits: pick(changed[0]),
    machineEdits: changed.length > 1 ? pick(changed.at(-1)) : {},
    // Filament values are one per slot; keys laid out otherwise are left to the preset.
    filamentEdits: (slot) =>
      Object.fromEntries(
        (changed[slot + 1] ?? []).flatMap((k) => {
          const v = j[k];
          return Array.isArray(v) && v.length === filaments.length ? [[k, [v[slot]]]] : [];
        }),
      ),
  };
}

/** A user preset's file by its name, in any account folder. */
async function userFile(dir: string, kind: string, name: string) {
  for (const account of await dirs(join(dir, "user")))
    for (const f of await jsonFiles(join(dir, "user", account, kind), true)) {
      const p = await readJson(f);
      if ((typeof p?.name === "string" ? p.name : parse(f).name) === name) return f;
    }
}

/**
 * Runs the slicer until it exits, or until it wrote `result.json` and then lingers: some results
 * (e.g. PLA and PETG on one plate) leave it waiting on a warning box nobody can see, after the
 * work is done. It gets a few seconds to exit on its own, then it's killed.
 */
const run = (program: string, args: string[], cwd: string, signal: AbortSignal) =>
  new Promise<void>((ok, fail) => {
    const child = spawn(program, args, { cwd, signal, windowsHide: true, stdio: "ignore" });
    let doneAt = 0;
    const poll = setInterval(() => {
      if (!doneAt && existsSync(join(cwd, "result.json"))) doneAt = Date.now();
      if (doneAt && Date.now() - doneAt > LINGER_MS) child.kill();
    }, 500);
    const end = (e?: Error) => {
      clearInterval(poll);
      if (e) fail(e);
      else ok();
    };
    child.once("error", end);
    child.once("exit", () => end());
  });

export function cliSlicer(timeoutMs = TIMEOUT_MS): Slicer {
  return {
    async slice(program, configDir, req: SliceRequest, signal) {
      const out = await mkdtemp(join(tmpdir(), "3dms-slice-"));
      try {
        const args = ["--slice", String(req.plate), "--outputdir", out, "--export-3mf", "out.3mf"];
        const wantsFilament = req.filaments?.some(Boolean);
        const own = await presetsOf(req.file);
        const machine = own.machine;

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
          const machinePreset = await machines.load(machineFile);
          if (!proc) throw failed(`Print preset not found: ${name}`);
          if (!machinePreset) throw failed(`Printer preset unreadable: ${machine}`);
          // Flattened copies: the CLI ignores `inherits` (e.g. the A1's filament change G-code
          // with its purge lives in a parent, so purges went missing from the grams). The file's
          // own edits go on top, as Bambu Studio's "transfer changes" (e.g. supports switched on).
          const machineCopy = join(out, "machine.json");
          await writeFile(
            machineCopy,
            JSON.stringify({
              ...(await machines.flatten(machinePreset, machineFile)),
              ...own.machineEdits,
            }),
          );
          const procCopy = join(out, "process.json");
          await writeFile(
            procCopy,
            JSON.stringify({
              ...(await procs.flatten(proc, procFile)),
              ...own.processEdits,
              compatible_printers: [machine],
            }),
          );
          args.push("--load-settings", `${machineCopy};${procCopy}`);
        }

        if (wantsFilament && req.filaments) {
          const fils = await systemPresets(configDir, "filament");
          /** System ids drop the " @BBL A1" suffix: the variant made for this machine, else any. */
          const variantOf = async (base: string) => {
            let found: string | undefined;
            for (const [n, f] of fils.systemFiles) {
              if (baseName(n) !== base) continue;
              const p = await fils.load(f);
              if (p?.instantiation !== "true") continue;
              found ??= f;
              const fits = (await fils.resolver(p, f)).list("compatible_printers");
              if (machine && fits.includes(machine)) return f;
            }
            return found;
          };
          // Every slot gets a file: with fewer than the project has, the CLI turns the prime tower
          // off (purges then go elsewhere and the grams are wrong). Unpicked slots keep the 3MF's.
          const files: string[] = [];
          const slots = Math.max(req.filaments.length, own.filaments.length);
          for (let i = 0; i < slots; i++) {
            const id = req.filaments[i];
            const [scope, name = ""] = id ? id.split(/\/(.*)/) : ["file", own.filaments[i] ?? ""];
            const file =
              scope === "user"
                ? await userFile(configDir, "filament", name)
                : scope === "system"
                  ? await variantOf(name)
                  : (fils.systemFiles.get(name) ??
                    (await userFile(configDir, "filament", name)) ??
                    (await variantOf(baseName(name))));
            const preset = file && (await readJson(file));
            if (!preset) throw failed(`Filament preset not found: ${name}`);
            const copy = join(out, `filament_${files.length + 1}.json`);
            const edits = id ? {} : own.filamentEdits(i);
            await writeFile(
              copy,
              JSON.stringify({ ...(await fils.flatten(preset, file)), ...edits }),
            );
            files.push(copy);
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
