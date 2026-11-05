# ADR-0017: Shared slicer presets

- Status: Accepted (Plan 5.1.0 Step 14, after the preset spike). Amended by ADR-0019: its delete rule, and its rejection of reading Bambu's preset API.
- Date: 2026-11-02

## Context
A hub slices with a managed slicer (ADR-0013) and with slice workers (ADR-0014), but user presets reach it only through the slicer zip, which replaces the managed slicer's `config/user` wholesale. Workstations each keep their own presets, and Bambu Studio and OrcaSlicer sync them through their own cloud accounts. A saved 3MF already holds its resolved settings, so slicing "as saved" needs no presets. They matter when the app overrides the print, filament or printer (Print setup, filament prices and densities from `slicerPresetLibrary.read`) and for the same results on every worker.

Hosted farm tools solve this one way. Printago reads presets from Bambu Cloud (an undocumented API) or from uploaded preset bundles, and keeps them in its own library; a delete in the Bambu account doesn't reach it. SimplyPrint has organization profiles. None of them writes presets back into a desktop slicer. That two-way flow is what this ADR adds, and Bambu Studio's and OrcaSlicer's cloud sync rules decide how.

## Decision

### Library
- One preset library on the hub, per slicer library id (`bambu-studio`, `orca-slicer`, the ids `presetLibrary(adapter)` already uses) and kind (`machine`, `process`, `filament`).
- **Hub only.** A single-PC install already slices with its desktop slicer folder.
- The managed slicer's `config/user` becomes a junction to the library's folder on disk, like `config/system` (ADR-0013). A worker integration's `slicerConfigDir` points at the same folder, so workers get the presets inline with each slice, as they do today.
- The slicer zip **merges** into the library instead of replacing `config/user`.
- A preset change marks the slices that used it outdated. The slice cache has no preset sha today: the fingerprint is the file sha, print profile, integration and slicer version. So a preset sha joins the fingerprint.

### Storage
Two tables, `slicer_presets` and `slicer_preset_versions`:

| Column | Notes |
|---|---|
| `library`, `kind`, `name` | unique together |
| `json` | the preset as received |
| `sha256` | of the **canonical** json (below) |
| `version` | +1 per change; uploads send their base version |
| `deleted` | tombstone |
| `seq` | change cursor for devices, as `hub_files.seq` |
| `savedUser`, `savedDevice`, `savedAt` | who saved it, from where, when |
| `removedOn` | ids of the devices that deleted their copy; only shown |

`slicer_preset_versions` keeps earlier versions (`json`, `sha256`, `version`, the saved fields), pruned like hub file versions (`hubVersionsKeep`).

The hub writes each live preset to `<dataDir>/presets/<library>/default/<kind>/<name>.json`, which is the folder the junction points at. The tables are the source of truth; the folder is rebuilt from them on start and kept current on each change.

**Canonical json:** parse, sort keys, serialize without whitespace. Both clouds re-serialize what they store (sorted keys; Studio indents with 4 spaces, Orca with tabs), so raw bytes are not comparable between a device and the cloud.

### Two switches per device
Off by default, set in Hub management by `presets.manage`:
- **Share my presets** (desktop → hub). The connector watches the user preset folder of the account each slicer last used (`app.preset_folder` in `BambuStudio.conf` / `OrcaSlicer.conf`; empty or missing = `default`). It uploads a changed `.json` with its base version. It ignores `.info` files: Studio rewrites them on every start without a change.
- **Install hub presets** (hub → desktop). The connector writes hub changes into that same folder, following the cloud rules below.

### Conflicts
- The same canonical sha is never a conflict and is never sent again. This also stops the same-account loop: a preset that comes back through the slicer's cloud has the sha the hub already holds. The one exception settles by itself: a cloud copy drops values that only repeat the parent's, which changes the sha, so with Share on that download makes one more hub version with the same settings, and no further ones. It holds against a hub delete too: only an edit brings a deleted preset back.
- A stale base with other content becomes a conflict copy named as hub files are (`<name> (conflict <who> <when>)`, `conflictName` in `hubFiles.ts`). The `name` inside the json is renamed too, plus a `preset_conflict` alert.
- Json that doesn't parse is rejected with a `preset_skipped` alert and never stored or written. `"nil"` values are valid: they mean "inherit from the parent", and both slicers load them.

### Bambu Studio and OrcaSlicer rules
The desktop folder is `user/<account id>/<kind>/` when signed in and `user/default/<kind>/` when signed out. Each preset is a `.json`, and in an account folder also a `.info` (`sync_info`, `user_id`, `setting_id`, `base_id`, `updated_time`). Orca writes the same `.info` format. The writer:
- **Writes only while that slicer is closed.** Both read presets at startup and at sign-in, never while running. Writes queue until the slicer's process (`bambu-studio`, `orca-slicer`) is gone. The check-out lock's exit detection only knows the pids the connector started, so this adds a check by process name.
- **New preset:** `.info` with `sync_info = create`, an empty `setting_id`, the folder's `user_id`, `base_id` = the `setting_id` of the first system preset up its `inherits` chain (not the root: a system `@base` has no `setting_id`), and `updated_time` = now. The slicer uploads it at its next start.
- **Changed preset:** keep `setting_id`, set `sync_info = update`, `updated_time` = max(old + 1, now + the adapter's lead). The slicer takes the cloud's copy when that looks newer, and old + 1 isn't always enough: Bambu's cloud holds real time + 8 h, while after a `create` Studio stores + 7 h until its next start. A hub edit in that window was silently lost, so Bambu's lead is 9 h. It only lasts until the upload at the slicer's next start, which sets the real value. Orca's times are real UTC, so its lead is 0.
- **Never** `create` under a name that already has a cloud copy: Orca replaces the local file with the cloud copy at start. Any `setting_id` in the `.info` means a cloud copy, including Orca's `sync_info = delete` tombstones, which have no `.json`. A PC that hasn't downloaded the cloud copy yet can't know about it, so a kept earlier version's sha coming back is answered as `same`: an older cloud copy doesn't undo the hub's edit. The cost is that a preset put back by hand to a kept version's exact content is ignored until it's edited.
- `.info` files use LF on every OS, and are written before the `.json`, so a failure in between is written again rather than leaving an edit never marked for upload.
- **`user/default`:** `.json` only. No `.info` is needed, and none is created.
- **Deletes never reach desktops**, because the cloud brings them back at the next start. A hub delete removes the preset from the hub and workers, and tells the user to delete it in each slicer. A desktop delete only shows "removed on <device>" on the preset. *Amended by ADR-0019: deletes now reach signed-out folders and OrcaCloud accounts; this rule stays only for a signed-in Bambu Studio.*
- **Skip** a preset whose `inherits` parent this slicer lacks, with a `preset_skipped` alert. **Orca ≥ 2.5 can't be checked:** its system presets are binary `.opc` files (ADR-0013), so it installs without the check, with `base_id` from the existing `.info`, else empty. Orca fills an empty one itself on upload. The same goes for a slicer that hasn't started yet.
- **Back up** the desktop user folder to a zip before each batch of writes, and keep the last one (shown on the device page).
- Write the json in the slicer's own style (sorted keys; 4 spaces for Studio, tabs for Orca, CRLF on Windows, and a line end after the last line), so a file's bytes don't change on its first cloud round trip.
- **Conflict copies stay on the hub:** they are for cleaning up there, and in a desktop slicer they would spread through its cloud.
- **The queue is a difference, not a list on disk:** the hub's presets against the sha this device last settled per folder, kind and name, looked at every 30 s. A restart or a sign-in loses nothing, and a preset deleted on the desktop stays away until the hub has a new version of it. *Amended by ADR-0019: it's written back unless the hub acts on that removal (the owner's), and a hub delete removes the desktop's unedited copy.*

**OrcaCloud caveat:** Orca 2.5 uploads disk-written new presets but never disk-written edits. An `update` stays on that PC, and the cloud keeps the old version for PCs without a connector. The connector still writes `update` (the edit lands, and works if Orca fixes this). Orca's log says `uploading` for such an edit, but a delete and a cloud restore brought back the old version. If a `.info` is lost, the next write is a `create`, and the cloud copy replaces it at start, so that edit doesn't land either. The device page warns once per OrcaCloud device. The docs advise one account or cloud sync off on farm PCs.

### Permission
A new on/off permission **`presets.manage`**: delete presets, clean up conflict copies, and set both device switches. On for Admin and Editor, off for Viewer. Seeing and downloading presets needs `projects` read: the people who can see projects can see what slices them. The ADR-0016 catalog gains the row; a data migration sets it on Editor.

### Alerts
Two new event kinds, both needing `presets.manage`:

| Kind | Raised when |
|---|---|
| `preset_conflict` | an upload with a stale base had other content; a conflict copy was made |
| `preset_skipped` | a preset was not stored or written: invalid json, or its `inherits` parent is missing on that device |

They share one migration (the `alerts.kind` CHECK means a table rebuild). "Removed on <device>" is shown on the page, not as an alert.

## Spike results (2026-11-02)
These were found on real installs on Windows 11: Bambu Studio 02.08.02.61 signed in and signed out, and OrcaSlicer 2.5.0-rc signed out and on OrcaCloud. Each test preset was written by hand while the slicer was closed. macOS and Linux paths are covered by CI fixtures made from these files. The two-PC, same-account case moves to Plan 5.1.0 Step 19.

| Rule | Bambu Studio | OrcaSlicer |
|---|---|---|
| Account folder; `default` when signed out; `.info` per preset | confirmed (`<id>` is numeric) | confirmed (`<id>` is a UUID, plus a `sync_state` file; `preset_folder` is empty when signed out) |
| A preset saved in the UI uploads | confirmed, in ~2 s; `setting_id` `PFUS…` | confirmed, in ~16 s; `setting_id` is a UUID |
| New on disk: empty `setting_id` + `create` uploads at start | confirmed | confirmed |
| Changed on disk without touching `.info`: "the older cloud copy wins at login" | **corrected:** the edit stays on that PC, is never uploaded, and the cloud keeps the old version | **corrected:** same |
| Changed on disk with `update` + bumped `updated_time` is uploaded | confirmed (shown by a delete and a cloud restore) | **corrected:** not uploaded (tried twice) |
| `create` under an existing cloud name | not tested | **new:** the cloud copy replaces the local file at start |
| `updated_time` | **new:** set by the server, hours ahead of UTC, and changes on download | **new:** real UTC, our value kept |
| Presets read at startup only | **corrected:** at startup and at sign-in | **corrected:** same |
| A delete on disk comes back from the cloud | confirmed | confirmed |
| A cloud copy is byte-identical (echo by sha) | **corrected:** only if written in Studio's style; the cloud re-serializes (minified json came back pretty) | **corrected:** same, with tabs |
| `"nil"` values are invalid json to reject | **corrected:** valid, they inherit, and Studio uploads them | not tested (same loader) |
| Json that doesn't parse | **new:** Studio silently deletes the `.json` and `.info` | **new:** same |
| `user/default`: `.json` without `.info` loads | confirmed; no `.info` is created, and nothing is offered for upload at sign-in | confirmed |

## Install test results (2026-11-02, Plan 5.1.0 Step 17)
The connector's writes on real installs on Windows 11: Bambu Studio 02.08.02.61 signed in and signed out, OrcaSlicer 2.5.0 on OrcaCloud. One PC; the two-PC, same-account case stays in Step 19.

| Rule | Bambu Studio | OrcaSlicer |
|---|---|---|
| A write waits for the slicer to close | confirmed | confirmed |
| A `create` shows and uploads | confirmed | confirmed; **new:** an empty `base_id` is fine. With an empty cloud list, the file was gone after the first start's sync (seen once) and came back from the cloud at the next start; with a preset already in the cloud it stayed |
| An `update` right after a `create`, with old + 1 | **new:** lost, the cloud's copy wins | not tested |
| The same with the lead | confirmed: uploaded, and it survives the cloud's copy coming back | not needed |
| An `update` is uploaded | confirmed | **confirmed not:** the cloud restored the old version, despite `uploading` in the log |
| `user/default`: `.json` only | confirmed | not tested |
| The cloud's copy drops values equal to the parent's | **new:** seen (`filament_flow_ratio`) | not tested |
| With both switches on, a preset back from the cloud | one more hub version, no conflict, then steady | not tested |
| A hub delete leaves the desktop's file | confirmed | not tested |

## Rejected options
- **A hidden hub root** (`roots.kind = presets`) reusing the hub file sync, as first planned. Roots have no kind today. Every hub root goes to every device and into project indexing, so each `listRoots` caller would need a filter, and a missed one leaks presets into projects. The connector couldn't reuse its root sync either, because preset writes need the `.info` handling and the closed-slicer queue. The parts worth reusing (base version, conflict name, versions pruning) are a few functions.
- **Writing into desktop folders without `.info` handling:** an edit stays on one PC and never reaches the account's other PCs, with no sign of it. On Orca, a wrong `create` is overwritten at the next start.
- **Reading Bambu Cloud's undocumented preset API** (what Printago does): no public contract, it needs the user's cloud token for a second purpose, and OrcaCloud would need its own client. The desktop slicer already does the cloud side. *Reversed by ADR-0019: an optional, read-only row on the Bambu Cloud card.*
- **Propagating deletes to desktops:** the cloud restores them at the next start, so a delete would loop or silently fail. *Reversed by ADR-0019, except for a signed-in Bambu Studio: this spike only removed the file, and an Orca tombstone does delete the cloud copy.*
- **Writing while the slicer runs:** it doesn't read the change until the next start or sign-in, and it may save over it first.
- **Raw-bytes sha for echo suppression:** the clouds re-serialize presets.

## Consequences
- One library feeds the hub slicer, every worker and, per device, the desktop slicers; a preset change marks affected slices outdated.
- Presets are in the database, so backups and restores carry them; the folder on disk is a cache.
- The connector gains a preset folder watcher, a closed-slicer write queue, a `.info` writer and a backup zip, on top of its file sync.
- Bambu Cloud and OrcaCloud users keep their clouds. Farms get a documented tip: one Bambu account, or cloud sync off on farm PCs. OrcaCloud edits from the hub stay per PC until Orca uploads disk edits.
- Out of scope: Printago-style locked presets and `compatible_printers` filtering in the library, editing preset values on the hub, and a downloadable bundle for devices without a connector.

## Sources (checked 2026-11-02)
- Printago docs, [slicer profiles](https://docs.printago.io/docs/printing/slicer-profiles) and [cloud slicer](https://docs.printago.io/docs/printing/cloud-slicer).
- SimplyPrint, [print, machine and filament profiles explained](https://help.simplyprint.io/en/article/print-machine-and-filament-profiles-explained-b9lf0s/).
- BambuStudio [PR #9919](https://github.com/bambulab/BambuStudio/pull/9919): reload user presets from disk (open, not merged); describes `sync_info = create | update` and `base_id`.
- BambuMate [PR #26](https://github.com/MichaelDanCurtis/BambuMate/pull/26): Studio skips a preset with a `setting_id` and an empty `sync_info` as already synced.
