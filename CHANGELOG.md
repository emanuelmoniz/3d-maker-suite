# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

Migration 0123 drops the check-out locks and their settings.

### Added
- **Last saved by `<user>` on `<device>`, `<time ago>`** on each project file, information only: on a hub root the last save that reached the hub (a device's sync or a browser upload), on a device root the device's user and the device as its last scan saw ([docs/hub.md](docs/hub.md#no-locks-conflicts-and-last-saved-by))
- **Uploads with a conflict check:** while the hub is on, replacing a file checks it didn't change since the page listed it. If it did, the upload is kept as `<name> (conflict <user> <date>).<ext>` and the Sync conflict alert is raised. With **Keep earlier versions of files** on, a browser upload now keeps the replaced file as a version too ([docs/projects.md](docs/projects.md#uploading-files))
- **Upload into a device folder** (upload, drop, upload into a folder, replace) while the device is online: its connector writes the file, with the same check. Versions of those uploads are kept on the device, in the connector's data folder, and listed on the project page ([docs/hub.md](docs/hub.md#uploading-into-a-device-folder)). Each device folder is sent once again after the update, so its files gain their hashes

### Removed
- **Check-out locks** (Hub management → Settings), with Done editing, force-unlock and "Being edited by". Two devices saving the same file still never overwrite each other: the later save becomes a conflict copy. Upgrading clears every lock, and files read-only on a device only because of a lock turn writable at its next sync. Read picks and download-only files stay read-only

## [5.6.0-alpha.1] - 2026-11-13

Pre-release, first of 5.6.0. Lists everything since 5.5.0. No migration: the new settings are preferences.

### Added
- **Busy spinner** on actions that can take over a second (Sync now, check for updates, slicer install and remove, backup, export, import apply, empty trash, restarts). It appears after about 1 s, so fast actions don't flicker, and screen readers get the busy state
- **Tags setting** (Settings → General): hides tags install-wide and restores them when turned back on; nothing is deleted ([docs/configuration.md](docs/configuration.md#in-app-settings)). Projects can now get tags from their form
- **User accounts switch** (Settings → General): off works like the no-users mode, for a single user. Users, roles and sessions are kept; turning it back on signs everyone in again. The hub needs accounts, so each switch blocks the other ([docs/users.md](docs/users.md))
- **Users | Roles page** in the menu, with Users and Roles tabs, in place of those two Settings sections. Old links redirect
- The logo and icons: the app icon in the favicon, sidebar, sign-in pages and connector page, the installers (Windows, macOS, Linux) and the README header
- Printer and project names on Stats link to their page

### Changed
- Restart and update show a full-screen overlay that blocks the page until the server is back, in place of the banner
- Catalog import and export are on **Import | Export**; the brands type is labelled Printer brands
- The Stats printer and outcome tables are stacked; the trash icon is red everywhere

### Fixed
- After a restart, the page reloaded as soon as anything answered, which could be the old process still closing. It now waits for the new one

## [5.5.0] - 2026-11-12

Stable release of 5.5.0. Lists what changed since 5.5.0-alpha.4; the earlier pre-releases' entries above cover the rest. Back up before updating. Migrations 0119 to 0121 (alpha.3) and 0112 to 0118 (alpha.2) apply as described there. No new migration.

### Changed
- The server's Fastify is 5.12.5 or newer, and its request logging uses `LogController`, which removes a deprecation warning in tests and CI. No change for users

### Tested
- Automatic: unit and integration tests (1228), Playwright e2e (221), lint, the translation check and the version check pass. No new feature since alpha.4, so the pages and screenshots are as in alpha.4

## [5.5.0-alpha.4] - 2026-11-12

Pre-release, fourth of 5.5.0. Lists everything since 5.5.0-alpha.3. No migration.

### Added
- **Unlink folders** on the selection bar of **Projects settings → Change project folder…**: the selected projects' folders are unlinked and kept as they are, and the ones that couldn't be unlinked stay selected, with the reason ([docs/projects.md](docs/projects.md#moving-projects-to-another-project-folder))
- The machine page's Projects section has **Sync sources configurations**, which opens Projects settings → Sources

### Changed
- On the machine page, **Actions** (Restart, Stop, Revoke) is at the top
- **Receive from server** shows its sync state next to the picks count, now worded *Up to date · N files*; **Share to server** shows *Up to date* next to its folder count while the machine is online. The line about where these are set is gone

### Fixed
- Unlinking a project whose folder is missing, with Keep, now just forgets the folder instead of keeping a dead link to it

### Tested
- Automatic: unit and integration tests (1228), Playwright e2e (221), lint, the translation check and the version check pass. The e2e covers Unlink folders: the project leaves the table and its files stay on disk.
- Not tested by hand: the machine page and Unlink folders on the real VPS.

## [5.5.0-alpha.3] - 2026-11-12

Pre-release, third of 5.5.0. Lists everything since 5.5.0-alpha.2. Back up before updating. Migration 0119 adds the machines' shared folders, 0120 replaces each machine's sync mode and selected projects with picks, and 0121 gives a pick a level for the machine's user.

### Added
- **Shared folders on the hub**: a machine's shared folders are set on **Projects settings → Sources → Share to server**, one card per machine, one line per folder (switch to pause it, ⋯ Remove, the project folders inside) and **Add folder**, which browses the machine's whole disk. The connector keeps the list once, then the hub's list wins ([docs/hub.md](docs/hub.md))
- **Picks**: a machine receives only its picks, each a project folder or a folder inside one, at **Read** or **Edit**, with a switch to pause it. They are set on **Projects settings → Sources → Receive from server**; **Open on a machine** adds a pick for the project. Read syncs the files read-only on the machine, and the user's own rights still cap every pick ([docs/hub.md](docs/hub.md))
- **Project folder page**: a folder's own page to add and edit it, with the source, the layout in plain words, the files levels, auto slice and who can edit, and an example tree that shows what is found

### Changed
- **Projects settings lists the project folders in a table** with the folder name, the machine, the project count and Remove, which now asks first
- "Root" is now **project folder**, and a project's own path is its **subfolder**
- **New machines receive** replaces the default sync mode: every hub project folder, or nothing until you pick. The machine's sync mode select and its selected projects are gone; an existing `all` machine gets a pick per hub project folder, and `selected` one pick per selected project
- A new project folder on a machine must be inside one of its active shared folders

### Fixed
- The folder column shows the base name on Windows paths

### Tested
- Automatic: unit and integration tests (1227), Playwright e2e (221), lint, the translation check and the version check pass. Migrations 0119 to 0121 apply to a copy of a real alpha.2 database with no row lost (139 projects, 617 prints, 36 spools; foreign keys clean). The server's tests cover picks at Read and Edit, a user who can't see a project, a subfolder pick, a paused pick and folder, and the connector's tests its entry page for a paired, an unpaired and an unreachable hub.
- Not tested by hand: the real VPS with two workstations (sharing a folder from one and adding it as a project folder, picking `root1` and `root2/project2` for the other with a user at Read and one at Edit); the connector's real icon or launcher on a paired and an unpaired machine, and with the hub stopped; upgrading a copy that has machines in `all` mode with real data (the copy had one machine in `selected` mode and no selected projects, so it got no picks; `all` is covered by the migration's own test).

## [5.5.0-alpha.2] - 2026-11-12

Pre-release, second of 5.5.0. Lists everything since 5.5.0-alpha.1. Back up before updating. Migrations 0112 to 0118 add the Receive and Share projects switches, the machine's Use as slicer and catalog switches and the hub's slicer per slicer type, make a slicer's catalog and system preset lines Automatic, merge `presets` into the `catalog` permission (everyone keeps the higher of the two), and add the server's catalog and preset receive columns.

### Added
- **One hub's slicer per slicer type**: **Server's slicer** on a slicer's card lists this server's installs and every machine's install; pick one with **Make it the hub's slicer** (another version asks first) or move it with **Change slicer machine**. A machine as the hub's slicer slices without a zip, and its jobs wait while it is offline ([docs/hub.md](docs/hub.md#catalog-source))
- **Machine page on the hub** with `machine.*` switches; the connector opens it, and its own local page is slim: the machine, user and hub, sync folder, held deletes, Restart, Stop and Unpair
- **Sources tab holds every source's and receiver's lines**: source cards start closed and remember the ones you open; **Share to server** and **Receive from server** for the server's slicer, and Receive lines say only their state, with details in their ⋯
- **Receive and Share projects** switches per machine
- **This server receives the hub's catalog and user presets**, and a machine receives System and User presets, each alone or both

### Changed
- **One Catalog module**: `presets` merged into `catalog` (rights, tabs, pages). A preset's page lives under /catalog; the Printers and Filament tabs hold the preset tables
- A slicer's catalog and system presets follow its files on their own (Automatic); a slicer update imports without a click
- A slicer install's **Enabled** only decides whether it can be the hub's slicer; installs show no status line; the slicer machine is changed from a dialog
- Alerts have a short title, with the rest inside the alert
- Integrations: one link style, Sources buttons, a devices table; no Allow or slicer switches on the cards

### Fixed
- The hub's slicer receives user presets too; Share to the hub lists one table per machine slicer and shares only the hub's slicer
- A zip's presets go by their kind
- Every Sources table lines up its columns
- The server's installed slicer is named "This server"

### Tested
- Automatic: unit and integration tests (1217), Playwright e2e (218), lint and the translation check pass, and migrations 0112 to 0118 apply to a copy of an existing database without losing rows.
- Not tested by hand: upgrading a real 5.4.0 database with data; the two-machine scenarios (Use as slicer, changing the hub's slicer, an offline machine, preset Receive and Share, Restart and Stop from the hub, a user with one machine switch); the catalog update after upgrading; Sources cards remembering which are open; two Bambu Cloud accounts with their own photo and Sources.

## [5.5.0-alpha.1] - 2026-11-11

Pre-release, first of 5.5.0. Lists everything since 5.4.0. Back up before updating. Migration 0110 renames the profile tables to presets and 0111 adds the `presets` permission, copying each role's and user's `catalog` level.

### Added
- **Presets module**: Printer, Process and Filament tabs, with its own settings (General, Sources, Library) and a `presets` permission (none, read, write, manage) that takes the preset rights from `catalog` ([docs/users.md](docs/users.md))
- **General and Sources tabs** on the settings of printers, prints, filament and presets. A Sources tab lists the accounts that allow the type, one line each with its switch, **Edit** and a **⋯** menu (Sync now, Review and import, sync log) ([docs/bambu-cloud.md](docs/bambu-cloud.md))
- **Account cards**: each Bambu Cloud account shows its photo, name, email and region, and has an **Allow** switch per type (printers, prints, spools, user presets) linking to that type's Sources tab. The photo is fetched and cached by the server ([docs/bambu-cloud.md](docs/bambu-cloud.md))

### Changed
- **Profiles are now presets**, as the slicers call them, in the UI, API and code. Old API paths, import types and page addresses still work and redirect. The hub library is the **Preset library** ([docs/import.md](docs/import.md))
- Sync settings left the Integrations cards for the Sources tabs; the "Sync from..." buttons on the Printers, Prints and Filament pages are gone. Editors with a sync or review task reach the Sources tab from the module's gear ([docs/users.md](docs/users.md))

### Fixed
- **Bambu Cloud sign-in and sync work again**: Bambu's Cloudflare protection started refusing the app's requests ("The vendor's servers blocked the request"). The app no longer sends the slicer identity headers that triggered it
- **Bambu Cloud two-step verification**: the authenticator code is sent to Bambu's API instead of its website, which now refuses the app
- A denied settings page no longer hangs the browser
- The Tabs bar no longer shows a vertical scrollbar

## [5.4.0] - 2026-11-08

Lists everything since 5.3.0. Back up before updating. Migrations 0103 to 0109 convert roles and overrides to the `catalog` permission, rebuild spools so they no longer point at a profile (filament profiles lose their price), archive hand-made filament profiles, add the printer's and the plate's machine profile, carry each device's two preset switches over to every slicer it reports, and add the preset owner and hold columns, `goneInUse` on sync policies, the `preset_routes` table and `catalogFingerprint` on integrations.

### Added
- **One Catalog module**: profiles come only from files; import and export live in Catalog, and a profile's page shows **All settings**. A **Presets** tab lists the hub's user presets, and a profile imported from one links to its entry and back ([docs/import.md](docs/import.md))
- **Machine profile per printer and per plate**: a printer keeps its machine profile and a preset keeps its default and compatible printers. A plate's setup reads top to bottom like the slicer (slicer, printer, machine profile, print profile, filaments); any pick, a nozzle swap included, slices with that system machine preset. **Defaults for all plates** apply a setup to every picked plate at once ([docs/slicing.md](docs/slicing.md))
- **A slot's spool and preset are separate picks**. The preset defaults to "As saved in the file" and lists the slicer's presets, with the spool's matching presets first. A spool on a slot gives a quiet **Use / Keep** suggestion when its brand has a preset of the same material; slicing is never blocked ([docs/slicing.md](docs/slicing.md))
- **Add a slicer by where it runs**: on this computer, downloaded to this server, or on a connected workstation. Integrations shows one card per slicer with a row per location
- **Catalog → Sources**: one section per slicer with its catalog source, every route into the library and the zip upload. With the hub on a device, a table with **Send presets** and **Install** per device and slicer ([docs/hub.md](docs/hub.md#slicer-presets))
- **A source device sends its slicer's system presets to the hub**, so a worker-only hub needs no hand-made zip ([docs/hub.md](docs/hub.md#catalog-source))
- **Bambu Cloud user presets**: optional **User presets** cards on the Bambu Cloud card (machine, print and filament), read-only. One preset has one owner whichever way it arrives ([docs/bambu-cloud.md](docs/bambu-cloud.md))
- **A preset removed in a slicer asks before its row goes**: a **Sync needs review** alert lists it under **Gone from the slicer**, with **Delete** when nothing uses it, or says what still uses it. Deletes reach other machines; a mass delete, or one on a shared account, is held for a person on the Presets page, which also has Restore ([docs/import.md](docs/import.md#from-an-integration), [docs/hub.md](docs/hub.md#deleting))
- **Spool name and material default price**: a spool has its own brand (optional), material (required) and name, and each material has a default price per kg. A spool's preset suggestion also works for a preset named after the spool ("Bambu PLA Pure" for a "PLA Matte" spool) ([docs/import.md](docs/import.md))
- **Bambu Studio and OrcaSlicer catalogs**: one Catalog row on a slicer's card with **Choose brands**, which imports only the brands you pick. OrcaSlicer's system presets are read from its `.opc` files, so Orca gets brands, models and profiles like Bambu Studio ([docs/import.md](docs/import.md#from-an-integration))
- **Presets reach the catalog on their own**: a preset you save in a slicer, or on a hub, is in the catalog within a minute, keeping the values you typed. Slicer cards run when the slicer's files change, Automatic or Manual
- **Brand and Slicer columns** in the catalog tables on the Printers and Filament pages, with filters

### Changed
- **`catalog` permission**: a module with none, read, write and manage levels replaces `presets.manage`. Built-in roles keep today's rights; a custom role and a user's overrides convert to the closest level ([docs/users.md](docs/users.md))
- Choose brands needs catalog manage as well as integrations manage, and the zip upload moved to Sources
- **Spools describe the filament, not a profile**: the spools API no longer takes `profileId`; it takes `brandId`, `materialId` and `name`. Migration 0104 fills each spool from its old profile
- **Costs and stats price a spool** by its price paid, else its material's default. Filament with no spool is priced by the material it reports. A quote's material prices are your spools' average, else the material default
- **Filament profiles have no price** and lose their unused cloud columns; Bambu Cloud fills a spool's fields and no longer needs a matching profile
- **Picking a spool on a plate no longer overwrites the slot's preset**, and a kept suggestion stays hidden until the spool or the preset changes
- A device is a catalog source only on a hub with no slicer of its own; adding a slicer on this computer warns when a device is the source. A source device's copy goes once the source moves away; a zip's copy stays

### Fixed
- An edit made in Bambu Studio no longer leaves a "(conflict bambu-cloud …)" copy when the account's copy only words the same settings differently

### Not tested on real hardware
- Two PCs on different accounts and on one account (owner and other-user deletes, the held delete), a synced preset reaching a worker and an Install device, switching the catalog source between two devices, and a plate on a second printer. They are covered by automated tests only.

## [5.4.0-alpha.4] - 2026-11-08

Pre-release. Test on a copy of your data first; back up before updating. Lists everything since 5.4.0-alpha.3. Migrations 0106 to 0109 archive hand-made filament profiles, add the printer's and the plate's machine profile, and carry each device's two preset switches over to every slicer it reports.

### Added
- **One Catalog module**: profiles come only from files; import and export live in Catalog, and a profile's page shows **All settings**. A **Presets** tab lists the hub's user presets, and a profile imported from one links to its entry and back ([docs/import.md](docs/import.md))
- **Machine profile per printer and per plate**: a printer keeps its machine profile and a preset keeps its default and compatible printers. A plate's setup reads top to bottom like the slicer (slicer, printer, machine profile, print profile, filaments); any pick, a nozzle swap included, slices with that system machine preset. The print profile defaults to the printer's, else the machine profile's. **Defaults for all plates** apply a setup to every picked plate at once ([docs/slicing.md](docs/slicing.md))
- **Add a slicer by where it runs**: on this computer, downloaded to this server, or on a connected workstation. Integrations shows one card per slicer with a row per location
- **Catalog → Sources**: one section per slicer with its catalog source, every route into the library, the zip upload, and with the hub on a device table with **Send presets** and **Install** per device and slicer ([docs/hub.md](docs/hub.md#slicer-presets))
- **A source device sends its slicer's system presets to the hub**, so a worker-only hub needs no hand-made zip. The connector uploads only when the slicer's fingerprint differs from the hub's copy, which raises the catalog change alert. A second device gets `not_source`, and an older connector answers `device_outdated` ([docs/hub.md](docs/hub.md#catalog-source))

### Changed
- Choose brands needs catalog manage as well as integrations manage, and the zip upload moved to Sources
- A device is a catalog source only on a hub with no slicer of its own; adding a slicer on this computer warns when a device is the source
- A source device's copy goes once the source moves away; a zip's copy stays

### Not tested on real hardware
- Two PCs on different accounts and on one account (owner and other-user deletes, the held delete), a synced preset reaching a worker and an Install device, switching the catalog source between two devices, and a plate on a second printer (only one printer in the test data). They are covered by automated tests only.

## [5.4.0-alpha.3] - 2026-11-06

Pre-release. Test on a copy of your data first; back up before updating. Lists everything since 5.4.0-alpha.2. Migrations 0103 to 0105 convert roles and overrides to the `catalog` permission, rebuild spools so they no longer point at a profile (filament profiles lose their price), and add the plate's kept-preset column.

### Added
- **`catalog` permission**: a module with none, read, write and manage levels replaces `presets.manage`. Catalog writes need catalog manage, the pickers still read with printers or filament read, presets read with projects or catalog read and change with catalog write, and catalog import cards need catalog manage. Built-in roles keep today's rights; a custom role and a user's overrides convert to the closest level ([docs/users.md](docs/users.md))
- **A slot's spool and preset are separate picks** on a project plate. The preset defaults to "As saved in the file" and lists the slicer's presets, with the spool's matching presets first. A spool on a slot gives a quiet **Use / Keep** suggestion when its brand has a preset of the same material, and a warning with the best match when the materials differ. Slicing is never blocked ([docs/slicing.md](docs/slicing.md))
- **A preset named after the spool gets a suggestion**: a "Bambu PLA Pure" preset suggests itself for a "PLA Matte" spool of the same brand and material. Nothing shows when the preset is already the spool's best match
- **Spool name and material default price**: a spool has its own brand (optional), material (required) and name, and each material has a default price per kg. The spool import has a name column; a print's filament column names a material ([docs/import.md](docs/import.md))

### Changed
- **Spools describe the filament, not a profile**: the spools API no longer takes `profileId`; it takes `brandId`, `materialId` and `name`. Migration 0104 fills each spool from its old profile (a leading brand name is dropped) and sets a price paid where that keeps the cost
- **Costs and stats price a spool** by its price paid, else its material's default. Filament with no spool is priced by the material it reports. A quote's material prices are your spools' average, else the material default
- **Filament profiles have no price** and lose their unused cloud columns; Bambu Cloud fills a spool's fields and no longer needs a matching profile
- **Picking a spool on a plate no longer overwrites the slot's preset**
- **Keep is saved with the plate**: a kept suggestion stays hidden until the spool or the preset changes, and doesn't mark a slice outdated. Plates saved before keep their slice

## [5.4.0-alpha.2] - 2026-11-06

Pre-release. Test on a copy of your data first; back up before updating. Lists everything since 5.4.0-alpha.1. Migrations add the preset owner and hold columns, `goneInUse` on sync policies, and the `preset_routes` table.

### Added
- **Bambu Cloud user presets**: optional **User presets** cards on the Bambu Cloud card (machine, print and filament), Manual and daily by default, read-only. A preset already in your library from Studio is counted once, an edit in Studio updates the row and keeps a typed price, and one preset has one owner whichever way it arrives ([docs/bambu-cloud.md](docs/bambu-cloud.md))
- **A preset removed in a slicer asks before its row goes.** A user preset you delete in Bambu Studio or OrcaSlicer, or a system preset a slicer update drops, raises a **Sync needs review** alert, whatever the card's mode. The review lists it under **Gone from the slicer** with **Delete** when nothing uses it (archived instead when you edited it, so a typed price stays), or says what still uses it. Once it's free, the alert asks again. Nothing is deleted without a person ([docs/import.md](docs/import.md#from-an-integration))
- **Deletes reach other machines**: a preset removed in a slicer by its owner (whoever first shared it, or a zip's uploader) is deleted on the hub once nothing uses it, and Install devices remove their unedited copy after a backup. Another user's removal changes nothing and Install writes the preset back; a mass delete, or one on an account other users' devices share, is held for a person on the Presets page, which also has Restore for deleted presets ([docs/hub.md](docs/hub.md#deleting))

### Fixed
- An edit made in Bambu Studio no longer leaves a "(conflict bambu-cloud …)" copy and a conflict alert when the account's copy only words the same settings differently (`"255"` against `["255"]`)

### Not tested on real hardware
- Two PCs on different accounts and on one account (owner and other-user deletes, the held delete), and a synced preset reaching a worker and an Install device. They are covered by automated tests only.

## [5.4.0-alpha.1] - 2026-11-05

Pre-release. Test on a copy of your data first; back up before updating. Lists everything since 5.3.0. One migration adds `catalogFingerprint` to integrations.

### Added
- **One Catalog row on a slicer's card** (Bambu Studio, OrcaSlicer): **Choose brands** lists the printer and filament brands with what's in your catalog checked, and imports only the ones you pick, with their models, profiles and materials after a backup ([docs/import.md](docs/import.md#from-an-integration))
- **Presets reach the catalog on their own**: a preset you save in a slicer, or on a hub, is in the catalog within a minute, keeping the values you typed. A preset whose parent can't be found waits for review instead of failing
- **OrcaSlicer's system presets** are read from its `.opc` files, so Orca gets brands, models and profiles like Bambu Studio. An unknown Orca format shows a message on the card
- **Brand and Slicer columns** in the catalog tables on the Printers and Filament pages, with filters; sorting by brand and slicer, and a slicer filter on brands

### Changed
- **Slicer cards run when the slicer's files change, not on a schedule.** Bambu Studio's and OrcaSlicer's cards are now the same cards as Bambu Cloud's, grouped into Catalog, System presets and User presets, and "When" is Automatic when the files change or Manual. An existing Auto schedule on one of these types becomes Automatic, and its frequency is ignored. In Manual nothing is written: on a change in the slicer's system presets a **Sync needs review** alert leads to the review, for types you imported before. Bambu Cloud's schedules don't change
- **Your user presets reach the catalog on their own.** Each kind has its own card, Automatic by default: new presets are added and changed ones updated within a minute, keeping values you typed. Under "Only what I already have", or in Manual, a new preset raises an alert and waits for you in the review. These cards decide catalog rows only: sharing and installing presets between machines still moves every preset
- **OrcaSlicer's brands, printers and system presets can now be imported.** The app reads the binary profile files Orca 2.5 ships, on a desktop install, a downloaded one or an uploaded zip, so Orca gets the same cards, Choose brands and update alerts as Bambu Studio, and your Orca user presets find their brand and material. If a newer Orca changes the format, Choose brands says so and Orca works as before until the app is updated
- **Choose brands** has Select all on each list and shows the brands already in your catalog
- An automatic run now adds the brand and material a filament preset needs, as a review already did
- The cards' "Devices and prints" heading is gone, and "Open projects in the slicer" and "Slice projects" say what they do

## [5.3.0] - 2026-11-04

Stable. Same code as 5.3.0-alpha.2; the release notes list everything since 5.2.0 (the 5.3.0-alpha sections below). No new migrations. Back up before updating from 5.2.0.

### Added
- **Bulk edit in the import review**: tick rows and a bar shows the count, with **Clear** and **Bulk edit…**. The form sets an Action (Create, Update, Skip or Use suggestion) and each column, every field starting on **Don't change**; Apply writes to the selected rows at once, and nothing is saved until Import ([docs/import.md](docs/import.md#review-rows))
- Per column in an update, keep your edits and fill the rest from the file, or overwrite with the file's values
- Bulk edit sets the **Folder** of projects (Move to root, Create folder, No folder) and the **Prints** flows: No project, a spool per filament slot, and Track usage
- A result line after Apply says what was done and why the rest wasn't; problem rows stay selected
- **Filament to review**: tick rows across pages and assign one spool to all of them with a bar and form; Track usage is confirmed for the exact count of selected rows. Spools that don't fit a row are reported, not hidden

### Changed
- The **Bulk operations** panel is replaced by the selection bar and the Bulk edit form. The seven presets, the scope dropdown, the Merge column, the **When updating** setting and the separate Project, Spool, Track and Move fields are removed
- Filter or status chips end the selection
- **Bulk change projects root** in Settings → Projects uses the same bar as the other bulk actions

### Fixed
- Spools added in a review no longer show in the Project picker of other rows
- The Skip count in the review no longer goes negative when invalid rows are fixed

## [5.3.0-alpha.2] - 2026-11-04

Pre-release. Test on a copy of your data first; back up before updating. Lists everything since 5.2.0, including 5.3.0-alpha.1. No new migrations.

### Added
- **Bulk edit in the import review**: tick rows and a bar shows the count, with **Clear** and **Bulk edit…**. The form sets an Action (Create, Update, Skip or Use suggestion) and each column, every field starting on **Don't change**; Apply writes to the selected rows at once, and nothing is saved until Import ([docs/import.md](docs/import.md#review-rows))
- Per column in an update, keep your edits and fill the rest from the file, or overwrite with the file's values
- Bulk edit sets the **Folder** of projects (Move to root, Create folder, No folder) and the **Prints** flows: No project, a spool per filament slot, and Track usage
- A result line after Apply says what was done and why the rest wasn't; problem rows stay selected
- **Filament to review**: tick rows across pages and assign one spool to all of them with a bar and form; Track usage is confirmed for the exact count of selected rows. Spools that don't fit a row are reported, not hidden

### Changed
- The **Bulk operations** panel is replaced by the selection bar and the Bulk edit form. The seven presets, the scope dropdown, the Merge column, the **When updating** setting and the separate Project, Spool, Track and Move fields are removed
- Filter or status chips end the selection
- **Bulk change projects root** in Settings → Projects uses the same bar as the other bulk actions

### Fixed
- Spools added in a review no longer show in the Project picker of other rows
- The Skip count in the review no longer goes negative when invalid rows are fixed

## [5.3.0-alpha.1] - 2026-11-04

Pre-release. Test on a copy of your data first; back up before updating. Bulk edit for the import review; no new migrations.

### Added
- **Bulk edit in the import review**: tick rows and a bar shows the count, with **Clear** and **Bulk edit…**. The form sets an Action (Create, Update, Skip or Use suggestion) and each column, every field starting on **Don't change**; Apply writes to the selected rows at once, and nothing is saved until Import ([docs/import.md](docs/import.md#review-rows))
- Per column in an update, keep your edits and fill the rest from the file, or overwrite with the file's values
- Bulk edit sets the **Folder** of projects (Move to root, Create folder, No folder) and the **Prints** flows: No project, a spool per filament slot, and Track usage
- A result line after Apply says what was done and why the rest wasn't; problem rows stay selected

### Changed
- The **Bulk operations** panel is replaced by the selection bar and the Bulk edit form. The seven presets, the scope dropdown, the Merge column, the **When updating** setting and the separate Project, Spool, Track and Move fields are removed
- Filter or status chips end the selection
- **Bulk change projects root** in Settings → Projects uses the same bar as the other bulk actions

### Fixed
- Spools added in a review no longer show in the Project picker of other rows
- The Skip count in the review no longer goes negative when invalid rows are fixed

## [5.2.0] - 2026-11-03

Stable. Same code as 5.2.0-alpha.3; the release notes list everything since 5.1.0 (the 5.2.0-alpha sections below). No new migrations. Back up before updating from 5.1.0.

## [5.2.0-alpha.3] - 2026-11-03

Pre-release. Test on a copy of your data first; back up before updating. Fixes found by running the release scenarios on a real 5.1.0 database; everything in 5.2.0-alpha.2 is included. No new migrations.

### Fixed
- Saving a new token or opening the alert channels no longer fails when the database was moved without its `secret.key`: what can't be read counts as not set, so a sync asks you to sign in again
- An image whose file is gone from the disk (thumbnail, photo, logo) answers 404 instead of a server error
- Deleting a printer used by a project's plate, or a user who owns projects, no longer fails on a database that applied those migrations before their final form

## [5.2.0-alpha.2] - 2026-11-03

Pre-release. Test on a copy of your data first; back up before updating. Adds archive, delete and bulk actions; everything in 5.2.0-alpha.1 is included. A migration adds archive columns and the record of deleted imports.

### Added
- **Archive, restore and delete on every list and detail page** for printers, accessories, maintenance types, printer brands and models, machine and print profiles, spools, filament brands, materials and profiles, projects, prints, orders, quotes and clients, with a **Show archived** filter ([docs/archive-delete.md](docs/archive-delete.md))
- A delete that something still uses is refused and lists what uses it, with links, and offers Archive instead
- **Bulk archive, restore and delete** with checkboxes and **Select all matching rows, on every page**, for users with Manage on the module; blocked rows are reported and stay selected
- A sync or import skips archived items, and shows an item you deleted as **You deleted this** instead of adding it back
- Archiving resolves the item's open alerts

### Changed
- `DELETE` on a printer or accessory now deletes it (or answers `409 in_use`) instead of archiving; archive through `PATCH`. Deleting an order, quote or client that is used is refused instead of unlinking
- Archived items keep their names and numbers, and the "already taken" messages say the other one may be archived
- Auto slice skips archived projects

## [5.2.0-alpha.1] - 2026-11-03

Pre-release. Test on a copy of your data first; back up before updating. Archive and delete come in a later 5.2.0 pre-release.

### Added
- **Bulk change projects root** in Settings → Projects: filter and select projects and point them at another root, keeping their relative folders. **Move files** also moves the files when both roots are on the server ([docs/projects.md](docs/projects.md#moving-projects-to-another-root))
- **Change a connector's user** with a one-time code from Hub management, choosing whether the projects in its folders move to the new user ([docs/hub.md](docs/hub.md#change-a-connectors-user))
- The connector's status page, and its card and edit page in Hub management, show the user it acts as
- **Move all folders to** a root in the projects review of an import, and each folder can be edited in the table ([docs/import.md](docs/import.md#projects))
- Docs: [moving to a new machine](docs/backups.md#moving-to-a-new-machine)

### Changed
- The GitHub release notes now come from this changelog
- README screenshots for roles, My account and slicer presets

### Fixed
- The Filament table on Stats shows material cost instead of total cost
- A successful sync resolves its open sync error alerts

## [5.1.0] - 2026-11-02

Stable release. Everything in 5.1.0-alpha.1 to alpha.4 is included; nothing changed after alpha.4. Test on a copy of your data first; back up before updating. Updating from 5.0.0 keeps every user's rights and alerts.

### Added
- **Alerts per role and user** and **delivery per user**, with the **My account** page ([docs/alerts.md](docs/alerts.md), [docs/users.md](docs/users.md))
- **Slicer presets library** on the hub, sharing and installing presets on workstations ([docs/hub.md](docs/hub.md#slicer-presets))

## [5.1.0-alpha.4] - 2026-11-02

Pre-release. Test on a copy of your data first; back up before updating. Same as alpha.3, whose release build failed on a slow test.

### Fixed
- The release build no longer fails when a slow runner takes longer than 20 s on a preset echo test

## [5.1.0-alpha.3] - 2026-11-02

Pre-release. Test on a copy of your data first; back up before updating.

### Added
- **Slicer presets library** on the hub: the user presets of Bambu Studio and OrcaSlicer in one place, used by the hub's slicer and every slice worker. Browse, download earlier versions and delete on the new **Slicer presets** page ([docs/hub.md](docs/hub.md#slicer-presets))
- **Share my presets**: a workstation sends the presets saved in its slicers to the hub
- **Install hub presets**: the connector writes the library into a workstation's slicer while it is closed, with a backup first, in the way Bambu Cloud and OrcaCloud expect
- **Manage slicer presets** permission (Admin and Editor), and **Preset conflict** / **Preset skipped** alerts
- A slice shows as outdated when a preset it used changes

### Changed
- Importing a slicer zip on a hub merges into the library instead of replacing the slicer's user presets
- The Slicer presets page can be reached without the hub management permission

## [5.1.0-alpha.2] - 2026-11-02

Pre-release. Test on a copy of your data first; back up before updating. Shared presets come in a later 5.1.0 pre-release.

### Added
- **Alerts per role and user**: each role sets every kind of alert to Off, In app or Notify, and a user can override any kind. Nobody gets an alert their permissions don't cover or about a project they can't see ([docs/alerts.md](docs/alerts.md))
- **Delivery per user**: each person sets their own email and ntfy topic and token, and Notify alerts go to them once. The mail and ntfy servers stay in Settings → Alerts
- **My account** page in the account menu: your name and password, your alerts and your delivery, with a test button
- Settings → Alerts warns when no enabled user gets a condition alert

### Changed
- The "alert about missing price / open date" spool switches are now part of the role alert settings
- Updating keeps notifications: the old email recipient and ntfy topic move to the oldest enabled admin

## [5.1.0-alpha.1] - 2026-11-02

Pre-release. Test on a copy of your data first; back up before updating. Alerts per user and shared presets come in later 5.1.0 pre-releases.

### Added
- **Roles and permissions**: Admin, Editor and Viewer become roles, and you can add your own under **Settings → Roles**. Each module has a step (none, read, write, manage), plus switches for syncs, imports, integrations setup, the hub, server, backups, logs, branding, alert settings and users ([docs/users.md](docs/users.md#roles))
- **Per-user overrides**: give one user more or less than their role, permission by permission, on the new user page. The project rights (see everyone's projects, edit them, edit files on other workstations) are part of it
- Users with **Users and roles** who aren't admins can manage users and roles, but never give more than they have
- Hub management: an **edit connector** page with port, start at login, restart, rename, sync and slicing
- Connector: **Unpair** from the connector side, and **Restart server** / **Stop server** on the pair screen

### Changed
- Updating keeps everyone's rights: users move to the matching role, and the old per-user project switches become overrides only where they differed
- A change of role or rights applies at once, without signing the user out
- **Settings → Users** is a table with a page per user; **Settings → Roles** lists the roles with filters
- New devices sync selected projects by default; the default is a setting in Hub management. The quote picker lists newest first
- Projects settings are organized into cards
- Connector: the status page has a new look, and shows the hub's name, logo and favicon once paired (name + "Connector")
- Connector: refuses to start on a machine where a hub is running

### Fixed
- The accent selector shows the picked color

## [5.0.0] - 2026-10-30

Stable. The hub, connectors, locks, file versions and slice workers, as in the 5.0.0 pre-releases. Nothing changed in the app since 5.0.0-alpha.6; this release only marks it stable. Back up before updating from 4.x.

## [5.0.0-alpha.6] - 2026-10-30

Pre-release. Test on a copy of your data first; back up before updating.

### Fixed
- A hub root added, changed or removed in Settings now reaches the devices that are online at once; before, they picked it up only after reconnecting

## [5.0.0-alpha.5] - 2026-10-29

Pre-release. Test on a copy of your data first; back up before updating.

### Added
- **Slice workers**: turn on **Slice worker** for a device in Hub management and it can run a slicer for the hub. New **Bambu Studio (worker)** and **OrcaSlicer (worker)** integrations pick a slicer found on the device, install the hub's managed release there, or take a typed path behind a **Manual path** switch. The worker appears in the slicer pickers named after its device ([docs/slicing.md](docs/slicing.md#slice-on-a-worker))
- A worker that is offline leaves its slices *waiting* without blocking the queue; they run when it connects, or **Slice on the server instead**

### Changed
- A connector that is too old for slice workers says so ("update it") instead of a generic error
- A Bambu Studio worker only slices, like the OrcaSlicer one: its presets come from the zip import

### Fixed
- A connector updated after the hub never learned it was a slice worker and refused slices
- A connector started in the hub's data folder deleted the hub's own server slicer installs; it now refuses to start there

## [5.0.0-alpha.4] - 2026-10-29

Pre-release. Test on a copy of your data first; back up before updating. Slice workers come in later 5.0.0 pre-releases.

### Added
- **Check-out locks** (Hub management → Settings, off by default; on or strict): opening a hub file on a workstation, or the first save there, checks it out and other devices get it read-only. It is released when the slicer exits (Windows and Linux), on **Done editing**, after an idle time, or by an admin. The project page shows who has a file checked out ([docs/hub.md](docs/hub.md#locks))
- **File versions** (off by default): a save that replaces a hub file keeps the old content, the newest N per file. The project page lists them with Download; Settings shows the disk they use; backups include them and say so ([docs/hub.md](docs/hub.md#versions))

### Changed
- **One Open button** on the project page and file rows opens the slicer on the computer you sit at: the server's own slicer on the server's computer, else that computer's connector, else your online devices (asking when several). **Open folder** follows the same order. A connector can be set to **Ask each time** instead of a default slicer
- The hub's settings have their own page under Hub management

### Fixed
- Deleting a user left the files their devices had checked out read-only on other devices

## [5.0.0-alpha.3] - 2026-10-29

Pre-release. Test on a copy of your data first; back up before updating. Locks, versions and slice workers come in later 5.0.0 pre-releases.

### Added
- **Hub roots sync**: a root on this server is kept in each device's sync folder, both ways. Conflicts keep both versions (`… (conflict <device> <date>)`) and raise an alert; deletes go to the hub's trash ([docs/hub.md](docs/hub.md))
- **Mass delete guard**: a device that deletes more files than the limit at once (Hub management, default 20) or whose root folder is missing pauses its sync until you confirm or restore on its status page. Hub management shows each device's sync state
- **Selected projects**: a device syncs everything or only the projects chosen for it
- **Open on my workstation**: on the project page and model files, opens the project in the slicer on your own online device. Connectors find installed slicers and you pick the default on the status page
- **Shared folders**: a connector shares only the folders you add on its status page. The hub can't browse or add anything outside them; a root outside them reads "Not shared on the device"

### Changed
- Upgraded connectors start by sharing the folders their roots are in

## [5.0.0-alpha.2] - 2026-10-28

Pre-release. Test on a copy of your data first; back up before updating. Syncing project folders between devices comes in later 5.0.0 pre-releases.

### Added
- **Device roots**: add a project root on a paired device. The connector watches it and sends each project's scan and 3MF details; the hub pulls a file only when slicing, downloading or viewing it. Offline devices show their last known data ([docs/hub.md](docs/hub.md))
- Device projects show plate previews and can pick a cover and gallery images, also while the device is offline. Setting: **Device folder size limit** (default 32 MB)
- **Owners and permissions**: projects have an owner (admins change it); users get "sees all projects", "edits other people's projects" and "edits files on other people's devices"; roots get "who can edit". Projects a user can't see show as "Other project" elsewhere
- Admins change a project's owner, or clear it, in the project's edit form
- **Connector updates**: Hub management marks an outdated connector or a failed update, raises an alert and offers **Update now**. The connector's status page has **Restart** and **Stop**

### Fixed
- The connector installer left out a package it needs, so the installed connector didn't start
- Import review: "keep my edits" on a row that matches a project but isn't linked yet now links it, so it isn't offered again

### Changed
- Browsing a device whose connector is too old says so instead of timing out

## [5.0.0-alpha.1] - 2026-10-28

Pre-release. Test on a copy of your data first; back up before updating. Syncing project folders and device roots come in later 5.0.0 pre-releases.

### Added
- **Hub**: a switch in Settings → Server (admins, off by default, needs user accounts). Off, nothing changes ([docs/hub.md](docs/hub.md))
- **Hub management**: a menu section for admins with the paired devices (name, user, OS, connector version, online or last seen). Pair a device with a one-time code (10 minutes), rename it or revoke it; a revoked device loses access at once
- **Connector**: a small app for workstations, a NAS or a file server, with a status page on 127.0.0.1 to pair it. It connects out to the hub (event stream and heartbeat, resuming after a reconnect), starts at login and updates to the hub's version with rollback
- Connector installers for Windows (.exe), macOS (.dmg) and Linux (.tar.gz). Releases carry `SHA256SUMS` and GitHub artifact attestations for every asset

### Changed
- Project folders are stored as roots with a relative path per project; existing installs migrate with their project links kept

## [4.2.1] - 2026-10-28

Stable. Back up before updating.

### Added
- `APP_ALLOWED_HOSTS`: public host names a reverse proxy forwards in `Host`, accepted by the loopback host guard. Setup from such a host still needs the setup token

## [4.2.0] - 2026-10-26

Stable. Back up before updating. The features are listed under 4.2.0-alpha.1 to alpha.3.

### Fixed
- Bambu Cloud spools go on Bambu Studio's filament profiles (local or server) or ones you made, never on OrcaSlicer's
- Import review: a vendor spool that matched a spool you have is no longer held for review because two profiles share its name (e.g. "Bambu PLA Matte" from Bambu Studio and OrcaSlicer)
- Import review: the same catalog name from two slicers is one name, so a spool's profile is no longer offered as overwritten with the vendor's short name ("PLA Matte")
- Alerts: the history says so when it fails to load instead of showing an empty list

## [4.2.0-alpha.3] - 2026-10-26

Pre-release. Test on a copy of your data first; back up before updating.

### Added
- Integrations: **Bambu Studio (server)** and **OrcaSlicer (server)**. The server downloads the slicer from the vendor's GitHub releases (checksum checked, licence shown), tests it and slices with it, so a NAS or headless server can slice without a desktop slicer. Install, update to a newer version or remove it from the card; the old version stays until the new one starts
- Bambu Studio (server) imports brands, printers and profiles from the download, with the same sync options as the local one. OrcaSlicer (server) can't read its download's profiles; its card explains how to import them from a zip
- OrcaSlicer (local) can slice too (OrcaSlicer 2.5 or newer)
- Docker: a **slicer image** (`:X.Y.Z-slicer`, `:latest-slicer`, `:dev-slicer`) with the libraries a server slicer needs; the default image stays small ([docs/slicing.md](docs/slicing.md))
- Slicing: pick the slicer per plate, per project (Print setup) or as the default; the first slice-capable one is the fallback
- Slicer user presets from a zip are kept for the server slicers, so slicing works with only a server slicer
- A slice remembers the slicer version; a new version marks it outdated and an install slices it again where auto slice is on
- Alert when a newer slicer release exists, with a link to the integration card
- Printer and filament settings tables show which slicer each preset came from
- Filament slots can stay "As saved in the file", and new plates start on it
- Integration cards start closed; a server slicer is named like its local twin, with a badge for the kind

### Changed
- The Docker image is built on Debian 13 (trixie), which the slicers need
- Print profile and filament pickers list the presets of the plate's slicer
- A filament preset of another slicer slices with the file's own filament and the plate notes it; the plate warns before slicing when its print or printer profile belongs to the other slicer
- Sync scope "Only what I already have" no longer adds slicer presets (machine, print, filament) of a brand you have
- Slicer presets only match presets of the same slicer, so Bambu Studio's and OrcaSlicer's "Bambu ABS" stay two profiles
- The import links on the printer and filament catalogs are gone; the Add buttons stay

### Fixed
- Slicing: an empty plate says so instead of "input model file can not be parsed"
- Projects: a slice made before slicer choice counts as the default slicer's, so picking another slicer marks it for slicing
- Import review: a bulk action picked but not applied no longer imports the rows' own suggestions; Import waits until it is applied or cleared
- Edit forms (spool, printer, accessory, client, order, maintenance type, filament profile) leave the edit page after saving

## [4.2.0-alpha.2] - 2026-10-25

Pre-release. Test on a copy of your data first; back up before updating.

### Added
- Integrations: an admin can let an editor run single tasks: **Sync now** and/or **Review** per data type ([docs/users.md](docs/users.md#integration-tasks-for-editors))
- Projects: **New folder** in the folder picker, confined to the project roots; the roots picker can create folders
- Viewers can mark alerts read or unread, snooze and dismiss them

### Changed
- Alerts are read, snoozed and dismissed per person: marking one read leaves it unread for the others. When an admin or editor fixes the cause (maintenance done, a review finished, a spool's price or open date filled in), the alert is resolved for everyone
- Printers, accessories, maintenance types, catalogs and module settings (costs, workflow) are admin-only; editors log work but don't change setup
- Settings → Branding, Server, Backup, Logs and About are admin-only; the server's stop banner shows in the app shell
- Project folder pickers show paths from the root down

### Fixed
- Projects: New folder in the picker no longer submits the page form around it

## [4.2.0-alpha.1] - 2026-10-24

Pre-release. Test on a copy of your data first; back up before updating.

### Added
- Users and roles: accounts with **viewer**, **editor** and **admin** roles. Viewers look, editors work with the data, admins also manage the server, updates, backups and users ([docs/users.md](docs/users.md))
- First run: the server prints a setup token to create the first admin from another device (in Docker, `docker compose logs app`)
- Each person changes their own name, password and display preferences (language, units, date and time format, theme, accent)
- Settings → Users to add people, change their role, disable an account or reset a password
- Logs record which user made each change
- Reset a lost admin password from the server's shell: `pnpm user:reset-password <email>` (in Docker: `docker compose exec app pnpm user:reset-password <email>`)

### Changed
- `APP_PASSWORD` is ignored once a user account exists; the server warns at start. Create accounts and remove it
- The Docker example no longer sets `APP_PASSWORD`; create accounts after the first start

## [4.1.3] - 2026-10-23

### Added
- Integrations: per sync of spools, choose what happens to a **new spool**: import its weight, leave it unset, or review it first; the same for its open date
- Alerts: optional warnings for spools with no price and for spools in use with no open date (Settings → Alerts, off by default)

### Changed
- Spools can be saved without an initial weight; nothing is taken from them until you set it
- Time and combo-box inputs in the sync policy rows are easier to use with the keyboard

## [4.1.2] - 2026-10-23

### Fixed
- Windows installer: on a PC with no default browser, the "How do you want to open this?" picker closed at once and no browser opened. Reinstall with the 4.1.2 installer to get the fix (in-app updates don't replace the launcher)

## [4.1.1] - 2026-10-23

Fixes and polish after 4.1.0.

### Added
- Settings → Server: **Restart** with a "restarting" modal; the page moves to the new port. Server actions sit at the top of the page, with the network address hint and the data folder shown as text
- Settings → General: **Start at login**
- Integrations: per type, choose what a sync adds (**Everything** or **Only what I already have**) and how it treats rows you changed (**Overwrite with the source**, **Keep my edits** or **Let me review the changes**)
- Integrations: pick the time an automatic sync runs
- Integrations: review and import a past period from a type's settings
- Clients: delete a client
- Printers: add a model or brand from modals on the add printer form; quick-add modals for profiles, models and spools
- Projects: the project page hides empty files, prints and 3D cards
- Mobile: the brand shows in a header
- Alerts: the update available alert has a call to action

### Changed
- Installed copies started at login run in the background and don't open the browser; the installer's start option opens the app

### Fixed
- Settings: the autostart check reports support instead of a 404; restarting after clearing the port goes to the default port
- Installers: the start option opened no browser
- Integrations: the green dot for an automatic sync shows in any accent colour; a sync continues from the last sync, including after a review
- Alerts: list rows keep only the read and dismiss actions
- Clients: the quotes list refreshes after deleting a client
- Tailwind: canonical classes in the projects and shell pages

## [4.1.0] - 2026-10-23

Stable release of the 4.1.0 pre-releases (alpha.1 to alpha.3). The alpha.3 build only bumped the version to test updates and rollback; the Windows install, autostart, update and rollback test found no changes to make.

### Added
- Installers for Windows (`setup.exe`), macOS (`.dmg`, Apple silicon and Intel) and Linux (`tar.gz`). They bring their own Node, so no git, pnpm or Node is needed; the install guide lists the unsigned-build warnings for each system
- Release assets: one app zip per system (what the in-app updater downloads) and `SHA256SUMS`
- Settings → Server → **Start at login**: starts the app when you sign in; the installers' "Start when I sign in" box writes the same entry
- Settings → Server → **Stop server**
- The launcher opens the browser on start and refuses a second copy, which just opens the browser again
- Updates for installed copies: **Update** downloads the app zip, checks it against `SHA256SUMS`, and keeps the previous version for **Roll back**; a new version that fails to start within 60 s is undone automatically
- Projects: create, link, unlink and switch a project folder from the project page; a banner when a folder is missing (recreate it, link another, or unlink)
- Projects: unlinking or switching a folder asks whether to move it to the root's trash or keep it as it is; a kept folder can be linked again
- Projects: delete a project with no prints or orders; an empty folder below a root goes with it
- Projects: a project can adopt a new folder whose number matches it when it has no folder or its folder is gone
- Prints: a "No project" filter and label in the prints list; prints with no project show in import, review and sync
- Integrations: cards with a header menu and an Enabled switch; collapsible sections
- Integrations: grouped sync rows with Auto or Manual mode, a Manual import button, and a to-review flag
- Integrations: Manual import for cloud printers; a printer with the same serial as a hand-added one is linked, not duplicated
- Import: review every item a source offers, archived ones included
- Footer with the year, version, stage and links
- Alerts: sync success alerts link to the module that synced

### Changed
- Installed copies log to `logs/server.log` and `logs/launcher.log` in the install folder (see [install.md](docs/install.md#where-the-installed-app-and-its-logs-live))
- Git installs keep working as before (`pnpm start`, Settings → Update)

### Fixed
- Mobile: the project page and grid children no longer widen the page on phones
- Projects: the scroll bar under gallery thumbnails is hidden
- Projects: slice plates are dropped when the folder changes
- Tables: screen-reader labels stay inside the scroll container

## [4.1.0-alpha.3] - 2026-10-23

### Changed
- Version bump to exercise the installer update and rollback path (Step 15 test build)

## [4.1.0-alpha.2] - 2026-10-23

### Added
- Installers for Windows (`setup.exe`), macOS (`.dmg`, Apple silicon and Intel) and Linux (`tar.gz`). They bring their own Node, so no git, pnpm or Node is needed; the install guide lists the unsigned-build warnings for each system
- Release assets: one app zip per system (what the in-app updater downloads) and `SHA256SUMS`
- Settings → Server → **Start at login**: starts the app when you sign in; the installers' "Start when I sign in" box writes the same entry
- Settings → Server → **Stop server**
- The launcher opens the browser on start and refuses a second copy, which just opens the browser again
- Updates for installed copies: **Update** downloads the app zip, checks it against `SHA256SUMS`, and keeps the previous version for **Roll back**; a new version that fails to start within 60 s is undone automatically

### Changed
- Installed copies log to `logs/server.log` and `logs/launcher.log` in the install folder (see [install.md](docs/install.md#where-the-installed-app-and-its-logs-live))
- Git installs keep working as before (`pnpm start`, Settings → Update)

## [4.1.0-alpha.1] - 2026-10-23

### Added
- Projects: create, link, unlink and switch a project folder from the project page; a banner when a folder is missing (recreate it, link another, or unlink)
- Projects: unlinking or switching a folder asks whether to move it to the root's trash or keep it as it is; a kept folder can be linked again
- Projects: delete a project with no prints or orders; an empty folder below a root goes with it
- Projects: a project can adopt a new folder whose number matches it when it has no folder or its folder is gone
- Prints: a "No project" filter and label in the prints list; prints with no project show in import, review and sync
- Integrations: cards with a header menu and an Enabled switch; collapsible sections
- Integrations: grouped sync rows with Auto or Manual mode, a Manual import button, and a to-review flag
- Integrations: Manual import for cloud printers; a printer with the same serial as a hand-added one is linked, not duplicated
- Import: review every item a source offers, archived ones included
- Footer with the year, version, stage and links
- Alerts: sync success alerts link to the module that synced

### Fixed
- Mobile: the project page and grid children no longer widen the page on phones
- Projects: the scroll bar under gallery thumbnails is hidden
- Projects: slice plates are dropped when the folder changes
- Tables: screen-reader labels stay inside the scroll container

## [4.0.0] - 2026-10-22

### Added
- Install: a "Start at login" guide for Windows (Task Scheduler), macOS (launchd) and Linux (systemd user unit)
- README: more screenshots of every module and detail page

### Changed
- Responsive pass: the app is checked at 375, 768 and 1440 px wide, with the sidebar footer spaced for touch
- Spool page: its translations load with the projects and prints it shows

## [4.0.0-alpha.4] - 2026-10-22

### Changed
- Version bump to test updating from and rolling back to alpha.3 on real machines; update and rollback from GitHub verified on Windows and macOS, no fixes needed

## [4.0.0-alpha.3] - 2026-10-22

### Added
- Install: a guide for Windows, macOS, Linux and Docker, with the commands for each and how to check the data folder
- Docker: a `Dockerfile`, a `docker-compose.yml` example with a data volume, a read-only project folder mount and `APP_PASSWORD`; the release workflow publishes `ghcr.io/emanuelmoniz/3d-maker-suite` (`:X.Y.Z` and `:latest`, or `:X.Y.Z-alpha.N` and `:dev`)
- Settings → About & updates: the app version, an update channel (Stable, or Dev for pre-releases), **Check now**, and the update history
- Updates: the app checks GitHub daily for a newer release and shows a banner and an alert; **Update** backs up your data, switches to the release, installs, builds and restarts, with the progress shown on the page
- Rollback: each update keeps its backup; **Roll back** returns to the version before it, restoring that backup (the last 5 updates are kept)
- Docker and non-git installs are told the exact commands to update instead of getting an Update button

### Changed
- `pnpm start` runs a small launcher that restarts the server when it asks for it, and applies an update or rollback in between. If an update fails, the previous version starts again and the reason is shown
- Restart from Settings → Network works under the launcher; without it, the previous restart method still applies
- Backups made before an update are named `update-…` and kept with their update
- `GET /api/health` also returns the app version

### Fixed
- The update banner showed raw text keys on pages other than Settings

## [4.0.0-alpha.2] - 2026-10-22

### Added
- Import: 19 import types, each also exported in the same format: maintenance types, maintenance, order projects, printer and filament catalogs (brands, models, profiles, materials)
- Import: one format for template and export; the review cells are editable in place, with an undo for each edited cell
- Import | Export: one page with the import and export sections, a slicer zip card and how-to instructions
- Logs: a log module fed from the app's logger, with settings for levels, modules, retention and maximum entries, and a Logs page (off by default) with filters and sorting

### Changed
- Import | Export: export moved out of Settings; backups keep their own section
- Import: the import history is no longer kept

## [4.0.0-alpha.1] - 2026-10-22

### Added
- Projects: each project folder root has its own project depth, files depth and auto slice, set when adding the root and in Settings → Projects. Files depth "All" (the default) lists and watches every level; the files-per-project limit stays as a safety cap
- Projects: project info can be a Markdown file in the project folder, loaded and saved back from the app; a new file can be created from the text typed so far
- Projects: the gallery shows a square viewer with previous and next buttons, touch swipe and a thumbnail strip that scrolls with buttons or touch; the cover comes first
- Integrations: a usage toggle for synced spools ("Take the remaining weight of synced spools from the vendor") and a warning when prints and spools would both track usage

### Changed
- Projects: one Save on the edit page; the sections are collapsible cards, and the print setup has a deep link
- Projects: the project folder settings use the full width, with the hints in three columns
- Stats: charts share one bar chart with value axes on both sides and a tooltip with the date and value
- Integrations: spools sync is off for newly added Bambu Cloud integrations; existing ones keep their setting
- CI: pushes to `dev` run the checks, and release tags must be on `main` (stable) or `dev` (pre-release)

## [3.0.0] - 2026-10-21

### Fixed
- Stats: a long project name no longer pushes the filters off a phone screen

## [3.0.0-alpha.3] - 2026-10-21

### Added
- Import: accessory installs from a file (template, export, review). Accessory and printer are found by number or name; unknown references and overlapping periods show as invalid rows
- Import: projects from a file (template, export, review). Each row can take a folder picked inside the project folders, a folder the app creates, or none; the prints each project gets are shown and can be changed before the import
- Projects: auto slice per project folder (on by default, overridable per project in its print setup). When a sliced file changes, its outdated plates are sliced again with their saved setup; a changed setup raises a warning instead of guessing

## [3.0.0-alpha.2] - 2026-10-21

### Added
- Alerts: one "Needs attention" list with severity, module and the task that raised each alert; the alert name opens its view
- Alerts: view with details (sync log), mark as read or unread, snooze, dismiss or restore, and actions to open the spool, task or integration
- Alerts: history table of snoozed, read, dismissed and resolved alerts, with filters and sort
- Alerts: per-task settings. Maintenance types set their own warning lead (days, hours or prints) and on/off switches; spools set a low weight; each sync type picks which of error, review and success it raises
- Alerts: ntfy and email (SMTP) channels with a test send; secrets are encrypted and never shown again
- Alerts: a warning for maintenance in print hours and prints by default

### Changed
- Alerts: live counts in the alert view, not in its title; the spool-low title is shorter and shows the weight

## [3.0.0-alpha.1] - 2026-10-21

### Added
- Projects: image gallery above the project info; pick images from the project folder, choose the cover, and open them in a viewer
- Projects: "Files per project" limit in Settings; a scan lists at most that many files per folder
- Projects: Plates, Prints, Files and the description are collapsible sections
- Projects: material usage and production cost components, shared by the project and quote pages
- Printers: success rate column and an hours filter in the printers table
- Tables: searchable choice filters on every table

### Changed
- Filament: default order by remaining weight, grams shown as whole grams everywhere
- Projects: "Set up slicing" is now "Set up print"; the project page layout and labels were reworked, and the folder label shows the project's last two folders
- Settings: config tables sort by brand and model; accessories can be exported; "Track usage" is hidden when there are no prints
- Quote page shows which printer its cost is for

### Fixed
- Folder scan does one pass per request, and the watcher scans only the folder that changed
- Scan drops gallery picks whose files were removed outside the app
- Folder labels use the path's own separator and run from the project root down
- Low-spool tag sits left of the remaining weight

## [2.0.0] - 2026-10-21

### Added
- Projects: manage the files in a project folder: upload, create folders, move (pick the destination among the folders), bulk move and remove
- Projects: choose the default 3D preview file, kept when the folder is re-scanned
- Projects: description editor with a markdown preview; saving writes the linked `.md` file
- Projects: "View all" shows a mosaic of the plate previews, plus one cost estimate for the whole print

### Fixed
- 3MF files with large meshes are parsed instead of dropped
- Preview choice works with Windows paths and returns to the project after saving
- Plate preview, description editor and slicing work on the edit page

## [2.0.0-alpha.3] - 2026-10-19

### Added
- Accounting: **Clients** with name and mobile (required), VAT, email, address and notes; VAT, mobile and email must be unique
- Quotes: numbered like the other modules, with notes, an optional client and an optional project; a list on the Costs page and tables on project and client pages
- Quote calculator reworked: picking a project fills the quote from it (printable files, plates, print profile and filament), all editable; without a project everything is manual and optional
- Orders: a number, a client, a project, an optional quote, a price, a status (accepted, in progress, done, canceled) and notes; a print can belong to one order, and the order page shows its prints and their cost
- Orders can be created from a quote; project and client pages list their orders
- Import and export of clients, quotes and orders from the file import, with a template and review like prints

### Changed
- "Pieces" on quotes becomes "Prints" and moves to the print section; labour hours are per print
- Sidebar: quotes, orders and clients sit in the Accounting group

## [2.0.0-alpha.2] - 2026-10-19

### Added
- Projects: slicing per plate with print profiles and filament per slot, run by Bambu Studio on the server's PC (set its **Slicer program** in Integrations); results are stored and cached until the file, presets or slicer change
- Projects: estimated cost of one complete print from the sliced (or typed) time and grams per plate, next to the printed-copies cost
- Projects: "Slicing" column and filter (not set up, needs slicing, sliced)
- Projects: printer per plate, the 3MF's own print profile, and spools per slot

### Changed
- Projects: filament usage is listed in rows, like the cost breakdown

### Fixed
- Painted filaments and a modifier's filament count as slots of their plate
- Slicing keeps the 3MF's own setting changes on top of the chosen print profile, and passes complete presets so purges and the prime tower count
- Clearing a plate's results when its presets were incomplete
- A printer or filament sync also imports built-in print profiles and filament presets
- Printer model labels don't repeat the brand

## [2.0.0-alpha.1] - 2026-10-18

### Added
- Accessories: data, pages and install history (put on or remove from a printer, with past periods), photos, tags, notes, typical power
- Accessory usage: prints of the printer it was on while installed, shown on the accessory page and in the accessories table
- Maintenance for accessories: types target a printer or an accessory, tasks point at one of them, and due status and alerts include both
- Lifetime hours and "include maintenance cost" per printer and accessory, with the Costs defaults as fallback; accessories also have "count in costs"
- Costs settings: a Printers section (count printers in costs, lifetime, maintenance) and accessory defaults
- A print pays for its printer plus every counted accessory installed on it when it started
- Printers: "count in costs" switch, and prints and print time columns in the printers table
- Printer and accessory import from a file, with the same cost columns and review
- Stats: material filter, outcome filter, and labels on every filter and chart control
- Estimated duration when a print is created or edited with grams and no duration

### Changed
- Stats: filament rows are split by grams, so rows add up to the totals; the filament filter counts only that filament's grams and share of time and costs
- Stats: the page opens on All time by month; series fill empty buckets so the chart and CSV keep a true time axis
- Every table can sort and filter; the project column sits on the prints table
- Sidebar: Accounting group, with Projects before Prints
- Covers are removed from prints; the Bambu cover mapping goes with them

### Fixed
- Lists keep their scroll position after search, sort and filter
- Stats project filter lists the highest number first
- Maintenance due table no longer crashes on types without a days interval

## [1.3.0] - 2026-10-16

### Added
- Sync from Bambu Cloud button on the Printers, Prints and Filament pages, for that page's data type
- Sync result alerts: new and updated rows, rows waiting for review, or an error
- Date and time format preferences in Settings → General (24- or 12-hour clock)
- Bulk set spool and bulk set project and usage tracking for print rows in the import review, in one panel with one Apply
- Searchable dropdowns replace every native select
- Default printer is a dropdown on the printers config page
- Filament default filter, and default sort orders on the lists

### Changed
- Projects: prints and printed-copies cost sit beside the preview, the description below the plates, and the prints list above the files
- Imported prints are numbered oldest first; cloud prints are renumbered on sync
- Back links go back in history, with a fixed route as the fallback

### Fixed
- Two-decimal grams accepted on every weight input
- Customize mode on the home page: controls no longer overlap widgets, touch targets are 40px
- Project folders stay renamable while the server runs
- Column filter popover stays on screen

## [1.2.0-alpha.1] - 2026-10-15

### Added
- Settings module pages for costs, prints, projects, printers, filament and alerts, with gear buttons on each page
- Path picker in Settings to choose the slicer executable, config folders and project roots
- Projects: add a project from a folder, and link a `.md` or `.txt` file as its description (`.md` is rendered as markdown)
- Projects: pick the project on the print form
- Filament: spool number and colour name, with a display name built from them; numbers are unique and padded in display names
- Printers and projects get a unique, editable number and display name
- Spool numbers and colour names in the spreadsheet import
- Prints import creates print numbers and requires a project for every imported print
- Estimated print duration when a print has grams but no time, plus an "Estimate from filament" button on the print form
- `sync_pending` alert for rows an automatic sync leaves for your review, with a Review button and a toggle
- Review synced prints and match spools added later; pick the spool per slot in the sync review
- Spool pickers for file prints in the import review, add a spool from the review, and a track-usage tick per print row

### Changed
- Spools go empty at 0 g and refuse prints from before they were opened
- Spools are matched by capacity and age; guesses are flagged for review
- Filament usage always takes grams from the spool, including for prints older than it
- Spool page lists its prints and projects; clearer filament errors
- MakerWorld prints link to projects by the model title in the 3MF
- Duration section sits after filament on the print form

### Fixed
- Import matches references by their number, padded or not
- Duplicate file-upload label focus outline removed
- Responsive layout fixes found by the end-to-end pass at 375, 768 and 1440 px

## [1.1.0-alpha.1] - 2026-10-14

### Added
- Integrations hub: one page for every account and slicer, with a sync mode, frequency and "Sync now" per data type, and a sync log
- Sync by type and date range; Bambu print history can be re-imported for a range
- Bambu Cloud and Bambu Studio are separate integrations; Studio reads a local config folder
- OrcaSlicer integration: reads its presets and can open projects in OrcaSlicer
- Import page for spreadsheets (spools, printers, prints): download a template, upload or export, review every row before saving, and see the import history
- Import printers and print history from integrations, and filament and machine profiles from a local slicer
- Import a slicer catalog from a zip, for a server with no slicer installed
- Multicolor prints: up to 16 filament slots per print in the import
- Filament brands and materials catalog; printer brands, printer models and machine profiles
- Maintenance types can apply to several printer models or to specific printers
- Projects: multicolor column and filter, last print column and sort, 3MF filament colours in the 3D viewer
- Tables use server-side paging, sorting and column filters
- Server port and host set by a command-line flag, environment variable or in Settings (with a restart button)
- Custom app name, logo and favicon in Settings
- Integrations link in the sidebar; back links on detail, edit and login pages

### Changed
- Integrations page lists each integration's enabled state; a disabled card hides its sync and import options

### Fixed
- Spool low alerts show the spool name and refresh when the spool changes
- Projects: sliced plates are told apart; sliced exports are read; 3MF scan finds more files
- Bambu print history pages by offset (the API ignores the cursor)
- Printers page loads its translations and keeps the show-archived switch when no printer is active

## [1.0.0] - 2026-10-09

### Added
- Printers with timeline, comments, warranty and purchase details
- Maintenance tasks due by hours, prints or days
- Filament profiles, spools and low-spool alerts
- Projects from 3MF files, with thumbnails, tags and collections
- Prints with outcome, filament usage per AMS slot and energy
- Cost snapshots and stats by period
- Bambu Cloud integration: printers, print history and spools
- Scheduled online backups, restore, CSV and JSON export
- Optional `APP_PASSWORD` for access from other devices
- Light and dark themes, responsive layout, keyboard navigation

### Security
- Host check on incoming requests; optional password for remote access
- Raw settings API removed; `@fastify/static` updated
