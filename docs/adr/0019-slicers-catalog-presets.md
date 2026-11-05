# ADR-0019: Slicers, catalog and presets

- Status: Accepted (Plan 5.4.0 Step 1, after the spikes). Amends ADR-0017's delete rule and its rejection of reading Bambu's preset API.
- Date: 2026-11-04

## Context
"Add integration" offers Bambu Studio and OrcaSlicer several times (local, server, worker) with no use case. Catalog and system presets have per-type schedules, though they only change when the slicer's files change. User presets take different routes on a single PC, a hub and a connector.

ADR-0017 kept deletes away from desktops, because the cloud restored a removed file at the next start. That spike only tested removing the file. Orca writes `sync_info = delete` tombstones of its own, which raised the question of whether a delete could spread after all.

## Decision

### Three plain things
- **Account** (Bambu Cloud): data that keeps changing, so it keeps its schedules.
- **Slicer** (Bambu Studio, OrcaSlicer): one card, with a list of where it runs. Database rows stay one per install, because `projects`, `project_slice_plates`, `prints` and `import_snapshots` point at them. Cards group by `presetLibrary(adapter)`. The catalog belongs to the library's oldest row with a readable folder.
- **Device** (connector): a machine, a *location* a slicer runs in. It stays in Hub management. Connectors are not integrations: they also do file sync, roots, locks and pairing, and in 6.0.0 they relay LAN printers.

### System catalog
No schedule: what a slicer's files feed runs when the files change. Each type chooses:
- **Manual (default):** when the source changes, nothing is written, not even new rows: an alert leads to a review.
- **Automatic:** the type runs, under its own "what to sync" and "how to sync", with Keep my edits as the default. A first sight of a folder only records it.

The check runs on the scheduler's one-minute tick, because the fingerprint is cheap. The trigger is a fingerprint of `system/`: the sorted `<vendor>=<version>` of each `system/<vendor>.json`. It is 12 small files, read in about 2 ms. File times can't be used: Studio recopied a whole vendor folder with no change of version, which would raise a false alert. Orca ≥ 2.5 has only `.opc` files (ADR-0013): each one's header stamps its vendor and version, which gives the same fingerprint without reading the rest.

A type never imported from that slicer raises nothing: someone who only slices has nothing to review, and a review opened by hand still shows its rows. A user preset's row doesn't count as importing its type's system presets.

### User presets
Three sync types of their own (`userMachineProfiles`, `userPrintProfiles`, `userFilamentProfiles`), writing the same rows as the three profile types. Settings are stored one per integration and type, so a preset's kind can't have two sets of settings otherwise, and each review and count stays apart from the system presets'. Automatic by default.

A single PC looks at the files' times and sizes on the scheduler's tick, which is more reliable than `fs.watch` on NAS and Docker volumes, and reads the presets only when something changed. A hub also checks as soon as a preset is saved.

| Card | Preset changed | New preset |
|---|---|---|
| Automatic + Everything (default) | Updated, keeping your edits | Added |
| Automatic + Only what I already have | Updated, keeping your edits | Alert, waits in the review |
| Manual | Alert, waits in the review | Alert, waits in the review |

On other types a new row outside the scope is left out silently. Here it always asks, so no new preset goes unnoticed. One skipped in the review stays new and counts again at the next change of that kind's files.

These cards decide catalog rows only. Share (device to hub) is all or nothing, because a device has no review, and Install (hub to device) sends every preset whatever the cards say.

A preset brings the brand, material and model it needs, in a run as well as in a review.

### Delete rule
This reverses ADR-0017's "deletes never reach desktops". A preset removed in a slicer is deleted only if nothing uses it, and it is removed from other machines that have preset sync on.

| Desktop slicer | Delete from another machine |
|---|---|
| Signed out (`user/default`), either slicer | **Works:** remove the file; no cloud involved |
| OrcaSlicer, OrcaCloud | **Works:** a tombstone (`.info` with `sync_info = delete`, no `.json`). Orca deletes the cloud copy at its next start |
| Bambu Studio, signed in | **Can't be automatic:** Studio ignores a tombstone. The device shows "delete it in the slicer", as today |

A delete made in Studio's own UI does remove the cloud copy, and a PC of that account holding the file then removes it at its next start. So same-account PCs follow by themselves; only starting the delete from outside needs a person.

- **"In use" is stricter than ADR-0018's delete check.** It also counts what ADR-0018 only clears: a plate's or printer's print profile (`project_slice_plates`, `printers.print_profile_id`), a plate's filament list (JSON), older archived versions with the same `sourcePreset`, and a preset another one `inherits` from.
- **In use = nothing is deleted anywhere.** The hub and other machines keep it, or slicing would fail with `no_preset`. It shows "Removed on WS-3, still used by 2 plates". A daily check deletes it once it is free.
- **A catalog row with your own edits (a typed price) is archived, not deleted,** so the typed value isn't lost.
- **Who can delete: the preset's owner,** the user who first shared it (`slicer_presets.ownerUserId`). The owner is a user, not a device, so their other PCs count and a replaced workstation orphans nothing. A removal on one of the owner's devices spreads the delete. Another user's removal changes nothing on the hub, and **Install** writes the preset back to that device, which reverses ADR-0017's "stays away until the hub has a new version". Only a device with Install on receives a delete. The two switches stay, because farm PCs need install-only.
- **`presets.manage` can always delete from the app,** or a departed user's presets could never be removed. Existing presets start with no owner, because only the last saver's name is stored and old versions get pruned, so only `presets.manage` can delete those.

### Safety, because one delete now reaches every machine
- Over the mass delete limit at once, the delete is held and an alert asks.
- If another device reports the same account folder as the owner's, a removal is held and an alert asks. A cloud delete can remove the file from an owner's PC (results below), and the connector can't tell that from the owner deleting it.
- A slicer sign-in or sign-out moves the watched folder, and that never counts as a delete.
- A desktop file with unsent edits is kept: the edit wins.
- The backup zip runs before writes, and deletes wait for the slicer to close.
- The Presets page gets **Restore**, from the existing tombstone and kept versions.

### The connector can send a slicer's catalog
The manual zip stays as a fallback. A `system` + `user` zip is far below the 100 MB limit (results below).

### User presets from Bambu Cloud
This reverses ADR-0017's rejection of reading that API. One optional **User presets** row on the card, off by default like spools, with the controls the other cloud syncs have: Off, Manual or Auto, frequency (default daily), Sync now, review, log, alerts and editor rights. It uses the three user preset types, with a frequency because a cloud isn't files, and `sourcePreset` stays `bambu-studio:user/<name>`, so a preset from the cloud and from Studio is one catalog row. Read-only: the app never writes to Bambu Cloud.

- **Reading it:** the list answers one request and gives each preset's `update_time`, so a run fetches only the presets whose time changed. That time also moved on a re-upload with no edit, so a fetched preset is compared by its canonical sha (ADR-0017) before it counts as changed. Treat the time as an opaque value to compare, not a date: it reads as real time + 8 h and has no zone.
- **Where a cloud preset goes:** the catalog always. For slicing, a hub's library (so workers and Install devices get it), or a managed slicer's `config/user`. A single PC with desktop Studio writes nothing, because the server never writes to a desktop folder.
- **Cloud delete guards,** on top of the delete rule: only presets this sync has seen before can be deleted, because presets from signed-out folders, zips or Orca never appear in the cloud. Only a complete, valid list counts. Over the mass delete limit, or a change of account, is held with an alert.

**OrcaCloud is on hold** until the Orca team issues a `client_id` (OrcaSlicer#14028). Orca presets keep connector Share and the zip.

### The catalog gap
A shared preset doesn't reach the catalog in three separate cases. Each has an `it.fails` test in `presets.test.ts`, which Plan 5.4.0 Step 5 turns into a normal test:

| Case | Cause |
|---|---|
| A worker-only hub | Workers of either slicer can only `slice`: `capability_unavailable` |
| An Orca hub | Orca's server adapter can only `slice` too, unlike Bambu's: `capability_unavailable` |
| A desktop Orca ≥ 2.5 | With no readable system preset, nothing resolves `filament_type`, and `toProfile` drops the preset without a word. Real presets only hold what differs from the parent, so they rarely carry it. A user machine preset is dropped the same way, because no model is known |

### Everything about a slicer is on its card
Three concepts are kept apart. The **catalog** is database rows (brands, models, profiles, materials) on the Printers and Filament pages. **System presets** ship with the slicer, are read-only, feed the catalog and never sync to desktops. **User presets** are made in a slicer, feed the catalog and sync between machines. Each preset has one of three kinds: filament, process or machine.

"What to import" on a slicer's card uses the same cards as the cloud's, one per type, in three groups: **Catalog** (printer brands, printer models, filament brands, filament materials), **System presets** (machine, print and filament profiles) and **User presets** (their three types, with a count and View for the list, versions, conflicts and Restore). Each card has last sync, Sync now, Review and import, and its settings: when, what to sync, how to sync, alerts and editor rights. "When" is one switch, Automatic when the files change or Manual, in place of a frequency.

**Choose brands** sits above the groups, because a brand fills several cards: it brings the brand with its models and system presets, and sets the Catalog and System presets cards to "Only what I already have". Each list has Select all and shows the brands already in your catalog. A "Runs on" list ends the card. Each connector that reports the slicer is on that list, with Slice here, Share, Install and Read catalog. Share and Install become per slicer on a device, so a device can share one slicer and not another. The Presets button leaves Hub management.

### Unchanged
Bambu Cloud's existing rows and the hub-only library (ADR-0017).

## Spike results (2026-11-04)
Found on real installs on Windows 11: Bambu Studio 02.09.01.70 (profiles 02.09.00.74) and OrcaSlicer 2.5.0-rc, on one PC. Studio's test preset was written to disk as the connector writes one; Orca's were saved in its UI. Each result was read from the folder, Orca's log and, for Bambu, the cloud's list. Each start was repeated, because ADR-0017 once saw a change only at the next start.

**There was no second PC.** It is simulated two ways: a copy of the account folder from before the delete, put back afterwards (a PC still holding the file), and an account folder moved aside (a PC downloading everything). Real two-PC behaviour is still to confirm.

### Deletes
| Test | Bambu Studio | OrcaSlicer |
|---|---|---|
| Tombstone, no `.json` | **ignored:** the file is back at the first start, and the cloud's list still holds it | **works:** "Found orphaned .info file on startup", then "Deleted .info file after cloud confirmation", within a second |
| `.json` kept, `sync_info = delete` | **ignored:** the mark is cleared and the preset stays | not tested |
| Second PC, holding the file, after a cloud delete | **removed** at the first start, not re-uploaded (cloud delete made in the UI) | **removed** at the first start (cloud delete made by a tombstone) |
| Second PC, downloading everything | not tested; the cloud's list no longer holds it | stays gone |
| Signed out: `.json` removed | stays gone | stays gone |

### System folder
| Question | Result |
|---|---|
| Does a start rewrite `system/`? | No: vendor files kept their time through several starts |
| Does `system/` change without a program update? | **Yes, seen once at start:** with `BBL.json`'s `version` lowered, Studio recopied all 2,728 files of `system/BBL` and set the version back, and left other vendors alone |
| Do profiles download on their own? | **Source only, not seen:** `PresetUpdater::sync_config` downloads to `ota/` and `perform_updates` writes to `system/`. `ota/` stayed empty, and the server offered no update for this version |
| Is the profile version the program's? | No: profiles 02.09.00.74, program 02.09.01.70 |

### Zip size against the 100 MB limit
| Folder | Files | Size | Zipped |
|---|---|---|---|
| Bambu `system` | 4,032 | 17.1 MB | 7.3 MB |
| Orca `system` (`.opc`) | 65 | 12.2 MB | 1.2 MB |
| Orca program `resources/profiles` (for comparison) | 1,042 | 48.2 MB | 23.4 MB |
| `user`, either slicer | a few | a few KB | a few KB |

Sizes are computed, per file with deflate plus zip headers, without writing a zip. This account's `user` folders are small, so a large one wasn't measured.

### Bambu's preset API
Read with the app's stored token, `GET` only, with the headers of `cloud.ts`.

`GET /v1/iot-service/api/slicer/setting?version=<profile version>`:
- Top level: `message`, `code`, `error`, `print`, `printer`, `filament`, `settings`.
- A kind with no presets of yours is `null` (`print` and `printer` here). `filament.public` is empty, unlike the community docs' old sample.
- A `private` entry: `setting_id`, `version`, `update_time`, `name`, `nickname`, `base_id`, `filament_vendor`, `filament_id`, `filament_type`, `filament_is_support`, `nozzle_temperature`, `nozzle_hrc`, `inherits`.

`GET /v1/iot-service/api/slicer/setting/<setting_id>`:
- Top level: `message`, `code`, `error`, `public`, `version`, `type`, `name`, `update_time`, `nickname`, `base_id`, `filament_id`, `setting`.
- `setting` holds only what differs from the parent, plus `inherits` and `updated_time`. It has no `name` or `from`: those have to be added before it is stored.

**Only filament entries were seen,** because this account has no print or printer presets. Step 9 has to parse those two kinds without assuming their fields.

**Presets saved by Orca aren't mixed into the list.** Orca 2.5 can hold both logins at once (`cloud_providers = orca;bbl`):

| Orca signed in with | Its preset folder | A preset saved in the UI |
|---|---|---|
| Bambu only | `user/default` | stays local, not in Bambu's list |
| Bambu and OrcaCloud | `user/<OrcaCloud id>` | uploaded to OrcaCloud, not in Bambu's list |

Other Orca versions weren't tested.

### Corrections to ADR-0017
| ADR-0017 | Now |
|---|---|
| `user/default`: no `.info` is created | Orca's UI writes one there too (`sync_info = create`, empty `user_id`). Only a file placed on disk has none. Share ignores `.info` files, so nothing changes |
| Nothing is offered for upload at sign-in | Orca 2.5 offers to copy `user/default` to the account when its OrcaCloud list is empty ("Existing user presets in your default profile"). Declined here, it copied nothing. **Accepting wasn't tested.** It would make presets appear in the account folder, so they arrive as new presets, not as a move |
| A preset saved in the UI uploads in ~16 s (Orca) | It took ~37 s here, on Orca's own cycle. Closing Orca sooner leaves the `.info` at `create`, and it uploads at the next start |
| After a `create` Studio stores + 7 h until its next start | Confirmed: + 7 h, then + 8 h. The cloud's `update_time` reads + 8 h |
| With an empty cloud list, a new Orca preset was gone after the first sync (seen once) | Probably seen again: after the first upload began, Orca reloaded with 0 user presets, and its log then shows a second save of that name. It was present at the next start |

## Rejected options
- **Calling `DELETE /slicer/setting/<id>` ourselves for a signed-in Studio.** It is the one way to automate that row, and a cloud delete does reach the account's other PCs. But the app never writes to Bambu Cloud: it's an undocumented API, and a wrong call deletes a user's real presets from their account. Revisit it only as its own decision, with its own guards.
- **File times as the catalog fingerprint.** A recopy with no new version changes them all.
- **The program version as the catalog fingerprint.** Profiles have their own version.
- **`fs.watch` for a single PC's presets.** Less reliable on NAS and Docker volumes than the scheduler tick.
- **Writing catalog changes automatically by default.** A vendor update could rewrite prices and names no one asked to change. It's opt-in per type, with Keep my edits as the default.
- **A frequency on a slicer's cards.** They read files, so a change in the files is the only time there is anything to do.
- **An import switch per section.** A card in Manual never imported does nothing and its alerts can be unticked, and an "off" that data types otherwise don't have (migration 0064) would stop user presets too.
- **Connectors as integrations.** They do far more than host a slicer.
- **Merging install rows into one.** Projects, plates, prints and snapshots point at them.

## Consequences
- ADR-0017's "deletes never reach desktops" now holds only for a signed-in Studio, where the device tells the user what to do.
- One delete can now reach every machine, which is why the safety rules above come with it.
- The connector gains tombstone writing for Orca account folders and file removal for signed-out folders, each behind the existing closed-slicer queue and backup.
- `integrations.catalogFingerprint` is added, and catalog schedules stop (Step 3): an Auto schedule on a slicer's type becomes Automatic when the files change, and its frequency is ignored.
- Three sync types are added, and each one's last-seen files are kept in `sync_policies.cursor`.
- The app's token is used for a second purpose, reading presets, but only if the user turns the row on.
- `sync_config`'s download path is trusted from source: a real profile download may behave differently, and the alert would be the first sign.

## Risks
- **Ownership can't be enforced on a shared account.** Anyone's delete in Studio's UI removes the cloud copy and reaches that account's PCs. The hold stops the hub and other accounts' machines from following, but the file is already gone from those PCs.
- **A signed-in Studio can't be deleted from outside,** so an owner's delete still needs a person on those PCs.
- **A non-owner can't get rid of a preset** while Install is on: it keeps coming back. Install is all or nothing per slicer.
- **Names are shared per slicer and kind.** Two users with the same name and content have one preset, owned by whoever shared first, whose delete reaches the other's copy.
- **Re-creating a name just deleted in the slicer is untested,** and a non-owner's write-back depends on it (Plan 5.4.0 Step 8).
- **No real second PC:** a real one may differ from a restored folder, for example through its own sync state.
- **Orca's tombstone handling is new** and comes from one rc on Windows. A version that lacks it would bring the file back, the same as Studio.
- **Studio may add tombstone handling or change this,** so this result needs checking on new versions.
- **The API is undocumented:** a changed answer has to fail as `api_changed` (`parse` in `cloud.ts`), never count as an empty list, or the delete guards would be the only protection.
- **Windows only,** like ADR-0017's spikes.

## Sources (checked 2026-11-04)
- OrcaSlicer `main`: `src/libslic3r/Preset.cpp` (`sync_info = "delete"`), `src/slic3r/GUI/GUI_App.cpp` (`scan_orphaned_info_files`, `delete_preset_from_cloud`).
- BambuStudio `master`: `src/slic3r/GUI/GUI_App.cpp` (`need_delete_presets`, `delete_setting`), `src/slic3r/Utils/PresetUpdater.cpp` (`sync_config`, `check_installed_vendor_profiles`, `perform_updates`).
- OpenBambuAPI, [cloud-http.md](https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md): `/slicer/setting`, its quota notes and `DELETE`.
