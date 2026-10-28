# Hub and connector

> **Status: 5.0.0-alpha.1.** This pre-release has the hub switch, device pairing and the connector (install, online state, self-update). Syncing project folders and device roots come in later 5.0.0 pre-releases. Test on a copy of your data and back up first.

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
