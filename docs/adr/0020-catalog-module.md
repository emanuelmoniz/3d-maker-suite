# ADR-0020: Catalog module, profiles from files, spools without a profile

- Status: Accepted (2026-11-06, design discussion after Plan 5.4.0 Step 10). Amends ADR-0016's permission catalog, ADR-0017's switches and permission, ADR-0019's "everything about a slicer is on its card", its edit rules and its catalog source, and ADR-0014's fixed operation list. Amended by ADR-0021: the presets and the Preset library move to a Presets module, profiles are presets, Sources becomes a tab of each data type's settings, and the device × slicer table moves to the machine page. Amended by ADR-0022: the catalog source is the hub's slicer, not a pick.
- Date: 2026-11-06

## Context
The catalog and the presets are spread over five places. Brands, models, machine and print profiles sit in Printers → Settings; filament brands, materials and profiles in Filament → Settings; the preset library in Hub management → Slicer presets; what to import on each slicer's card in Integrations; Share and Install on each device page. An admin who sets up a slicer visits all five.

A catalog row can also say something its file doesn't. A typed price or name on a profile is never seen by the slicer, so the row and the real preset drift apart. Keep my edits, the import snapshots of profiles and "a row with your edits is archived, not deleted" (ADR-0019) exist only to manage that drift.

A spool must point at a filament profile (`spools.profileId`, not null). A profile is a slicer setting, a spool is a roll on a shelf. The same roll can be sliced with different presets in two projects, and the plate already keeps both apart: `project_slice_plates.filaments` (a preset per slot) next to `spools` (a spool per slot). Today saving a plate overwrites a slot's preset with its spool's profile. Without a slicer, people still have to make a "profile" by hand to add a spool. Spoolman has no slicer presets at all: its filament is the product (vendor, material, name, colour, density, price).

Requirements from the discussion:
- One place to view and manage the catalog and the presets.
- The app is usable with no integration at all.
- Profiles exist only as slicer files, because only a slicer can use them; the slicer is their only editor.
- Every field of a profile's file can be viewed.

## Decision

### One module: Catalog
A **Catalog** module (`/catalog`) holds the data and where it comes from. It is the first item of the sidebar's bottom block, which reads **Catalog, Integrations, Hub management, Import | Export, Logs, Settings**, then the account. Each shows as today: Catalog with `catalog` read, Hub management with the hub on, Logs with logging on. Slicer presets leaves the block. The mobile More sheet uses the same order.

| Tab | Holds |
|---|---|
| Printers | Printer brands, printer models, machine profiles, print profiles |
| Filament | Filament brands, filament materials, filament profiles |
| Presets | Hub on: the preset library (ADR-0017): versions, owners, conflicts, held deletes, Restore |
| Sources | Per slicer library: its routes, catalog source, Choose brands and the import cards. Hub on: the device × slicer table |

The other places keep what isn't catalog data:

| Place | Keeps |
|---|---|
| Integrations | Connections: Bambu Cloud sign-in, slicer installs (this computer, this server, a workstation), paths, managed slicer updates, Slice here, the run log, the non-catalog types (Bambu Cloud's printers, prints, spools), and one summary line per card linking to Catalog |
| Hub management | Machines: pairing, sync mode, roots, updates. The device page shows a read-only presets line per slicer with a link to Sources |
| Printers → Settings | Default printer and printer states |
| Filament → Settings | Gone: it held only catalog tables. `/filament/settings` redirects to Catalog → Filament |

API paths don't move (`/api/brands`, `/api/filament/profiles`, `/api/presets`…). Old pages redirect: `/printers/settings#<table>`, `/filament/settings`, `/hub/presets`.

*Amended by ADR-0021: Catalog keeps Printers (brands, models) and Filament (brands, materials). Machine, print and filament profiles become Printer, Process and Filament presets in a **Presets** module (`/presets`), whose settings add a **Library** tab for the preset library. The Sources tab becomes a Sources tab on each module's settings (Catalog settings, Presets settings). Send presets and Install become Presets Share and Receive on the machine page, where the `machine.*` switches (ADR-0016) let a machine's own user set them; the device × slicer table goes, which reverses "Per-device switches on the device page" below. The sidebar's bottom block reads Hub management, Integrations, Catalog, Presets, Import | Export, Logs, Settings.*

### Two kinds of catalog data
| Type | By hand | From files | A row from files |
|---|---|---|---|
| Printer brands, printer models, filament brands, filament materials | yes | yes | Name locked: it is how the next import finds the row. Other fields (logo, URL, power, image, density, default price) stay editable. A file only fills empty fields, never overwrites one |
| Machine, print and filament profiles | no | only | Read-only. Archive hides it from the pickers. It changes when its file changes |

- A row made by hand whose name later comes in a file is linked to it: it keeps your values and shows its source from then on.
- Each row shows its source: **By hand**, **\<Slicer\> (system)**, **\<Slicer\> (user)**, **Bambu Cloud**. Profiles read it from `sourcePreset`; the four catalog types from their `import_snapshots`, so no column is added.
- **"How to sync" goes for slicer types.** Profiles follow their file and the four catalog types only fill empty fields, so Overwrite, Keep my edits and Let me review stay only on Bambu Cloud's printers and spools. When, what to sync (scope), Choose brands, the gone review and "in use" stay.
- **Removed with it:** the forms that make or edit a profile, the quick-add profile modals, the `edited` flag of a gone row (`import/gone.ts`) and ADR-0019's "a row with your edits is archived, not deleted". The gone review only covers profiles, and a read-only profile can't have edits.
- **Kept, because they do other jobs:** the `import_snapshots` join in the gone check (which slicer brought the row), snapshots for Bambu Cloud's merges, archiving the older version of a preset that prints still point at, and Archive by hand.

### A profile's file, every setting
A profile's page shows what the app uses (name, model, nozzle, material, temperatures, source) and **All settings**: every key and value of the file with its parents filled in (`systemPresets().flatten`, as slicing already does), each marked with where it comes from (this preset or a parent), searchable, and a JSON download.

Nothing is stored for this; the file is read when the page opens:

| Install | Read from |
|---|---|
| Single PC | The slicer's folder |
| Hub with a server slicer | Its `config/system` and the preset library |
| Hub fed by a workstation | The `system/` the catalog source sent, kept on the hub, and the library |
| Bambu Cloud user preset | The cloud preset (differences only) with its parent from the above |

A source that can't be read says so, and the rest of the page still shows. A file that changed while its row waits for review shows a banner that leads to the review.

### Spools describe the filament
`spools.profileId` goes. A spool has:

| Field | |
|---|---|
| `brandId` | Filament brand, optional (unknown or generic) |
| `materialId` | Filament material, required |
| `name` | Free text, optional: "PLA Basic", "PLA Matte" |
| `colorHex`, `colorName` | Two fields, as today |
| Price paid, weights, dates, status, location… | As today |

- **Price per kg:** the spool's price paid, else the default price of its material (a new optional `filament_materials.pricePerKg`), else unpriced. The quote calculator's material prices become the average spool price per kg per material, else the material's default.
- Bambu Cloud fills brand, material, name (`filamentName`), colour and colour name on the spool. "Cloud" filament profiles (`filament_profiles.origin`, `integrationId`, `externalId`) go.
- A print's filament usage loses `profileId`. Its material and price come from its spool, else from its own `material`.
- Stats group the filament breakdown by spool brand, material, name and colour, and filter by material through the spool.
- The spreadsheet import: spools drop the profile column and gain name; a print's filament column names a material.

### A plate slot: spool and preset
Each slot has a **preset**, always set, and a **spool**, optional.
- **Preset:** "From the file" by default, named by the 3MF (`filament_settings_id`, with its `filament_type`), stored as `null` as today. The 3MF holds the slot's full settings, so the slicer can always use it. The picker lists the plate's slicer's filament profiles that fit the plate's printer.
- **The spool's preset is looked up** among those: brand + material + name, then brand + material, then Generic of that material. On each level the user's own presets come first. Several on one level: they head the picker, and nothing is guessed.
- **Picking a spool never changes the preset on its own:**

| Current preset | Result |
|---|---|
| Already on the spool's best level (its name, else its brand and material) | Nothing |
| Same material, a better match exists (the spool's name over another of its brand, or its brand) | A quiet suggestion: Use / Keep |
| Same material, no brand match | Nothing |
| Other material | A warning with the best match: Use / Keep |
| Other material, no preset of that material | A warning; slicing isn't blocked |

- A later spool change leaves the preset alone. A preset changed by hand to another material than the spool's shows the same warning.
- **Keep is stored** with the plate (`project_slice_plates.kept`, the spool kept per slot): that spool's suggestion or warning stays hidden until the spool or the preset changes. A "From the file" preset that isn't in the catalog gets no suggestion: it may be a tuned one.
- Amended 2026-11-06 (Step 13): a preset of the spool's brand but another name ("PLA Pure" for a "PLA Matte" spool) gets a suggestion when the spool's name has a preset; first written as "already a brand + material match: nothing".
- **Price per slot:** the spool's, else its material's default; no spool: the default of the slot preset's material (the 3MF's `filament_type` for "From the file").
- Only a changed preset marks a slice outdated, not a changed spool.

Material alone decides "compatible": it sets the temperatures and the plastic. Brand and name are tuning, and asking on them would ask about almost every spool. The preset is never switched for you, because the file's preset may be a tuned one saved with the project on purpose; that overwrite is today's bug in the other direction. A wrong material barely changes grams, and these slices are estimates, so a warning is enough.

### Sources
- **Import cards** of every catalog and user preset type, from slicers and from Bambu Cloud, move to Sources, grouped per slicer library (`presetLibrary(adapter)`). They are the same `sync_policies` rows, so `editorSync`, `editorReview`, alerts and the scheduler don't change. A library lists every route into it (`preset_routes`, Plan 5.4.0 Step 9): local folder, server slicer, zip, Bambu Cloud, devices.
- **Device × slicer table** (hub on). One row per device and slicer it reports (`devices.slicers`), with **Send presets** (ADR-0017's Share) and **Install**, and their state (last sent, queue, last backup, held deletes). A slicer the device no longer reports keeps its row, greyed out, with its values. A new device starts with both off. This is the only place they are edited.
- **One catalog source per library** for its system presets: a server folder, a managed slicer or a device. Default: the library's oldest install row with a readable folder; on a worker-only hub, the first device that reports the slicer. The source device's connector checks the fingerprint (ADR-0019) on its tick and sends `system/` only when it changed and only while it is the source. The hub keeps that copy for the catalog, for resolving user presets' parents and for All settings. Picking a source turns on the library's Catalog and System presets cards.
- User presets come from many devices and merge (owners, conflicts, routes). System catalogs must come from one place: two devices with profiles 02.09 and 02.08 would flip the fingerprint on every report and raise a change alert each time.
- The manual zip moves to Sources: "No connector? Upload a zip".

### Permission
A module permission **`catalog`** (none · read · write · manage) replaces `presets.manage`:

| Level | Gives | Today |
|---|---|---|
| read | Every tab, All settings | `printers` / `filament` read; presets: `projects` read |
| write | Delete presets, clean up conflict copies, held deletes, Restore, Send presets and Install | `presets.manage` |
| manage | Add, edit, archive and delete catalog rows, quick-add brands, models and materials in the forms, Sources settings, catalog source | `printers` manage, `filament` manage, and `integrations.manage` for those cards |

- The picker reads (`GET` brands, models, profiles, materials) stay open to `printers` read or `filament` read, so the printer, spool and print forms work without `catalog`. Presets stay readable with `projects` read (ADR-0017).
- Sync now and Review keep `integrations.sync` / `.review` with their policy flags.
- `preset_conflict`, `preset_skipped` and `preset_held` need `catalog` write.
- Migration: **read** if `printers` and `filament` are both at least read; **write** if `presets.manage` is on; **manage** if `printers` and `filament` are both manage. Admin gets manage, Editor write, Viewer read: today's rights. Two custom role cases change and are listed in the CHANGELOG: one of the two modules at manage drops to write or read for catalog edits, and both at manage with `presets.manage` off gain preset housekeeping.
- Editors still can't add a brand or material from the spool form, as today.

### Migration of data
- Spools take `brandId`, `materialId` and `name` from their profile (the name loses a leading brand name: "Bambu PLA Basic" from Bambu Lab becomes "PLA Basic").
- A spool with no price paid, a known initial weight and a priced profile gets `pricePaid = price per kg × initial grams / 1000`, so its costs stay the same. Prints keep their stored `costSnapshot`.
- A material's default price is the average of its profiles' typed prices.
- Profiles made by hand and cloud profiles are archived and labelled "By hand (older)"; Delete is offered once nothing uses them. A plate that pointed at one slices "From the file", which it already did: a hand-made profile never sliced.
- Profiles lose `pricePerKg` and the cloud columns. `spools` is rebuilt (SQLite can't drop a foreign key column in place). Back up first, as every schema step.

### Unchanged
The preset library and its sync between machines (ADR-0017, ADR-0019 deletes, owners, holds), the gone review and "in use" for profiles, Manual and Automatic, Choose brands, slicing with presets, and Bambu Cloud's printers, prints and spools.

## Rejected options
- **Editable profiles.** The slicer never sees an edit made here, so the row and the file drift apart, and that drift is what Keep my edits and archive-on-edit only managed.
- **Profiles made by hand.** No slicer can use one: slicing already falls back to the 3MF's own settings for them.
- **A filament product table** (Spoolman's Filament) between brand and spool. Spool fields cover it without a table; a later SpoolmanDB import is the reason to add one.
- **A spool keeping a preferred preset.** The preset is a choice per plate; the lookup by brand, material and name finds it.
- **Switching a slot's preset automatically when a better one exists.** It overwrites a deliberate choice.
- **Blocking a slice on a material mismatch.** The slices are estimates; it would leave people stuck when the catalog has no preset for that material.
- **One "Send to hub" switch for presets and the system catalog.** Several senders of one library's system presets flip its fingerprint.
- **Per-device switches on the device page or the slicer card.** The device page needs `hub.manage`, which is why 5.1.0 Step 17 needed a way around it; neither shows who sends or receives a slicer across devices.
- **Keeping the import cards in Integrations.** What comes into the catalog would stay on another page than the catalog.
- **Storing a copy of each profile's file for All settings.** It could be stale; the source is read instead.
- **Moving API paths.** Only pages and rights move.

## Consequences
- Five places become one module; Integrations and Hub management get smaller.
- Users can run the app with no integration: printers, spools, prints, costs, quotes, maintenance and projects work on catalog rows made by hand. Profiles appear when a slicer is connected, the only time they are used.
- Less code: profile forms, quick-add profile modals, "How to sync" for slicer types, profile edit detection, archive-on-edit and cloud filament profiles go.
- The spools API changes: `profileId` goes, `brandId`, `materialId` and `name` come. It stays a minor release with a migration; the CHANGELOG says so.
- 6.0.0 Step 12 (Spoolman two-way) writes back to a Spoolman filament found or created by brand, name, material and colour. Printer slots (6.0.0 Step 5) match spools by their own material and colour.
- ADR-0014's fixed operation list gains "send the slicer's `system/` folder".

## Risks
- **Stats can shift for filament with no spool.** Today it is priced with its profile's price; after, with its material's default.
- **The lookup depends on names.** A spool's brand and name have to resemble the preset's `filament_vendor` and name; a miss falls back to Generic, then a warning.
- **The source must be readable for All settings.** A device catalog source that never sent, or a moved folder, shows only the row.
- **Migrated names may need tidying:** a profile name that doesn't start with its brand name is copied whole.
- **One more table rebuild** (`spools`), with its foreign keys from usages and taggings.

## Sources (checked 2026-11-05)
- Printago, [slicer profiles](https://docs.printago.io/docs/printing/slicer-profiles): one profile library, Source column, In use and Unused filters, own and inherited values.
- 3DPrinterOS, [slicing profiles for organizations](https://3dprinteros.helpdocs.io/3dpos-organizations/slicing-profiles-management-for-organization): admins manage profiles in one place and can hide them from slicers.
- SimplyPrint, [shared organization profiles](https://help.simplyprint.io/en/article/shared-organization-profiles-in-the-cloud-slicer-1301o2a/) and [material profiles](https://help.simplyprint.io/en/article/material-profiles-what-they-are-and-what-they-are-not-1nxzf8v/): a material in the inventory is not a slicer setting.
- [Spoolman](https://github.com/donkie/Spoolman) and [SpoolmanDB](https://github.com/donkie/SpoolmanDB): vendor → filament product → spool, no slicer presets.
