# Move or uninstall

How to move 3D Maker Suite to a new computer, and how to remove it, with or without your data.

## Before you start

Make sure you have a current backup and know where your data is. See [Backups and restore](Backups-and-Restore.md) and [Where your data is kept](Configuration.md#where-your-data-is-kept).

## Move to a new computer

A backup holds your database, photos and saved logins, but not your project files. They move separately.

1. **Back up on the old computer.** Go to **Settings → Backup & export**, click **Back up now**, then **Download**. Stop the app afterwards, with **Stop server** at the top right of **Settings**, so nothing changes after the backup.
2. **Copy your project files.** Copy each project folder to the new computer. Keep the layout under each folder, because projects remember their place inside it. In Docker, mount the new folders, see [Docker](Docker.md#project-folders).
3. **Install on the new computer.** Install the same version as the old one, or a newer one. See [Choose how to run](Choose-How-to-Run.md).
4. **Restore.** Follow [Restore on a new or empty install](Backups-and-Restore.md#restore-on-a-new-or-empty-install). Sign in with your old accounts.
5. **Point to the new project folders.** The old folders are still listed and a scan reports them as missing. Their projects stay. Add the new folders in **Projects settings** (the gear on **Projects**), then use **Change project folder…** with **Move files from the previous folder to the new one** off.
6. **Set again what a backup doesn't hold:**
   - **Settings:** host, port and public address in **Network**, and **Start at login** in **General**.
   - Slicers you installed from the app: install them again in **Settings → Integrations**.
   - Environment variables or compose settings: copy them from the old computer. See [Configuration](Configuration.md).

Check the printers, prints and costs before you remove the old install.

### Connectors, if the hub is on

Connectors keep their pairing when the hub moves, because the backup holds it. Only the address changes. Do one of these:

- **Before the move,** set the new address as **Public address** in **Settings → Network** on the old computer. Every connector is told and tries it first, and switches once the hub answers there. Without a Public address, a new **Port** saved there is told too. See [Hub setup](Hub-Setup.md#give-the-hub-an-address).
- **After the move,** give each connector the new address: **Change hub address** on its own page, or a new `CONNECTOR_HUB_URL` for a NAS, server or container. See [Change the hub address](Connector-Setup.md#change-the-hub-address).

A connector that was offline during the change still keeps its old address. Give it the new one the same way.

## Uninstall

First stop the app and turn off **Start at login**, so no entry is left behind. Both are in **Settings**: **Start at login** in the **General** card, **Stop server** at the top right.

| System | Remove the program |
|---|---|
| Windows | **Settings → Apps → Installed apps → 3D Maker Suite → Uninstall** |
| macOS | Drag **3D Maker Suite** from Applications to the Trash, then delete `~/Library/Application Support/3d-maker-suite/install` |
| Linux | Delete `~/.local/share/3d-maker-suite/install` and `~/.local/share/applications/3d-maker-suite.desktop`. If `XDG_DATA_HOME` is set, use that folder instead of `~/.local/share` |
| Source install | Delete the folder you cloned |
| Docker | `docker compose down` in the folder with the compose file |

Uninstalling the program **keeps your data**. You can install again later and carry on where you were.

## Remove your data too

This can't be undone. Download a backup first if you might want it back.

| System | Delete this folder |
|---|---|
| Windows | `%APPDATA%\3d-maker-suite` |
| macOS | `~/Library/Application Support/3d-maker-suite` |
| Linux | `$XDG_DATA_HOME/3d-maker-suite`, or `~/.local/share/3d-maker-suite` |
| Source install | The data folder for your system above, or the folder in `APP_DATA_DIR` |
| Docker | `docker compose down -v` also deletes the `app-data` volume. If you mounted a folder instead, delete that folder |

On Linux and macOS the program and the data share one parent folder, so deleting `3d-maker-suite` there removes both.

Your project files are never touched. They stay where they are.

## Limits and tips

- The saved logins are encrypted with `secret.key` in the data folder. Without that file, a backup or copy of the database can't read them.
- If the hub is on, connectors keep their pairing when it moves, see [Connectors, if the hub is on](#connectors-if-the-hub-is-on). Pair a connector again only if you start the new hub without the old one's backup.

## Problems and fixes

- **The old install still starts at login.** Turn off **Start at login** before you uninstall. If it's already gone: on Windows, remove **3D Maker Suite** under **Settings → Apps → Startup**; on macOS, delete `~/Library/LaunchAgents/com.3dmakersuite.login.plist`; on Linux, delete `~/.config/autostart/3d-maker-suite.desktop`.
- **The new install shows missing folders.** Add the new project folders and use **Change project folder…**.
- **A restore on the new computer is refused.** The new version is older than the backup's. Install a newer one.

## Related pages

- [Backups and restore](Backups-and-Restore.md)
- [Updates](Updates.md)
- [Choose how to run](Choose-How-to-Run.md)
- [Configuration](Configuration.md)
