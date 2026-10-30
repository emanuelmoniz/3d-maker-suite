# Hub and connector

> **Status: 5.0.0.** Stable. Tested on a VPS behind Caddy, a NAS in Docker and Windows, macOS and Linux workstations. Back up before updating.

A **hub** is the normal server with hub features switched on. Workstations, a NAS or a file server join it by running a small **connector**. People still work only in the web app. Design and decisions: [ADR-0014](adr/0014-hub-and-connector.md).

With the switch off, nothing changes.

## Turn the hub on

1. Set up user accounts first ([users.md](users.md)): every device acts as a user.
2. As an admin, go to **Settings → Server** and turn on **Hub**.
3. **Hub management** appears in the menu next to Integrations (admins only). It lists the devices: name, user, OS, connector version, and online or last seen. Its **Settings** page holds the sync, lock and version settings.

If the hub is switched off again, connectors show "The hub is turned off on this server" and keep their pairing.

## Pair a device

Only admins pair devices.

1. In **Hub management**, choose **Pair a device**, pick the user the device will act as, and copy the pairing code. It works once, for 10 minutes, and is shown once.
2. On the device, install the connector (below) and open its status page, <http://127.0.0.1:4301>.
3. Enter the hub's address (the one you open the web app at), the code and a device name, then **Pair**.
4. The device shows **Online** on its status page and in Hub management.

The hub stores only a hash of the device token. In Hub management you can **Rename** a device or **Revoke** it: a revoked device loses access at once, its local files stay on its disk, and it needs a new code to join again. The connector connects out to the hub, so devices need no open ports and no VPN. It works behind Caddy, nginx and Traefik with default settings: the hub marks its event stream as unbuffered and sends a heartbeat every 15 seconds.

## Device roots

A project root can live on a paired device instead of the server.

1. In **Settings → Projects**, choose **Add root**. Pick the location, **This server** or an online device, then browse to the folder. A device browse goes through the connector; the picker says why it failed (offline, no answer, or a connector that is too old).
2. The connector watches the folder, waits until a project folder's files stop changing, and sends the hub its scan and the 3MF details. On every connect it checks what changed. The projects use the same page as any other project.

The hub fetches a file only when it needs it: slicing, auto slicing, a download or the 3D view. It asks the connector, checks the file's hash and keeps it in a temporary cache (1 hour, 10 GB at most). Creating a project folder and moving one to the trash run on the device. **Open in slicer** and **Open folder** are hidden on device projects, because they would open on the hub.

### Offline

While a device is offline, its roots and projects show **Offline** with the last known data. Plate previews, the cover and the gallery picks the device sent still show. Other images, files and any write wait for the device: a change to the cover or gallery is sent on its next connect.

### Plate previews and gallery

The scan carries the plate previews of each 3MF, so a project page doesn't download the whole file. A device project's cover and gallery can be picked as on the server. Offline, the picker offers only the picks the hub already holds, and the project page says how many the device didn't send.

**Settings → Projects → Device folder size limit** (default 32 MB, up to 128 MB) caps what one folder's scan sends: descriptions first, then the cover, plate previews and gallery picks. What doesn't fit is left out, so plate previews go first. Changing it sends the folders again.

## Hub roots: sync with devices

A root on **This server** is a hub root. Each device keeps a copy of it in its sync folder (`<home>/3D Maker Suite/<root>`) and the two stay in step both ways: save in your slicer as usual and the hub gets the change; a change made on the hub or another device arrives on its own. Files download to a hidden temporary file, are hash-checked and then renamed into place, so a half-copied file never shows. Files the root marks download-only are read-only on the device. The device's status page shows the sync state and how many changes wait.

A restarted connector downloads nothing it already has.

### Which projects a device syncs

**Hub management** (and the connector's status page) set what a device syncs: **Everything**, or **Selected projects**. With selected projects, a project joins the device through **Open**, and Hub management lists the selection with a button to stop syncing one. Stopping removes the local copy only; the hub keeps the project and nothing counts as a delete.

### Open

The project page and the model file rows have one **Open** button. It opens the file in a slicer on the computer you are sitting at:

- **On the server's computer** (by `localhost`, its network address, or a name for it): the slicer from Settings > Integrations. It edits the hub folder in place, so it takes no lock. Another computer can never open the server's slicer.
- **On a computer with the connector:** the page asks the connector on this computer which device it is, and that device opens the file, even when you have other devices paired. The hub selects the project for that device, the connector downloads it if it isn't there yet and opens the file. When you save, the change syncs back, and auto slicing runs on the hub as for any change.
- **When the page can't ask** (no connector here, Safari, or you declined the browser's local network prompt): your online devices with a slicer. One opens without asking; with several, Open asks which.

**Open folder** works the same way. On the server's computer it opens the project folder there. On a computer with the connector it opens the project's copy in the sync folder, if that device syncs the project. If not, the page says so: open one of its models with **Open** (that adds the project to the device), or set the device to sync everything on its connector's status page or in Hub management. Elsewhere the button is hidden.

The page only finds the connector when the connector was paired with the same address you use in the browser (for example both `http://3dms.lan:4300`). With another address it falls back to the list.

The connector finds installed slicers itself (Windows: the installed apps list; macOS: `/Applications`; Linux: Flatpak) and reports them to the hub. The status page picks the default, or **Ask each time**: then Open asks which slicer when the device has more than one. With no slicer found, the device isn't offered.

Locks are soft: see [Locks](#locks).

### Locks

**Hub management → Settings → Check-out locks** has three modes (default **Off**):

- **Off**: anyone can edit a hub file on any device at once. Clashing saves become conflict copies.
- **On**: opening a file on a workstation with **Open**, or the first save of it there, checks it out for that device. Other devices get the file read-only until it is released. Their saves still become conflict copies and their deletes are refused.
- **Strict**: as On, and a device that is offline can only read hub files (except the ones it has checked out), because it can't check anything out.

A checked-out file is released when:

- the slicer **Open** launched exits (Windows and Linux only),
- you choose **Done editing** (the project page or the connector's status page),
- it has had no save for the idle time (**Release a checked-out file after this many minutes without a save**, default 60),
- an admin force-unlocks it, or the device is revoked or its user deleted, or locks are switched off.

The project page shows "Being edited by `<user>` on `<device>`" on a checked-out file.

**Limits.** Locks are soft. They guard against two devices editing the same file by accident, not against someone who works around them: opening on the server's computer (which edits the hub folder in place and takes no lock), copying a file out, or editing the hub's disk directly doesn't check them. A device that was offline when a file was checked out learns about it when it reconnects.

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

**Mass delete guard.** When a device deletes more files from one hub root at once than the limit (**Hub management → Settings → Sync**, default 20), or a root's folder is missing on the device, the connector holds those deletes. Its status page asks you to **Delete on the hub too** or **Restore them**, the device shows **Paused** in Hub management and the hub keeps an alert open until it is settled.

## Slice workers

A device can slice for the hub. In **Hub management** turn on **Slice worker** for it; the slicers the connector found are listed, and a device that is a worker also shows that on its status page. Then add a **Bambu Studio (worker)** or **OrcaSlicer (worker)** integration for the device and pick or install its slicer. Steps, offline behaviour and the manual path: [slicing.md](slicing.md#slice-on-a-worker).

Use a worker when the hub is on a VPS or an arm64 NAS with no server slicer, or when a workstation is faster. The hub keeps the presets and prepares each job; only the slicer runs on the device. Run the connector in its own data folder: it refuses to start in the hub's, because it would clean up the hub's slicer installs.

## Shared folders on a device

The hub can browse and use only the folders a device **shares**. On the connector's status page, **Manage shared folders** adds a folder (the full path of an existing folder) or stops sharing one. Adding a folder inside a shared one isn't needed; the device already shares it.

- Browsing from the web app starts at the shared folders and can't leave them, also through `..` or links.
- A device root outside the shared folders can't be added. If a folder stops being shared, its root shows **Not shared on the device** with the last known data, and isn't synced or served.
- You can't stop sharing a folder while a device root inside it still has projects on the hub; remove those first.
- Upgraded connectors start by sharing the folders their roots are in, so nothing changes until you edit the list.
- The sync folder for hub roots isn't affected.

## Owners and permissions

Every project has an owner: the user who created it, the device's user for a project in a device root, or the oldest admin for projects that existed before 5.0.0. A folder found by a scan has no owner. Admins change the owner (or set it to nobody) when they edit the project, except in device roots.

Each user has three switches (**Settings → Users**; on for admins by default):

- **Sees all projects.** Without it, a user sees only the projects they own. Elsewhere, such as prints and orders, other projects show as "Other project" with no link, and a project the user can't see is a 404.
- **Edits other people's projects.** Without it, they can view and download them, not change them.
- **Edits files on other people's devices.**

Each root also has **Who can edit**: editors and admins, admins only, picked users, or nobody (view only). A device's own user can always edit.

## Install the connector

Download the connector file for your system from the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) (files named `3d-maker-suite-connector-<version>-…`). Install the connector that matches your hub's version; it follows the hub's version when the hub updates, and goes back to the previous version if an update fails to start.

| System | File | What it does |
|---|---|---|
| Windows | `…-setup.exe` | Per-user install, no admin rights |
| macOS | `….dmg` | Drag the app to Applications |
| Linux | `….tar.gz` | Unpack, run `install.sh` |

The connector starts at login and has no tray icon. Its start-menu or app-menu entry opens the status page. Its sync folder is `<home>/3D Maker Suite`.

### Warnings you will see

The installers are not code-signed, so the system warns once, as with the app itself:

- **Windows** SmartScreen: **More info**, then **Run anyway**.
- **macOS 15**: **System Settings → Privacy & Security → Open Anyway**, or `xattr -dr com.apple.quarantine "/Applications/3D Maker Suite Connector.app"`.
- **Linux**: no warning.

Self-updates don't warn again.

### Updates, restart and stop

Hub management marks a device whose connector isn't on the hub's version: **Outdated**, or **Update failed** with the reason (the download failed, or the new version didn't start and the connector went back). The hub also raises an alert, which clears once the versions match. **Update now** makes an online connector download the hub's version at once, even one that went back before.

The status page has **Restart** and **Stop**. Stop takes the device offline for the hub until the connector starts again: from the start menu or app menu, or at the next login.

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

- **Network.** Outbound HTTPS (or HTTP on a LAN) from the device to the hub, plus GitHub release downloads for updates. The status page listens on `127.0.0.1:4301` only.
- **What it can do.** It carries out a fixed list of operations (list, read and write files inside its own folders, report installed slicers, open a file in a slicer). It never runs a command the hub sends. The device token is stored encrypted and never logged.
- **Signing.** Nothing is code-signed yet; see ADR-0014, "Unsigned builds".
