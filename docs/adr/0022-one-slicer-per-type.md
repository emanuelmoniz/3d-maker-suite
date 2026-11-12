# ADR-0022: One slicer per slicer type

- Status: Accepted (2026-11-11, design discussion after Plan 5.5.0 Step 11). Amends ADR-0019 (a slicer's catalog and system presets default to Automatic), ADR-0020 (the catalog source is no longer a pick: it is the hub's slicer) and ADR-0021 (Catalog Share goes; a machine's Catalog and Presets switches become Use as slicer, Catalog and system presets, and User presets; a Sources tab's sources are cards). ADR-0014's `catalog.sources` and `catalog.install` stay. Extended after the Step 11d review (2026-11-11): *Sources and defaults* below. Amended by ADR-0023: one Catalog module (no Presets page), one Sources tab, a receiver's System and User presets switches. Amended 2026-11-12 (ADR-0021's amendment): Use as slicer goes; every enabled machine install is an option.
- Date: 2026-11-11

## Context
After Plan 5.5.0 Step 11 a person who sets up a slicer meets four separate ideas:

| Idea | Where |
|---|---|
| Which install slices a project or plate | A picker per project and plate, the default slicer, else the oldest install that can |
| Whether a machine slices for the hub | Use as slicer on the machine page (the worker row's slice policy) |
| Where the catalog comes from | Catalog → Sources: Use as catalog source, among the machines with Catalog Share on |
| Why a machine can't be the source | "Machines aren't offered: this server reads this slicer's catalog…" when the server has its own install |

So one library can slice on three installs while a fourth feeds the catalog, and the screens can't say simply which catalog a slice uses. The catalog (brands, printer models, filament brands and materials) and the system presets are read from the same `system/` folder, yet they have different switches. What a machine shares under "Presets" is only ever its user presets.

## Decision

### The hub's slicer
- Per slicer type (library: Bambu Studio, OrcaSlicer) exactly one install is **the hub's slicer**: the server's install (a folder on this computer or a managed slicer) or one machine's worker install. It is picked in one place, the slicer type's card in Integrations, and kept in the `hubSlicers` setting (`{ [library]: integrationId }`).
- Only the hub's slicer slices. A project's, plate's or quote's slicer pick names a slicer **type**; the existing `slicerIntegrationId` columns are read as "that row's library", so no data changes. When the hub's slicer is a machine that's offline, its jobs wait; there is no fallback to another install.
- Other installs stay (installed, updatable, removable) but don't slice and don't feed anything.

### Catalog and system presets: one source
- The hub's slicer is the only source of the library's catalog and system presets. A machine sends its `system/` as the catalog source did (ADR-0020, `catalog.sources`); the server's install is read in place.
- They are one thing everywhere: one folder, one source, one switch. Every other machine with that slicer, and the server's own install when it isn't the hub's slicer, can **Receive** them (`catalog.install`, Plan 5.5.0 Step 11): written only while the slicer is closed, after a backup, only to the same major.minor version. Nothing else shares them.
- Gone: the catalog source pick (`catalogSources` setting, `PUT /api/catalog/sources/:library`), Catalog Share (`presetLibraries[lib].catalog.share`), and the rule that keeps machines out when the server has an install (`devicesBlocked`).

### User presets
- Unchanged: per machine and per kind, **Share** and **Receive** (ADR-0017, ADR-0021). The server's come from accounts and zips.

### A machine's switches per slicer
- `presetLibraries[lib]` becomes `{ slicer, system: { receive }, user: { receive, share, receiveKinds, shareKinds }, sentAt? }`.
- **Use as slicer** (`slicer`): the machine offers this slicer to the hub. Only an offered slicer shows as a choice for the hub's slicer in Integrations. It is the machine user's consent (`machine.slicers`); the admin picks.
- **Catalog and system presets** (`system.receive`): Receive only. Off and locked on the hub's slicer ("its own are the hub's").
- **User presets** (`user`): Receive and Share, per kind on Presets → Settings → Sources.
- The connector still sees only `presetSwitches` (send, install) and the `catalog.*` maps, so a connector of 5.5.0-alpha.1 needs nothing new.

### Where things are
- **Integrations, one card per slicer type:** the hub's slicer as a radio over the server's install and each machine that offers it; each install's setup, update and removal (`WorkerSlicer` moves back here from the machine page); Choose brands and the Catalog, System presets and User presets cards. Picking another version asks first: the catalog changes and every receiver gets the new one.
- **Machine page → Slicers:** the three rows above, each with a link to its settings.
- **Catalog → Settings → Sources** and **Presets → Settings → Sources:** **Source**, one read-only line per slicer type (the hub's slicer, "Change in Integrations") with the catalog's four lines and Choose brands; **Receive from the hub**, every machine with the slicer and This server, each with its switch and its `system/` state. Presets also lists **User presets** Share and Receive per machine, as today.

### Sources and defaults (Step 11d review)
- **Integrations:** the hub's slicer sits on a panel of its own at the top of its type's card, with **Change the hub's slicer…** (only the installs that can be picked). The installs follow under **Installs**, the hub's slicer's with a badge. The slicer installed on the server's computer is **This server**, with the server icon, like a downloaded one; a machine's is its name. "Use this program" picks the program an install runs, never the hub's slicer.
- **Share to the hub shows only what is shared.** Catalog: per slicer type, only the hub's slicer (this server's or one machine's); other installs share nothing to the catalog and aren't listed. Presets: system preset lines only on the hub's slicer; user preset lines on every source that shares them (this server, an account, a machine with User presets Share). A machine that shares nothing isn't listed.
- **One table per source and slicer**, the same columns everywhere: Item, On, When, What. On a machine's user preset lines, **On** is whether the machine sends that kind (`shareKinds`), and **When** is the hub's import of it like any line, or Off while it isn't sent. The separate kinds table goes.
- **When:** only an account's lines have a schedule. A slicer's lines follow its files: *Automatic when the files change*, or Manual, shown as *When the files change, after your review*. Every slicer line, the catalog and system presets too, starts Automatic (migration 0116 turns Manual ones Automatic). Choose brands' *Only what I already have* keeps a vendor update to the rows you have.
- **Cards:** each source of a Sources tab (this server, an account, a machine, the zip) is a card, closed at first, with its icon as on Integrations (an account's photo). One opened is remembered per page in the browser; a link into it opens it.
- **A machine that is the hub's slicer** receives no catalog and no system presets (its own are the hub's); it can receive user presets, per kind.
- **Its presets to slice with:** the hub's copy of a machine's `system/` becomes that install's preset folder, as a zip's does, so the hub's slicer on a machine slices without a zip.

## Consequences
- One answer to "which catalog does this slice use": the hub's slicer's.
- Migration, per library: the hub's slicer is the current catalog source's row (a device source: its worker row), else the default slicer if it is that library, else the oldest row that can slice. `catalog.share` becomes `slicer` on machines whose worker row was slicing; `catalog.receive` becomes `system.receive`; `presets` becomes `user`.
- Two machines can no longer slice the same slicer type side by side. The slice queue was one FIFO already, so nothing ran in parallel; the "Slice on the server instead" fallback goes.
- A switch of the hub's slicer between versions raises the catalog change alert, re-sends to receivers and marks plates sliced with the old version, as a slicer update does.
- `PATCH /api/integrations/:id` checks `slicer_exists` when a worker's machine changes.
- A machine's managed install keeps its system presets in the install (`<slicers>/<id>/<version>/resources/profiles`), not in the desktop config folder `configDirOf` gives. The hub sends that folder with `catalog.sources` (`dirs`, and `X-Catalog-Dirs` on connect), and names every library a machine is the source of, not only its found slicers'.
- This server's own install (a folder on this computer) that isn't the hub's slicer receives the catalog like a machine (`integrations.catalogReceive`); the process check and the overlay write are shared in `packages/host`.
