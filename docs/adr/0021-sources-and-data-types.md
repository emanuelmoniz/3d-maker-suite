# ADR-0021: Sources and data types

- Status: Accepted (2026-11-10, Plan 5.5.0 Step 1, after the profile spike). Amends ADR-0014 (the connector opens the hub page, shared folders on the hub, picks replace sync mode, whole-disk `fs.list`, new operations), ADR-0016 (`machine.*` switches, a `presets` module), ADR-0017 and ADR-0019 (presets instead of profiles; a machine's Share and Install per preset kind) and ADR-0020 (a Presets module, where the device switches live, the device × slicer table).
- Date: 2026-11-10

## Context
Hub management, Integrations, Catalog and the connector each work, but a person who sets them up has to know which page holds which switch:

| What | Where today |
|---|---|
| When and how Bambu Cloud's printers, prints and spools sync | The account's card in Integrations ("What to import") |
| Whether a machine sends or installs a slicer's presets | Catalog → Sources, the device × slicer table |
| Whether a machine slices for the hub | Integrations, the slicer card's locations |
| Which projects a machine receives | Hub management → the device: sync mode all or selected, plus "Open" adding a project |
| Which of a machine's folders the hub sees | Only on the connector's own page, on that machine (`folders` in `state.json`); the hub never learns the list |
| The machine page itself | `hub.manage` only, so a workstation's own user can't change anything about it |

"Profile" (the catalog tables, the API paths) and "preset" (the slicers, the hub library) name the same thing. Bambu Studio, OrcaSlicer and PrusaSlicer all say preset.

## Decision

### Concepts
- **Software:** programs on the server or on a machine. Today the slicers (Bambu Studio, OrcaSlicer).
- **API:** an outside service that serves data. Bambu Cloud today; Spoolman and OrcaCloud later.
- **Machine:** a computer paired to the hub with the connector: a workstation, a file server, a print farm PC. The UI says machine; the code keeps `devices`.
- **Source:** any of the above, feeding the hub one or more data types. Several sources can feed one type.
- **Data type:** printers, prints, spools, catalog, presets, projects. Each can be kept by hand; sources are optional.

### A source allows, a data type configures
- A source only says **what it allows**, with one switch per data type, and the link to where that type is configured on the right of the switch:
  - an **account's card** (Integrations): Allow printers, prints, spools, user presets;
  - the **server's slicer card** (Integrations): Use as slicer;
  - a **machine's page** (Hub management): per slicer Use as slicer, Catalog Receive and Share, Presets Receive and Share; Receive projects and Share projects.
- **Every data type's settings page has two tabs: General** (today's settings) **and Sources.** Everything else about a source is set there: what it syncs, schedules, scope, merge, alerts, editor rights, picks, shared folders.
- **A Sources tab lists every source whose switch is on,** with nothing to add by hand. Turning the switch off on the card or the machine takes the source off the tab and keeps its data.
- **Two sections, by direction,** each shown only when the type has that direction:
  - **Share to the hub:** sources that feed the hub (accounts, the server's slicer, machines that share).
  - **Receive from the hub:** machines the hub sends the type to. Printers, prints and spools have no such section.
- **One block per source** in a section: its name (an account's email, a machine and its user) with a link back to the account or the machine. A machine's block is split by slicer where the type belongs to a slicer.
- **One line per item the source syncs,** each with its own switch: four catalog types, three preset kinds, a pick, a folder. A line's switch off is that type's policy at `off`; on again, the type's default mode (`defaultPolicy`). A line with a schedule shows when, what and how, and **Edit** opens its settings (today's `PolicyRow`). A line that only follows the files (a machine's presets) shows its state, with no Edit.

| Data type | Settings page | Share to the hub | Receive from the hub |
|---|---|---|---|
| Printers | `/printers/settings` | Accounts with Allow printers: one line | None |
| Prints | `/prints/settings` | Accounts with Allow prints: one line | None |
| Spools | `/filament/settings` (no longer a redirect) | Accounts with Allow spools: one line | None |
| Catalog (brands, models, materials) | `/catalog/settings` | Per library, the server's slicer and machines with Catalog Share: printer brands, printer models, filament brands, filament materials. Only the library's catalog source (ADR-0020) syncs; the others offer **Use as catalog source** | Machines with Catalog Receive, per slicer: the `system/` folder |
| Presets | `/presets/settings` | The server's slicer (system and user: printer, process, filament), accounts with Allow user presets (printer, process, filament), machines with Presets Share, per slicer (printer, process, filament); the zip upload | Machines with Presets Receive, per slicer: printer, process, filament |
| Projects | `/projects/settings` | Machines with Share projects: one line per shared folder, Add folder | Machines with Receive projects: one line per pick, Add pick |

### Where each schedule lives
Every schedule is on a line of a Sources tab, set with **Edit** (today's `PolicyRow` fields in a `FormDialog`). Nothing about when or how a sync runs stays on a card or a machine page.

| Line | Tab and section | When it runs | Other settings |
|---|---|---|---|
| Printers, prints, spools from an account | Printers / Prints / Filament settings, Share to the hub | Manual, or Auto with a frequency (15 min to monthly) and a time | What to sync, how to sync (printers, spools), new spools, track usage, alerts, editors |
| Printer brands, printer models, filament brands, filament materials from the catalog source | Catalog settings, Share to the hub | Manual, or Automatic when the files change (no frequency, ADR-0019) | What to sync, alerts, editors; Choose brands per library |
| System presets from the catalog source | Presets settings, Share to the hub | Manual, or Automatic when the files change | What to sync, alerts, editors; Choose brands per library |
| User presets from the server's slicer or folder | Presets settings, Share to the hub | Manual, or Automatic when the files change | What to sync, alerts, editors |
| User presets from an account | Presets settings, Share to the hub | Manual, or Auto with a frequency and a time | What to sync, alerts, editors |
| A machine's presets, per kind | Presets settings, both sections | Share on each save, Receive every 30 s (ADR-0017) | None |
| A machine's `system/` folder | Catalog settings, Receive from the hub | When the catalog source's fingerprint changes | None |
| Picks and shared folders | Projects settings, both sections | Live (ADR-0014) | A pick's users and roles |

**Choose brands** stays one control per library, because one brand fills catalog and system preset lines (ADR-0019). It sits on the catalog source's block in Catalog settings; Presets settings shows it read-only with a link.

### What stays in Integrations
- **Accounts:** one card per API (Bambu Cloud), one section per account, each with its Allow switches and their links.
- **The server's slicer:** one card per slicer library for the install that runs on the server (or on this PC without a hub): its folder or managed download, updates, **Use as slicer** (today's Slice here, renamed to match the machine page), the default slicer, the run log. Machines that run the same slicer aren't listed: they are set up on their own page. Without a server slicer the card isn't shown.

### Presets, not profiles
- The UI says **Printer presets, Process presets, Filament presets**. Code follows the slicer files' `type`: tables `machine_presets`, `process_presets`, `filament_presets`. `print` becomes `process` wherever it names a preset kind.
- The hub library (`slicer_presets`, ADR-0017) keeps its table name and is the **Preset library** in the UI.
- Old API paths, web URLs and catalog export names are accepted as aliases or redirects (Plan 5.5.0 Step 2).

### Catalog and Presets modules
- **Catalog** keeps brands, models and materials: a Printers tab (brands, models) and a Filament tab (brands, materials). Its Presets and Sources tabs leave.
- **Presets** is a new module (`/presets`): Printer, Process and Filament tabs, with the tables and preset pages that were in Catalog. Its settings have General, Sources and **Library** (today's Presets tab: versions, owners, conflicts, held deletes, Restore; hub on).
- A module permission **`presets`** (none · read · write · manage) takes from `catalog` what concerns presets. The migration copies each role's and user's `catalog` level.
- The sidebar's bottom block, top to bottom: **Hub management, Integrations, Catalog, Presets, Import | Export, Logs, Settings.**

### Machines
- **One slicer install per machine.** The server and each machine run a slicer once per library, installed (found by the connector or a typed path) or downloaded (managed, ADR-0013), never both.
- **Use as slicer is per slicer.** A machine slices for the hub with a slicer only when that slicer's Use as slicer is on. It is the worker integration row (machine + slicer) that exists today, so the data doesn't change; `devices.sliceWorker` stays derived from those rows.
- **Machine settings are edited on the hub,** on the machine page. The machine's own user sees its page. Editing a section needs that section's switch, on top of the right for the data itself:

  | Section | Switch | Also needs |
  |---|---|---|
  | Connection (port, start at login, Restart, Stop) | `machine.connection` | |
  | Slicers (Use as slicer per slicer, default slicer, installed or managed) | `machine.slicers` | |
  | Catalog Receive and Share per library | `machine.catalog` | `catalog` write |
  | Presets Receive and Share per library | `machine.presets` | `presets` write |
  | Projects Receive and Share, and that machine's shared folders in Projects settings → Sources | `machine.projects` | `projects` write |

  `hub.manage` edits every machine and every section. The built-in Editor and Viewer roles get none of the `machine.*` switches; Admin has them all. Pairing, Revoke and changing the machine's user stay `hub.manage` only.
- This reverses ADR-0020's rejection of per-device switches on the device page: that page needed `hub.manage`, and the `machine.*` switches remove that problem. The Catalog → Sources device × slicer table goes; its state (last sent, queue, last backup, held deletes) moves to the machine page's Slicers section.

### The connector opens the hub page
- **Paired:** the connector's start-menu or launcher entry opens the machine's page on the hub (`<hub URL>/hub/devices/<id>`).
- **Not paired:** the local pair screen, as today.
- **A slim local page stays** at `127.0.0.1:<port>`, for a hub that can't be reached and for what only works on the machine. It shows the machine, its user and the hub it is paired with, and offers: open the sync folder, held deletes (confirm or restore), Done editing, a change-user code, Restart, Stop, Unpair. Sync mode, default slicer and shared folders leave it.

### Shared folders are picked on the hub
- The machine page's **Share to the hub** switch (Projects) turns sharing on or off and links to Projects settings → Sources, where each sharing machine lists its folders, one line each with a switch that pauses it, **Add folder** and Remove.
- Add folder browses the machine's whole disk with the existing `PathPicker` (its device mode, which lists over the connector). It needs `hub.manage`, or the machine's own user with `machine.projects` and `projects` write.
- Each change asks for confirmation ("Share D:\Models with the hub?") and is logged with its actor.
- The hub stores the list (`devices.sharedFolders`) and pushes it to the connector, which keeps its copy in `state.json`. **The connector still refuses any path outside the saved list** for every file operation, so a compromised hub can read no further than what was shared. Only the directory listing reaches the whole disk.

### Projects from the hub, per pick
- A machine receives **picks**: a hub root, or a folder inside one (a project folder or a parent of several). This replaces `syncMode` all or selected.
- Each pick has a **users and roles list, each with Read or Edit.** A machine syncs a pick only if its user is on the list, directly or through their role, and never beyond that user's `projects` level and folder rights (ADR-0016). Read syncs read-only, as "download only" does today.
- The connector mirrors the picked paths: `root1/*`, `root2/project2`. The hub already filters the change feed per device (`/sync/changes`); it filters by picks instead of `device_projects`.
- **Open** on a project that isn't synced on that machine adds a pick for its folder, with the machine's user at Edit, as it adds a `device_projects` row today.
- Picks are edited in Projects settings → Sources, one line each with a switch that pauses it, with `hub.manage` or `projects` manage. The machine page's **Receive from the hub** switch shows "3 picks" and links there.
- New machines: `hubDefaultSyncMode` becomes **New machines receive**: every hub root (one pick per hub root, the machine's user at Edit) or nothing until picked.

### Catalog to a machine
A machine with **Receive catalog** on for a library gets the hub's copy of that library's `system/` folder (the catalog source's, ADR-0020), so every slicer of that library has the same vendor presets. It follows the fingerprint: sent only when the hub's copy changed, written only while the slicer is closed (ADR-0017's queue), with a backup of the folder first.

### Data model
| What | Where |
|---|---|
| Allow switches | `integrations.config.allow`: `{ printers?, prints?, spools?, userPresets? }`, booleans; missing means on. `userPresets` covers the three user preset types. Turning one off sets those types' policies to `off` and keeps the data |
| A source on a data type | Listed while its switch (Allow, Use as slicer, a machine's Share or Receive) is on. Each line that has a schedule is the existing `sync_policies` row; its switch is `mode` `off` or not. No new table |
| Use as slicer | The worker integration row per machine and slicer, as today. `devices.sliceWorker` stays derived |
| Machine features | New on `devices`: `receiveProjects` (boolean), `shareProjects` (boolean), `sharedFolders` (json, null until first reported) |
| Per library on a machine | `devices.presetLibraries[library]` becomes `{ catalog: { receive, share }, presets: { receive, share, receiveKinds, shareKinds }, sentAt? }`; the kinds are the lines' switches (`machine`, `process`, `filament`), all three by default |
| Picks and shared folders paused | `device_picks.paused`; `devices.sharedFolders` holds `{ path, paused }` |
| Picks | `device_picks` (id, deviceId → devices, rootId → roots, path: `""` = the whole root; unique per device, root and path) and `device_pick_access` (pickId → device_picks, userId → users or roleId → roles, exactly one; level `read` · `edit`) |
| Permissions | On/off `machine.connection`, `machine.slicers`, `machine.catalog`, `machine.presets`, `machine.projects`; module `presets` (none · read · write · manage) |
| Account profile | `integrations.config` gains `email`, `name`, `avatarUrl` (Spike results); the avatar is fetched and cached by the server |

### Each existing switch's new place and its migration
| Today | Becomes | Migration |
|---|---|---|
| Worker integration rows (`devices.sliceWorker` derived) | Machine page → Slicers: Use as slicer, per slicer | None |
| `presetLibraries[lib].send` | Machine page → Slicers: Presets Share; its kinds in Presets settings | `presets.share = send`, all three kinds |
| `presetLibraries[lib].install` | Machine page → Slicers: Presets Receive; its kinds in Presets settings | `presets.receive = install`, all three kinds |
| The library's catalog source (`catalogSources` setting) | Stays in Catalog settings → Sources; a machine can be picked only with Catalog Share on | The source machine gets `catalog.share` on; `catalog.receive` starts off |
| `devices.syncMode = all` | Picks | One pick per hub root (`path ""`), the machine's user at Edit |
| `devices.syncMode = selected` + `device_projects` | Picks | One pick per row: the project's root and folder, the machine's user at Edit. `device_projects` and `syncMode` are dropped |
| Edit as the pick level | | Behaviour doesn't change: the user's `projects` level and folder rights cap it, as they cap the sync today |
| (new) `receiveProjects` | Machine page → Projects | On for every existing machine: each one syncs something today |
| Connector `state.json` `folders` | Projects settings → Sources: the machine's shared folders | On its first connect after the update the connector sends its list (`PUT /api/hub/device/folders`), stored only while `sharedFolders` is null. From then on the hub's list wins. `shareProjects` = list not empty |
| `hubDefaultSyncMode` | Hub settings: New machines receive | `all` → every hub root, `selected` → nothing |
| Cloud policy rows (printers, prints, spools, user presets) | That data type's Sources tab, one line each | Rows don't change. `allow[type]` = the type's effective mode is not `off`. No row or code path writes `off` for these types today, so every account starts allowing every type it can feed |
| Integrations card "What to import" (`Policies part="connection"`) | Gone; Allow switches on the card, settings in the Sources tabs | |
| The slicer card's Slice here and its locations | Use as slicer on the server's card; machines on their own page | The label changes; no data |
| Catalog → Sources (catalog source, import cards, device × slicer table, zip) | Catalog settings → Sources and Presets settings → Sources; the table's switches on the machine pages | |

Every migration that edits `schema.ts` runs after a DB backup, as every schema step does.

### Wireframes
Structure only. The pages use the app's existing components and nothing new: `PageHeader` (title, description, actions, `SettingsLink`), `Section` (a titled block with an optional link on the right), `Switch`, `Button` (primary, secondary, danger), `DataTable` for every list of lines, the status badge of `RootStateBadge`, `EmptyState`, `FormDialog`, `ConfirmDialog`, `PathPicker`, the row `Menu` (`⋯`), and the `Tabs` of Plan 5.5.0 Step 3. `[x]` / `[ ]` are switches, `[Name]` buttons, `→ …` links on the right. A preview in the app's theme was shared for review; it isn't kept.

**1. Machine page** (`/hub/devices/:id`; the connector's icon opens it)
```
← Hub management
WS-3                                                          (Online)
Ana Silva · Windows 11 · connector 5.5.0

Connection                                          (machine.connection)
  Port 4301   [x] Start at login                       [Restart] [Stop]

Slicers                                                (machine.slicers)
  Default slicer: [Bambu Studio ▾]
  Bambu Studio 02.09.01.70 · installed
    [x] Use as slicer
    Catalog   [ ] Receive  [x] Share                   → Catalog settings
    Presets   [x] Receive  [x] Share                   → Presets settings
  OrcaSlicer 2.5.0 · installed
    [ ] Use as slicer
    Catalog   [ ] Receive  [ ] Share                   → Catalog settings
    Presets   [ ] Receive  [ ] Share                   → Presets settings

Projects                                              (machine.projects)
  [x] Receive from the hub     3 picks                 → Projects settings
  [x] Share to the hub         2 folders               → Projects settings

[Revoke]                                               (hub.manage only)
```
A section the viewer can't edit shows its values as text, without switches. A machine that is offline shows its last values with "Offline: changes apply when it reconnects."

**2. Integrations**
```
Bambu Cloud                                        [Add another account]
  (AS)  Ana Silva                         (Signed in) [Test connection]
        ana@example.com · Global
        Allow   [x] Printers                           → Printers settings
                [x] Prints                             → Prints settings
                [x] Spools                             → Filament settings
                [ ] User presets
  (WA)  Workshop account                (Signed out) [Sign in again]
        workshop@example.com · Global
        Allow   [x] Printers                           → Printers settings

Bambu Studio
  This server · managed 02.09.01.70                    (Ready) [Update]
  [x] Use as slicer
```
`(AS)` is the account's photo, else its initials. A type turned off shows no link. Turning one off asks: "Stop syncing spools from this account? The spools already imported stay."

**3. Printers settings → Sources** (Prints and Filament look the same: one section, one line per account)
```
Printers settings
  General | Sources

Share to the hub
  Bambu Cloud · ana@example.com                                → Account
    Item        On   When                       What        How
    Printers    [x]  Auto, every day at 03:00   Everything  Let me review   [Edit] [⋯]
  Bambu Cloud · workshop@example.com                           → Account
    Printers    [ ]  Off                                                    [Edit]
```
`[⋯]` holds Sync now, Review and import (with its count) and the sync log. With no account allowing printers: the `EmptyState` "No sources. Printers here are added by hand. To sync them from an account, allow printers on it in Integrations." [Go to Integrations].

**Edit** (a `FormDialog` with today's `PolicyRow` fields):
```
Printers from ana@example.com
  When it runs   (•) Auto  ( ) Manual
                 Frequency [Every day ▾]   Time [03:00]
                 In the server's time zone.
  What to sync   (•) Everything  ( ) Only what I already have
  How to sync    ( ) Overwrite with the source  ( ) Keep my edits  (•) Let me review the changes
  Alerts         [x] Error  [x] Review  [ ] Success
  Editors        [x] Can sync now  [ ] Can review and import
                                                       [Cancel] [Save]
```
Spools add New spools and Track usage; prints add Track usage.

**4. Catalog settings → Sources**
```
Catalog settings
  General | Sources

Share to the hub
  This server                                          → Integrations
    Bambu Studio          (Catalog source)                [Choose brands]
      Item                On   When                             What
      Printer brands      [x]  Automatic when the files change  Only mine    [Edit] [⋯]
      Printer models      [x]  Automatic when the files change  Only mine    [Edit] [⋯]
      Filament brands     [x]  Manual                           Everything   [Edit] [⋯]
      Filament materials  [ ]  Off                                           [Edit]
  WS-3 · Ana Silva                                          → Machine
    Bambu Studio                                 [Use as catalog source]
      Not the catalog source: its catalog isn't read.

Receive from the hub
  FARM-1 · Print farm                                       → Machine
    Bambu Studio
      system/ folder      [x]  Received 9 Nov, profiles 02.09.00.74
```

**5. Presets settings → Sources**
```
Presets settings
  General | Sources | Library

Share to the hub
  This server                                          → Integrations
    Bambu Studio          (Catalog source)     Choose brands → Catalog settings
      Item                       On   When
      System printer presets     [x]  Automatic when the files change        [Edit] [⋯]
      System process presets     [x]  Automatic when the files change        [Edit] [⋯]
      System filament presets    [x]  Automatic when the files change        [Edit] [⋯]
      User printer presets       [x]  Automatic when the files change        [Edit] [⋯]
      User process presets       [x]  Automatic when the files change        [Edit] [⋯]
      User filament presets      [x]  Automatic when the files change        [Edit] [⋯]
  Bambu Cloud · ana@example.com                                → Account
    Bambu Studio
      User printer presets       [ ]  Off                                    [Edit]
      User process presets       [ ]  Off                                    [Edit]
      User filament presets      [x]  Auto, every day                        [Edit] [⋯]
  WS-3 · Ana Silva                                          → Machine
    Bambu Studio
      Printer presets            [x]  On each save · last sent 10:42
      Process presets            [x]  On each save
      Filament presets           [x]  On each save · 2 waiting
    OrcaSlicer
      Filament presets           [x]  On each save
  No connector? [Upload a zip]

Receive from the hub
  WS-3 · Ana Silva                                          → Machine
    Bambu Studio
      Printer presets            [x]  Up to date · backup 09:15
      Process presets            [x]  Up to date
      Filament presets           [ ]  Off
  FARM-1 · Print farm                                       → Machine
    Bambu Studio
      Printer presets            [x]  2 waiting for the slicer to close
      ...
```

**6. Projects settings → Sources**
```
Projects settings
  General | Sources

Share to the hub
  WS-3 · Ana Silva                                          → Machine
    Folder        On   Root
    D:\Models     [x]  Models (WS-3)                                    [⋯]
    E:\Clients    [x]  Clients (WS-3)                                   [⋯]
    [Add folder]

Receive from the hub
  WS-3 · Ana Silva                                          → Machine
    Pick                  On   Who
    Models (whole root)   [x]  Ana Silva: Edit · Designers: Read   [Edit] [⋯]
    Clients / Acme        [x]  Ana Silva: Edit                     [Edit] [⋯]
    [Add pick]
```
A folder's or a pick's switch pauses it; `⋯` holds Remove. Add pick: root, folder (optional, `PathPicker` inside the root), users and roles each with Read or Edit; "WS-3 syncs a pick only when Ana Silva is on its list." Add folder: `PathPicker` on WS-3's whole disk, then the `ConfirmDialog` "Share D:\Models\Prototypes with the hub? Its projects become visible to the people who can see WS-3's projects." [Share].

**7. Presets module** (`/presets`)
```
Presets                                                            [⚙]
  Printer | Process | Filament

  [Search…] [Slicer ▾] [Printer ▾] [Source ▾] [In use ▾]
  Name                        Source                  Owner      Used by
  Bambu PLA Basic @BBL X1C    Bambu Studio (system)   –          12 plates
  PLA Matte fast              Bambu Studio (user)     Ana Silva  3 plates
```
The list is a `DataTable` with the `FilterBar`, as the Catalog tables are today. A row opens the preset page (today's profile page with All settings). Settings: General | Sources | Library (hub on).

**8. Connector local page** (`127.0.0.1:4301`)
Paired, hub reachable:
```
3D Maker Suite connector                                      (Online)
  WS-3 · Ana Silva · paired with hub.example.com
  [Open on the hub]
  Sync folder  C:\Users\ana\3D Maker Suite                   [Open folder]
  Held deletes: 24 files in Models              [Delete them] [Restore]
  Editing Benchy.3mf                                        [Done editing]
  [Get a change-user code]      [Restart] [Stop] [Unpair]
```
Hub not reachable: the same, with "Can't reach hub.example.com. Files sync again when it's back." in place of Open on the hub.
Not paired: today's pair screen (hub URL, pairing code, [Pair]).

## Rejected options
- **Sync settings on the account card** (today). The same data type is then configured on as many cards as it has sources, and the type's own page can't show what feeds it.
- **Adding a source by hand on the Sources tab** (Add source, Remove). The switch on the card or the machine already says the source may feed the type; a second step to add it would be one more place to look.
- **Picks or shared folders set on the machine page.** Projects would be configured in two places; the Sources tab shows every machine's picks and folders side by side, which is what an admin compares.
- **A new `sources` table.** A source on a type is exactly a `sync_policies` row; a second table would need keeping in step with it.
- **One Use as slicer per machine.** A workstation may slice for the hub with Bambu Studio and keep OrcaSlicer to itself; the worker rows are already per slicer.
- **Device switches only in Catalog → Sources** (ADR-0020). They are a machine's features, and the `machine.*` switches solve the `hub.manage` problem that put them there.
- **Removing the slicer card from Integrations.** A single PC or a hub with its own slicer has no machine page to set it up on.
- **A machine's presets all or nothing** (ADR-0017, ADR-0019). A farm PC may need filament presets only; the connector already handles each kind's folder apart.
- **Shared folders kept only on the connector.** An admin can't see or change what a machine shares without sitting at it. The connector's own check on the saved list keeps the safety that motivated it.
- **Keeping `syncMode` all or selected.** Neither gives a folder of projects, and neither says who on a shared machine may see what.
- **Picks per user instead of per machine.** A farm PC with a service user and a shared workstation need different things from one user.
- **Profiles as the code name.** Every slicer says preset, and keeping two names for one thing is how the overlap started.
- **Two slicer installs of one library on a machine** (an installed one and a managed one). They hold two copies of the user presets, and which one Share reads would be a guess.
- **`design-user-service/my/preference` for the account profile.** It has the name and the avatar but no email, plus MakerWorld settings, birthday and country the app has no use for.

## Consequences
- Integrations keeps accounts and the server's slicer. Catalog → Sources and the device × slicer table go.
- Plan 5.5.0 Steps 2–19 build this: presets naming (2), settings tabs (3), the Presets module (4), accounts (5), Sources tabs (6), then machines, picks and the connector.
- The adapter interface gains an optional profile read (email, name, avatar URL), so other APIs can fill the account card the same way (Step 5).
- The connector's `fs.list` lists the whole disk (directories only) for Add folder, and its fixed operations gain `connector.stop`, `catalog.install` (write the hub's `system/` copy) and `folders.set` (the saved list from the hub). ADR-0014 is amended.
- Old URLs, API paths and catalog export names keep working through redirects and aliases.

## Risks
- **Whole-disk browsing is a new reach** for a hub account. It lists directories only, live, with `hub.manage` or the machine's own user with `machine.projects`, and each share is confirmed and logged. Reading files still needs the folder on the saved list.
- **Receive catalog writes into a slicer's `system/` folder.** ADR-0019 saw Studio recopy `system/BBL` at start when its version looked wrong. A copy from a newer slicer version may be replaced at start, or may not load in an older program. The step that builds it has to test both directions and refuse a version the slicer can't load. Resolved in 5.5.0 Step 11: the hub sends the copy only to a slicer of the same major.minor version as the source's (either unknown: it sends), and the connector lays the copy over `system/` without deleting anything.
- **The folder migration trusts the connector once.** A connector that never connects after the update keeps sharing its local list until it does, and the hub shows "not reported yet".
- **Picks with roles change who a machine syncs for** when a user's role changes. The feed is computed per request, so a change applies on the next sync, and files the user may no longer see are removed from the machine like an unselected project today (not a delete).
- **The profile endpoint is undocumented,** like the rest of the Bambu Cloud API. A failed read keeps the last values and never fails a sync. The avatar's host is a CDN outside `api.bambulab.com`, which the server has to be allowed to reach.

## Spike results (2026-11-10)
Read with the app's stored token (`data/app.sqlite`, Global region), `GET` only, plain `fetch` with `authorization: Bearer` as `cloud.ts` sends it. Values were not recorded. China not tested.

`GET /v1/user-service/my/profile` → 200 `application/json`:

| Field | Type | Use |
|---|---|---|
| `uid` | number | Account id; `uidStr` is the same as a string (10 chars) |
| `account` | string, the email address | Email on the card |
| `name` | string | Display name on the card |
| `avatar` | URL on `public-cdn.bblmw.com` | Photo, fetched and cached by the server |
| `fanCount`, `followCount`, `likeCount`, `collectionCount`, `downloadCount`, `identifier`, `point`, `certificated`, `productModels`, `personal` (bio, links, print totals, MakerWorld designs, level), `MWCount`, `setting`, `bannedPermission`, `tpModelAccounts`, `defaultLicense`, `isNSFWShown`, `myLikeCount`, `favoritesCount` | various | Not used: MakerWorld and social data |

The profile has no region; the card keeps the region from the integration's config.

`GET /v1/design-user-service/my/preference` → 200, for comparison: `uid`, `name`, `handle`, `avatar` (same host), `bio`, links, about 120 notification and privacy switches, `country`, `birthday`, `gender`, `deviceNames`. No email. Rejected above.

## Sources (checked 2026-11-10)
- OpenBambuAPI, [cloud-http.md](https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md): `GET /v1/user-service/my/profile`, `GET /v1/design-user-service/my/preference`.
- Bambu Studio, OrcaSlicer and PrusaSlicer: user-facing "preset" and the files' `type` (`machine`, `process`, `filament`).
