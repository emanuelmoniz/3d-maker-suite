# ADR-0007: Slicing with the installed slicer's CLI

- Status: Accepted
- Date: 2026-10-18

## Context
A project's cost estimate needs print time and grams per plate. Bambu Studio drops slice results when it saves a project (`parse3mf` sees `slicedOnSave` but no `slice_info`), so the numbers have to come from slicing. The estimate is only useful if it matches what the user's slicer and printer show.

## Decision
- **Slice with the CLI of the slicer installed on the server's PC.** Bambu Studio is first. The program is the integration's `slicerPath`, the presets come from its `slicerConfigDir`, and both are already stored per integration.
- Core gets a brand-agnostic capability in `packages/core/src/integrations`, next to `library`:
  ```ts
  interface SliceRequest {
    file: string; // absolute path, already checked with insideRoots
    plate: number; // 1-based
    machine?: string; // preset ids as the libraries name them; unset = keep the 3MF's
    process?: string;
    filaments?: (string | null)[]; // per slot; null = keep the 3MF's
  }
  interface SliceResult {
    plate: number;
    printTimeSeconds: number;
    weightGrams: number;
    filaments: { slot: number; grams: number; meters: number | null }[];
  }
  interface Slicer {
    id: string;
    slice(
      program: string,
      configDir: string,
      req: SliceRequest,
      signal: AbortSignal,
    ): Promise<SliceResult>;
  }
  // IntegrationAdapter gains `slicer?: Slicer`
  ```
  The CLI implementation lives in `packages/slicer-presets`, which already holds the shared Bambu/Orca preset reader. The Bambu adapter wires it the same way it wires `library`.
- **One run:** `bambu-studio.exe --slice <plate> --outputdir <tmp> --export-3mf out.3mf [--load-settings "machine.json;process.json"] [--load-filaments "f1.json;;f3.json"] <file>`, in a fresh temp dir that is also the process `cwd` (the slicers drop `result.json` and `00000.log` there on some paths), with `windowsHide`, killed on abort or after a wall-clock timeout. The temp dir is deleted afterwards.
  - Values come from `out.3mf` through `parse3mf` (the same `slice_info` code as for imported files).
  - Success and errors come from `<outputdir>/result.json` (`return_code`, `error_string`). No `result.json` means the slicer crashed.
  - Never trust stdout or the exit code alone: the exe is a GUI-subsystem binary and prints nothing.
- **Jobs:** one slice at a time, through an in-process FIFO queue in the server, with progress and errors per plate. It never blocks a request. Croner stays for schedules.
- **Cache:** results are keyed by `sha256(file bytes) + plate + slicer id + slicer version + sha256(canonical JSON of the preset files passed)`. A changed file, preset or slicer version means a re-slice. Results are stored with the project's slicing setup (Step 14).
- **Fallbacks:** time and grams can always be typed per plate, and a typed value overrides the sliced one. A sliced `.gcode.3mf` that already has `slice_info` is read as-is, with no slicing.

## Spike results (this PC, 2026-10-18)
Bambu Studio 02.08.02.61 and OrcaSlicer 2.4.2 on Windows 11. Script: `scripts/spike-slice.ts`.

| Run | Result | Wall time |
|---|---|---|
| Bambu, `single_color.3mf` plate 1 (file from 2.5.0.66), embedded settings | 0h30, 18.73 g | 0.3 s |
| Bambu, `multi_color.3mf` plate 1 (2.8.2.60, 4 filaments), embedded settings | 3h07, 124.71 g | 2.0 s |
| Same, slot 1 = user filament (`inherits` a system preset, density 1.5) | 3h02, 140.79 g (slot 1 98.33 → 115.04 g) | 2.0 s |
| Same, system machine + user process (40% infill, `compatible_printers` set) | 3h28, 161.04 g | 2.0 s |
| Bambu, `unsliced.3mf` (written by 02.00.00.00, no printer model) | crash, `0xC0000005`, no `result.json` (`--info` crashes too) | 0.3 s |
| Orca, any of the Bambu fixtures | refused (see below) | 0.3 s |

- The Bambu Studio GUI was open during all runs. There was no conflict.
- The CLI wrote nothing to `%APPDATA%\BambuStudio` (no config changes, no log files). The server's read-only promise for the slicer folder holds.
- **Presets:** user filament presets can be passed as-is, and the CLI resolves `inherits` itself. A process preset is refused (`-17`, "not compatible with the process preset") unless its `compatible_printers` lists the machine, so the adapter writes a temp copy with that list set. A user machine preset is refused (`-16`, "not compatible with the 3mf") even when it inherits the file's printer; system machine presets work. Open for Step 13/14: get user machine presets to pass, probably by flattening them onto the system parent's name; until then, keep the 3MF's machine.
- `result.json` also has `total_predication` (matches `slice_info` `prediction`), per-feature times, per-filament `total_used_g`, objects with bounding boxes, and `warning_message`.

## Update 2026-10-19 (checked against the G-code, Step 14)
- **Presets are flattened before they are passed.** The CLI follows neither `inherits` nor `include` of a preset file it is given. The A1's filament change G-code, with its purge, sits in an included template, so purges went missing (17.67 g against 19.67 g on a 2-colour plate). Parents are looked up in the child's vendor folder first: every vendor ships its own `fdm_machine_common`.
- **Every filament slot gets a file.** With fewer files than the project has slots, the CLI switches the prime tower off. Slots without a chosen filament use the 3MF's own preset.
- **The file's own edits are kept** (`different_settings_to_system`: process, then one entry per filament, printer last). They go on top of the chosen print profile, like Bambu Studio's "transfer changes", so e.g. supports switched on in the file stay on.
- `slice_info` `used_g` (= `result.json` `total_used_g`) covers everything extruded: model, supports, prime tower and purges. `main_used_g` is the model plus supports only. Summing the G-code per feature gives the same totals.
- After a slice with a warning (e.g. PLA and PETG on one plate), the CLI can wait on a hidden message box after writing `result.json`. It is stopped 3 s after `result.json` appears.
- With the same presets passed explicitly, results now match slicing with the file's own settings to the gram.

## Rejected options
- **OrcaSlicer CLI on Bambu projects (for now).** Orca 2.4.2 compares the file's Bambu Studio version with its own and refuses newer ones (`-24`). With `--allow-newer-file` it then looks for `resources/profiles/BBL/machine_full/*.json` and `process_full/*.json`, which the Windows release doesn't ship (`-18`), even when `--load-settings` is given. Getting past that would mean writing into Orca's install folder. Orca's `slicer` capability waits until it can be tested with Orca-made projects. Orca also writes no `result.json`, so its errors come from `--logfile`. Update (ADR-0013): Orca 2.5.0 with `--allow-newer-file` slices Bambu projects without the `*_full` files.
- **Bundling a slicer binary** (Orca or Prusa CLI, AGPL-3, about 150–300 MB per OS). Estimates drift unless its version and profiles match the user's slicer, and it adds licence and release-tracking work. Kept as an idea for headless or Docker servers. Replaced by ADR-0013: the slicer is downloaded from the vendor's release on request, not bundled.
- **An in-app JS/WASM slicer** (e.g. Kiri:Moto). It's a different engine, without Bambu machine/process profiles, painted multicolor or per-object modifiers, and with a different time model. That's weeks of work for numbers that don't match the printer.
- **Our own volume × infill heuristic.** Too rough; typing the numbers is more honest.
- **Online slicing APIs** (Printago, Cloud Slicer, CloudSlicer.io, RapidAPI estimators). They slice with their profiles, not the user's presets. They cost per call or per month, need an account and internet, and upload the user's models, which goes against ADR-0001. The `Slicer` interface allows an opt-in adapter later without touching core.
- **Bambu / MakerWorld cloud slicing.** It has no public API and only covers MakerWorld models.

## Risks and mitigations
- **The CLI is semi-documented** and changes with slicer releases. Mitigation: the adapter is isolated (ADR-0003), the slicer version is part of the cache key, results are read with our tested 3MF parser, and every failure is a per-plate error, never a server crash.
- **Crashes on some files** (old or odd 3MFs). Mitigation: no `result.json` maps to a `slice_failed` error on that plate, and the user can type the numbers.
- **Error codes:** `return_code` and `error_string` from `result.json` are shown as the reason (seen: `-16`, `-17`). They map to a new `slice_failed` `IntegrationErrorCode` with the slicer's text as detail.
- **Slow or huge plates:** the wall-clock timeout, the slicer's own `--mstpp` (per-plate seconds) and `--mtcpp` (triangles), and one job at a time keep the PC usable.
- **The slicer isn't installed** or the path is wrong (`ENOENT` on spawn): the UI says so and offers manual entry.
- Multi-nozzle printers (H2D `filament_map`) aren't covered by the fixtures. Test them when a file shows up.

## Consequences
- Slicing needs Bambu Studio on the server's PC. Manual entry and pre-sliced files still work without it.
- Estimates match the user's own slicer exactly for the same presets.
- Step 13 stores the machine, process and filament choices per plate. Step 14 adds the queue, the cache table, `slice_failed`, and the mock adapter's fake slicer.

## Sources (checked 2026-10)
- Bambu Studio wiki, Command Line Usage: https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage
- OrcaSlicer wiki, CLI (`cli_mode`, `cli_actions`, `cli_misc`): https://github.com/OrcaSlicer/OrcaSlicer/wiki
- Printago, Orca Slicer online: https://printago.io/features/orca-slicer
- Cloud Slicer: https://www.cloudslicer3d.com/ · CloudSlicer.io: https://cloudslicer.io/
- `result.json` keys found in `BambuStudio.dll` 02.08.02.61; Orca error causes from its `--logfile` output.
