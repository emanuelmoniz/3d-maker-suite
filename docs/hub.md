# Hub and connector

> **Status: 5.0.0.** Stable. Tested on a VPS behind Caddy, a NAS in Docker and Windows, macOS and Linux workstations. Back up before updating.

A **hub** is the normal server with hub features switched on. Workstations, a NAS or a file server join it by running a small **connector**. People still work only in the web app. Design and decisions: [ADR-0014](adr/0014-hub-and-connector.md).

With the switch off, nothing changes.

## Turn the hub on

1. Set up user accounts first ([users.md](users.md)): every device acts as a user.
2. As an admin, go to **Settings → General** and turn on **Hub** (below **User accounts**, which must be on).
3. **Hub management** appears in the menu next to Integrations (admins only). It lists the devices: name, user, OS, connector version, and online or last seen. Its **Settings** page holds the sync, lock and version settings.

If the hub is switched off again, connectors show "The hub is turned off on this server" and keep their pairing.

## Pair a device

Only admins pair devices.

1. In **Hub management**, choose **Pair a device**, pick the user the device will act as, and copy the pairing code. It works once, for 10 minutes, and is shown once.
2. On the device, install the connector (below) and open it from the start menu or app menu (or <http://127.0.0.1:4301>). Not paired yet, it shows the pair screen.
3. Enter the hub's address (the one you open the web app at), the code and a device name, then **Pair**.
4. The device shows **Online** in Hub management, and the browser goes on to its machine page on the hub.

**Hub management** lists the devices in a table, as the other lists: name, status (online or offline, with when it was last seen, and whether its connector is outdated), user, base OS (Windows, Linux or macOS) and connector version. Each column sorts and filters. Tick devices to **Restart** their connectors (online ones only) or **Revoke** them together (it asks first); the ones that couldn't stay ticked.

The hub stores only a hash of the device token. On a device's page you can **Rename** it or **Revoke** it: a revoked device loses access at once, its local files stay on its disk, and it needs a new code to join again. The connector connects out to the hub, so devices need no open ports and no VPN. It works behind Caddy, nginx and Traefik with default settings: the hub marks its event stream as unbuffered and sends a heartbeat every 15 seconds.

## Machine page

Each device in **Hub management** opens its machine page. It has every setting of that machine:

- **Actions**, at the top: **Restart connector**, **Stop connector** and **Revoke**.
- **Identity**: its name and user. **Software**: the OS and connector version, and **Update now** when it's outdated.
- **Connection**: the local page port and start at login, read live from the connector.
- **Slicers**: the slicers on the machine, the ones the connector found and the ones the hub installed, each with its version and *Server's slicer* on the one picked in Integrations ([ADR-0022](adr/0022-one-slicer-per-type.md)). The section has no switches: every slicer on the machine is listed on **Catalog → Settings → Sources**, where its System and User presets are set ([Slicer presets](#slicer-presets), [Receive catalog](#receive-catalog)). **Sync sources configurations** links there. With Integrations manage, a link opens Integrations, where a slicer is installed on the machine ([Slice workers](#slice-workers)). With no slicer on the machine, the section has only that link.
- **Projects**: **Receive from server** (with its number of picks and its sync state, such as *Up to date · 120 files*, below) and **Share to server** (its number of shared folders, and *Up to date* while it is online, below). **Sync sources configurations** opens Projects settings → Sources, where both are set up.

Opened in a browser on that machine, the page also links to the connector's [local page](#install-the-connector).

**Manage the hub** changes everything on every machine. The machine's own user changes a section with its switch:

| Section | Switch | Also needs |
|---|---|---|
| Connection, Restart, Stop | **Connection** | |
| System presets Receive, User presets Receive and Share (on **Catalog → Settings → Sources**) | **Catalog** | Catalog write |
| Projects Receive and Share | **Projects** | Projects write |

Identity, Update now and Revoke stay with **Manage the hub**.

The machine's own user sees its page even without a switch, with each value as text. A machine paired to someone else shows as not found. The switches are in [users.md](users.md#permissions).

The port, start at login, Restart and Stop need the connector online. The other switches are kept on the hub and apply when it reconnects. A connector older than 5.5.0 says it's too old for Stop and Share to server; it updates itself to the hub's version when it connects.

### Change a connector's user

The local page and the device's card in Hub management show the user a connector acts as. To change it without pairing again:

1. In **Hub management**, open the connector's edit page, choose **Change user**, pick the user and copy the code. It works once, for 10 minutes, only on this connector, and is shown once. Nothing changes yet.
2. On the connector's local page, choose **Change user** and enter the code. The hub has to be online. After 5 wrong codes, wait 15 minutes.
3. Choose what happens to the projects in this connector's folders: **Move to the new user**, or **Stay with their owner**. An owner who stays may no longer be able to edit them, and the new user may not see them. Then confirm.

The connector keeps its identity, roots and settings, and acts with the new user's rights from then on. Projects in hub roots aren't affected. The change is written to the log.

## Device project folders

A project folder can live on a paired device instead of the server.

1. Share the folder first, in **Projects settings → Sources** ([below](#shared-folders-on-a-device)).
2. In **Projects settings**, under Project folders, choose **Browse…**. Pick the source, **This server** or an online machine with a shared folder, then the folder: on a machine, only its active shared folders and what is inside them. A machine browse goes through the connector; the picker says why it failed (offline, no answer, or a connector that is too old).
3. The connector watches the folder, waits until a project folder's files stop changing, and sends the hub its scan and the 3MF details. On every connect it checks what changed. The projects use the same page as any other project.

The hub fetches a file only when it needs it: slicing, auto slicing, a download or the 3D view. It asks the connector, checks the file's hash and keeps it in a temporary cache (1 hour, 10 GB at most). Creating a project folder and moving one to the trash run on the device.

### Offline

While a device is offline, its roots and projects show **Offline** with the last known data. Plate previews, the cover and the gallery picks the device sent still show. Other images, files and any write wait for the device: a change to the cover or gallery is sent on its next connect.

### Plate previews and gallery

The scan carries the plate previews of each 3MF, so a project page doesn't download the whole file. A device project's cover and gallery can be picked as on the server. Offline, the picker offers only the picks the hub already holds, and the project page says how many the device didn't send.

**Settings → Projects → Device folder size limit** (default 32 MB, up to 128 MB) caps what one folder's scan sends: descriptions first, then the cover, plate previews and gallery picks. What doesn't fit is left out, so plate previews go first. Changing it sends the folders again.

## Server project folders: sync with devices

A project folder on **This server** is a server folder. Each device keeps a copy of it in its sync folder (`<home>/3D Maker Suite/<root>`) and the two stay in step both ways: save in your slicer as usual and the hub gets the change; a change made on the hub or another device arrives on its own. Files download to a hidden temporary file, are hash-checked and then renamed into place, so a half-copied file never shows. Files the root marks download-only are read-only on the device. The device's local page shows the sync state and how many changes wait.

A restarted connector downloads nothing it already has.

### Which projects a device syncs

A device syncs hub projects while **Receive from server** is on, on its [machine page](#machine-page), and only its **picks** ([ADR-0021](adr/0021-sources-and-data-types.md)). Turning Receive off removes its copies of hub projects from the device; nothing is deleted on the hub. The machine page shows how many picks it has and links to them.

Picks are set in **Projects settings → Sources → Receive from server**: a card per machine with Receive on, one line per pick.

- A pick is a project folder on this server (the whole folder) or a folder inside it, a project or a parent of several. The device mirrors it under its sync folder: `Models/…` for a whole folder, `Clients/Acme/…` for a folder inside one.
- Each pick is at **Read** or **Edit**. Read syncs the files read-only on the device; Edit lets its saves go back to the hub. Where two picks cover a file, Edit wins. The device's user's own rights still cap it: projects they can't see stay off the device, and files they may only download stay read-only.
- **Add pick** asks for the project folder, optionally a folder inside it, and the level (Edit to start). **Edit** changes the level. A line's switch pauses the pick; **⋯ → Remove** removes it. Either way its files leave the device, except files changed there that the hub doesn't have yet. Nothing on the hub is deleted.
- It takes `hub.manage` or Projects at Manage, on a machine you can see. Each change is in the log.
- **Hub management → Settings → New machines receive**: **Every project folder** (a pick per project folder on this server, at Edit) or **Nothing until picked** (the default).
- Upgrading to 5.5.0 keeps what each device synced: *Everything* became a pick per project folder, *Selected projects* a pick per selected project, each at Edit.
- The picks belong to the device. **Change user** keeps them, and the new user's rights apply from the next sync: files that user can't see leave the device, files they may only download turn read-only.

### No locks: conflicts and "Last saved by"

There are no locks: anyone may edit a hub file on any device at once. Two saves of the same file never overwrite each other; the later one becomes a conflict copy (see [Conflicts](#conflicts)). 5.6.0 removed the check-out locks of earlier versions: upgrading clears them, and files that were read-only on a device only because of a lock turn writable at its next sync. Files stay read-only where it's a right: a pick at **Read**, or a file the user may only download.

Each file on the project page shows **Last saved by `<user>` on `<device>`, `<time ago>`**, information only:

- **Hub root:** the last save that reached the hub, from a device's sync or an upload in the browser ("in the browser" then).
- **Device root:** the device's user and the device, at the time the device's last scan saw the file change.

It's hidden when unknown, for example for a file changed directly on the hub's disk.

### Versions

**Hub management → Settings → Keep earlier versions of files** (default off). When on, a save from a device that replaces a hub file keeps the old content as a version, and the newest **N** (default 5, up to 100) are kept per file.

- The project page lists a file's versions (number, user, device, date, size), each with **Download**.
- Only saves that reach the hub from a device are kept. A change made on the hub's own disk is not.
- Lowering N deletes the older versions at once. Turning versions off stops keeping new ones and leaves the existing ones.
- **Disk use.** Versions are stored in `<data folder>/versions`, outside your project roots, and Settings shows the space they use. A big 3MF saved often costs N copies of itself, so choose N with the disk in mind.
- **Backups** include `versions/`, so they grow with it. The backup list marks the ones that include file versions ([backups.md](backups.md)).

### Conflicts

If a device uploads a file that changed on the hub or on another device since it last synced, nobody's work is overwritten. The hub keeps the newer version at the original name and the late one beside it as `<name> (conflict <device> <date>).<ext>`, and raises a **Sync conflict** alert that links to the project. Pick the version you want and delete the other.

### Deleting and the trash

A file deleted on a device moves to the root's trash on the hub, never a hard delete, and only when the hub has no newer version of it.

**Mass delete guard.** When a device deletes more files from one hub root at once than the limit (**Hub management → Settings → Sync**, default 20), or a root's folder is missing on the device, the connector holds those deletes. Its local page asks you to **Delete on the hub too** or **Restore them**, the device shows **Paused** in Hub management and the hub keeps an alert open until it is settled.

## Slice workers

A device can slice for the hub. In **Settings → Integrations**, the slicer's card sets up its install there (**Set up**, or **Add a machine…**), picks or installs its program (**Use this program**), and **Change slicer machine** picks it. One install per slicer and machine. Having an install makes it a slice worker, and removing its last slicer ends it; only the hub's slicer slices. Steps, offline behaviour and the manual path: [slicing.md](slicing.md#slice-on-a-worker).

Use a worker when the hub is on a VPS or an arm64 NAS with no server slicer, or when a workstation is faster. The hub keeps the presets and prepares each job; only the slicer runs on the device. Run the connector in its own data folder: it refuses to start in the hub's, because it would clean up the hub's slicer installs.

## Slicer presets

On a hub, one library holds the user presets (printer, process, filament) of Bambu Studio and OrcaSlicer. The server's slicer and every slice worker use it, and a slice that used a changed preset shows as outdated. A single-PC install has no library: it slices with its desktop slicer's own folder.

Open it from **Catalog → Settings → Preset library** (shown while the hub is on; `/hub/presets`, `/catalog/presets` and `/presets/settings/library` still land there). A preset imported from a user preset links to its entry here, and the entry links back to it. Anyone who can see the presets or projects can browse and download presets and their earlier versions. Changing things needs **Catalog** write, which Admin and Editor have (the old **Presets** right is part of **Catalog** since [ADR-0023](adr/0023-one-catalog-module.md); updating keeps the higher of the two): delete a preset, clean up conflict copies, and set the two switches below.

Presets get in from a slicer zip ([slicing.md](slicing.md#presets)) or from a workstation. Every slicer a machine reports is listed on **Catalog → Settings → Sources**, under both **Share to server** and **Receive from server** (all off by default). Share is set per kind: the machine's **Printer**, **Process** and **Filament user presets** lines; the machine shares while any of them is on. Receive takes every kind. The machine's user turns them on and off with `machine.catalog`.

- **Share** (Send presets): the connector sends each preset saved in that slicer to the hub within a minute. It follows the account the slicer last used, or the signed-out folder. The slicer shows when a preset it sent was last stored, and the deletes held for you. The hub ignores a preset of a kind whose line is off, and its deletes; a file saved meanwhile reaches the hub on its next save.
- **Receive** (Install): the connector writes every preset of the library into that slicer's folder. It waits until the slicer is closed, backs up the folder to a zip first and the preset shows at the slicer's next start. Its **User presets** line on **Catalog → Settings → Sources** has the switch and shows whether it is up to date or how many wait, and under **Folder and backup** where it writes and the last backup. Updating to 5.5.0-alpha.2, a machine that received only some kinds receives all three; nothing it has is removed.

So a PC can send its Bambu Studio filament presets and nothing else. A slicer the machine no longer reports keeps its lines, which can't change, with their values. Updating from 5.4.0-alpha.3 or earlier, each device keeps its two switches for every slicer it reported. A connector older than this asks to be updated when you change a switch while it is online; until then it only gets the slicers whose switch is on.

### Catalog source

A slicer's system presets (its brands and printer models) are read from one place per library. That place is the slicer's **hub's slicer** ([ADR-0022](adr/0022-one-slicer-per-type.md)): this server's install, or a workstation's. On a hub with no slicer of its own for that library, set up the workstation's install on the slicer's card in **Settings → Integrations** (the oldest install is the hub's slicer until one is picked), or pick it there with **Change slicer machine**. Its connector then sends the slicer's system presets when they differ from the hub's copy, which raises the catalog change alert; any other device gets `not_source`. A connector older than this answers `device_outdated` when you pick it. When the hub's slicer moves, the old device's copy is removed on the next tick; a zip's copy stays. A machine whose hub's slicer is a managed (downloaded) install sends from that install's own folder (`resources/profiles` in its data folder), not from a desktop config folder; the hub tells its connector where.

### Receive catalog

With its **System presets** line's **Receive** on, on **Catalog → Settings → Sources**, a machine gets the hub's copy of the hub's slicer's `system/` folder, so its slicer has the same vendor presets as the hub's. The copy comes from the hub's slicer, on a machine or on this server.

- It is sent when the hub's copy differs from the machine's own, checked every minute and as soon as the hub's slicer sends a new copy. A slicer update that rewrites `system/` on the machine changes it again, so the copy is written again after the update.
- The connector waits until the slicer is closed. It then backs up the machine's `system/` to `catalog-backups/<slicer>.zip` in its data folder (only the last backup is kept), and writes the hub's preset files over the folder. It deletes nothing, so the slicer's own files, such as bed models, stay. The vendor presets show at the slicer's next start.
- It is sent only to a slicer with the same major.minor version as the hub's slicer (2.4 to 2.4). A newer copy may not load in an older slicer, and a newer slicer may replace an older copy when it starts. Otherwise the line says which versions differ. When either version is unknown, it is sent.
- Server's slicer can't receive: its own folder is the catalog. Its Receive switch is off and locked, and picking a machine as the hub's slicer turns its Receive off.
- **Receive from server**, on **Catalog → Settings → Sources**, has a card for every machine with the slicer (and This server's slicer). The server's slicer has one too, for user presets only: its System presets line says *Server's slicer*, with no switch. Per slicer, its **System presets** line has the Receive switch, saved with the machine's **Catalog** right, and the `system/` state: off, not received yet, waiting for the slicer to close, received (with the date and the presets' version), or the error. **Folder and backup** shows the last backup; an offline or too old machine says so at the top of its card.
- A connector older than this answers `device_outdated` when you turn Receive on while it is online, and the switch stays off.

**This server's slicer** receives too: a slicer installed on the computer the server runs on (a folder on this computer, not a managed one) that isn't the hub's slicer. Its switch is `catalogReceive` on its integration (`PATCH /api/integrations/:id`; `not_local` for any other kind, `hub_slicer` on the hub's slicer, and picking it as the hub's slicer turns it off). It follows the same rules: the same major.minor, only while the slicer is closed, a backup to `catalog-backups/<integration>.zip` in the server's data folder first, the preset files laid over its folder. The server looks on each tick and as soon as a new copy comes in; its state is kept on the integration (`catalogInstall`).

It receives **user presets** the same way, like a machine: its **User presets** switch is `presetReceive` on its integration (`not_local` for any other kind). Every kind of the hub's user presets for that slicer goes to the folder of the account the slicer last used, only while the slicer is closed, after a backup of its `user/` folder to `preset-backups/<integration>.zip` in the server's data folder. The server looks every 30 seconds; what waits and the last backup are kept on the integration (`presetInstall`). A slicer that also shares its user presets gets its own back unchanged, with nothing written.

### Conflicts and skipped presets

If a device and the hub both changed a preset, the device's version is kept as a *conflict copy* named like hub file conflicts, and you get a **Preset conflict** alert. Download both, keep what you need, then delete the copy. Conflict copies stay on the hub. A preset that isn't valid JSON is never stored or written, and one whose parent preset the slicer lacks isn't installed there: both raise **Preset skipped**.

### Deleting

A delete never reaches workstations. Bambu Cloud and OrcaCloud bring a deleted preset back at the slicer's next start. Deleting on the hub removes the preset from the hub and the workers; delete it in each slicer too. Deleting in a slicer only shows **Removed on <device>** on the hub, which keeps its copy.

### Bambu Cloud and OrcaCloud

Both slicers sync user presets through their cloud account, and the connector writes the files the way the slicer expects, so a new preset is uploaded at the slicer's next start.

- **OrcaCloud** uploads new presets written to disk but not edits. A hub edit lands on that PC only, and the cloud keeps the old version for other PCs; the device page says so.
- A preset the cloud sends back may differ slightly (it drops values equal to the parent's). With both switches on this makes one more version on the hub, then it settles.
- The **User presets** cards on the Bambu Cloud integration read the account's presets into the hub's library themselves, so a hub needs no PC signed in to Studio for them. Both routes see a preset once: the account's cards own it, and the cloud's wording of the same settings (`"255"` instead of `["255"]`) makes no new version.
- Presets in the slicer need the parent preset they inherit from. OrcaSlicer 2.5 and later can't be checked for this, so they install without the check.

**Tip for farms:** with one cloud account on every PC, or cloud sync off on farm PCs, each PC gets the hub's presets from the connector alone, and the account's cloud can't bring back what you deleted or undo an edit. Use one Bambu account for the farm, or turn cloud sync off on those PCs.

## Shared folders on a device

The hub uses only the folders a device **shares**, while **Share to server** is on on its [machine page](#machine-page). Off, every device root on it shows **Not shared on the device**; the list stays for when it's back on.

The shared folders are picked on the hub, in **Projects settings → Sources**: a card per machine with Share to server on, one line per folder with the project folders inside it.

- **Add folder** browses the machine's whole disk (folder names only, no files) and asks before it shares: "Share D:\Models with the server?". A folder inside a shared one is shared already; a folder that holds shared ones takes their place.
- A line's switch pauses the folder: it stays in the list, but the device treats it as not shared. **⋯ → Remove** stops sharing it. Either way, a device root inside it shows **Not shared on the device** with the last known data, and isn't synced or served, until it's shared again.
- It takes `hub.manage`, or the machine's own user with `machine.projects` and Projects write; that user sees only their own machine's card. Each change is in the log, with who made it.
- The hub keeps the list and sends it to the connector, also when the connector was offline. The connector still refuses every file operation outside its active shared folders, so the hub can't read further than what was shared.
- A device root can be added only inside an active shared folder.
- Upgrading to 5.5.0, the connector sends the list it kept on its first connect, and from then on the hub's list wins. A connector that hasn't sent it yet (an older one) shows "Its connector hasn't sent its shared folders yet" on its card, and its own list still applies.
- The sync folder for hub roots isn't affected.

## Owners and permissions

Every project has an owner: the user who created it, the device's user for a project in a device root, or the oldest admin for projects that existed before 5.0.0. A folder found by a scan has no owner. Admins change the owner (or set it to nobody) when they edit the project, except in device roots.

Three project rights come from the user's role, and can be changed per user ([users.md](users.md#projects-of-others)):

- **See everyone's projects.** Without it, a user sees only the projects they own. Elsewhere, such as prints and orders, other projects show as "Other project" with no link, and a project the user can't see is a 404.
- **Edit everyone's projects.** Without it, they can view and download them, not change them.
- **Edit files on other workstations.**

Editing any project file needs Projects write. Each project folder also has **Who can edit**: **Editors and admins** (anyone with Projects write), admins only, picked users, or nobody (view only). A device's own user can always edit.

## Install the connector

Download the connector file for your system from the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) (files named `3d-maker-suite-connector-<version>-…`). Install the connector that matches your hub's version; it follows the hub's version when the hub updates, and goes back to the previous version if an update fails to start.

| System | File | What it does |
|---|---|---|
| Windows | `…-setup.exe` | Per-user install, no admin rights |
| macOS | `….dmg` | Drag the app to Applications |
| Linux | `….tar.gz` | Unpack, run `install.sh` |

The connector starts at login and has no tray icon. Its start-menu or app-menu entry opens the machine's page on the hub once paired, and the pair screen before. With the hub out of reach it opens the connector's **local page**, <http://127.0.0.1:4301/local>: the machine, its user, the hub and whether it's reachable, with **Open on the hub**, **Open sync folder**, held deletes, **Change user**, **Restart server**, **Stop server** and **Unpair**. Every other setting is on the [machine page](#machine-page). Its sync folder is `<home>/3D Maker Suite`.

### Warnings you will see

The installers are not code-signed, so the system warns once, as with the app itself:

- **Windows** SmartScreen: **More info**, then **Run anyway**.
- **macOS 15**: **System Settings → Privacy & Security → Open Anyway**, or `xattr -dr com.apple.quarantine "/Applications/3D Maker Suite Connector.app"`.
- **Linux**: no warning.

Self-updates don't warn again.

### Updates, restart and stop

Hub management marks a device whose connector isn't on the hub's version: **Outdated**, or **Update failed** with the reason (the download failed, or the new version didn't start and the connector went back). The hub also raises an alert, which clears once the versions match. **Update now** makes an online connector download the hub's version at once, even one that went back before.

The machine page has **Restart connector** and **Stop connector**; both need it online. The local page has **Restart server**, **Stop server** and **Unpair**, also on the pair screen. Unpair forgets the hub on this machine (for a hub that needs a fresh install); the hub shows the device offline until an admin removes it. A connector does not start on a machine where a hub is running: one hub per machine. Stop takes the device offline for the hub until the connector starts again: from the start menu or app menu, or at the next login.

## For company IT

- **Where it comes from.** Every release asset is listed in `SHA256SUMS` and has a GitHub artifact attestation:
  ```
  sha256sum -c SHA256SUMS --ignore-missing
  gh attestation verify <file> -R emanuelmoniz/3d-maker-suite
  ```
  Allow a build by hash, or by the install path below.
- **Install paths.**

  | System | Program | Data and logs |
  |---|---|---|
  | Windows | `%LOCALAPPDATA%\Programs\3D Maker Suite Connector` (logs in `logs\`) | `%APPDATA%\3d-maker-suite-connector` |
  | macOS | `/Applications/3D Maker Suite Connector.app` | `~/Library/Application Support/3d-maker-suite-connector` |
  | Linux | `~/.local/share/3d-maker-suite-connector/install` | `~/.local/share/3d-maker-suite-connector` |

- **Network.** Outbound HTTPS (or HTTP on a LAN) from the device to the hub, plus GitHub release downloads for updates. The local page listens on `127.0.0.1:4301` only.
- **What it can do.** It carries out a fixed list of operations (list, read and write files inside its own folders, report installed slicers). It never runs a command the hub sends. The device token is stored encrypted and never logged.
- **Signing.** Nothing is code-signed yet; see ADR-0014, "Unsigned builds".
