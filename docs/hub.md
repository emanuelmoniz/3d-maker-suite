# Hub and connector

> **Status: 5.0.0-alpha.2.** This pre-release adds device roots (project folders on a paired device), project owners and permissions, and connector updates from Hub management. Syncing a project folder between devices comes in later 5.0.0 pre-releases. Test on a copy of your data and back up first.

A **hub** is the normal server with hub features switched on. Workstations, a NAS or a file server join it by running a small **connector**. People still work only in the web app. Design and decisions: [ADR-0014](adr/0014-hub-and-connector.md).

With the switch off, nothing changes.

## Turn the hub on

1. Set up user accounts first ([users.md](users.md)): every device acts as a user.
2. As an admin, go to **Settings → Server** and turn on **Hub**.
3. **Hub management** appears in the menu next to Integrations (admins only). It lists the devices: name, user, OS, connector version, and online or last seen.

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

## Owners and permissions

Every project has an owner: the user who created it, the device's user for a project in a device root, or the oldest admin for projects that existed before 5.0.0. A folder found by a scan has no owner. Admins change the owner on the project page, except in device roots.

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
