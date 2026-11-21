# Connector setup

The connector is a small program that joins a computer to your [hub](Hub-Setup.md). This page shows how to install it on Windows, macOS and Linux (also a Raspberry Pi, a Linux server or a Windows Server with nobody signed in), pair it, keep it up to date and remove it.

## Who can use it

Anyone can install the connector. Only an admin of the hub can make the pairing code. The computer then acts as the user the code was made for, with that user's rights.

## What the connector does

Once paired, a computer can do any of these. An admin or the computer's own user turns each one on, on the computer's page in **Hub management**:

- **Send projects to server.** The computer shares folders, and the hub lists their projects.
- **Get projects from server.** Hub projects you pick are kept in the computer's sync folder, `3D Maker Suite` in your home folder. Save in your slicer as usual and the hub gets the change.
- **Slicer presets.** The computer sends the presets saved in its slicer to the hub, and receives the hub's.
- **Reach printers and spool libraries.** It reads printers and a Spoolman on its network for a hub that can't reach them.
- **Slice for the hub.** It runs a slicer when the hub asks it to.

It also reports its name, system, version, disk use and slicers, so the hub can show them on the computer's page. By default a new computer receives nothing from the server until you pick what it gets.

## Before you start

- **The hub is on,** and you have its address, see [Hub setup](Hub-Setup.md).
- **An admin** makes you a pairing code, or you are the admin.
- **The right computer.** Windows 64-bit, a Mac (Apple silicon or Intel), or a 64-bit Linux computer: x64, or ARM64 such as a Raspberry Pi 4 or 5 with a 64-bit system. With a desktop you pair on the connector's page in a browser on the same computer. With no desktop, see [Linux with no desktop](#linux-with-no-desktop) and [Windows Server](#windows-server). There is no connector for a NAS's own system yet. To use a NAS's folders, run the hub on the NAS with [Docker](Docker.md#on-a-nas) and mount the NAS folders into it as hub folders. The hub then reads them directly.
- **The same version as the hub.** Download the connector from the same release as the hub. If it is older, it updates itself when it pairs.
- **No hub on the same computer.** The connector doesn't start where a hub is running.

## Download

1. Open the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) and pick the release that matches your hub.
2. Download the connector file for your system. `<version>` is the release tag, such as `v6.1.0`.

| System | File |
|---|---|
| Windows | `3d-maker-suite-connector-<version>-windows-x64-setup.exe` |
| macOS, Apple silicon | `3d-maker-suite-connector-<version>-macos-arm64.dmg` |
| macOS, Intel | `3d-maker-suite-connector-<version>-macos-x64.dmg` |
| Linux, x64 | `3d-maker-suite-connector-<version>-linux-x64.tar.gz` |
| Linux, ARM64 (Raspberry Pi) | `3d-maker-suite-connector-<version>-linux-arm64.tar.gz` |

3. Optional: check the file against `SHA256SUMS` from the same release. Run `sha256sum -c SHA256SUMS --ignore-missing`, or `Get-FileHash` in PowerShell.

Take care to pick files with `connector` in the name. The files without it are the app itself.

## Install

### Windows

1. Double-click the setup file. Windows may show a warning, see [Warnings you will see](#warnings-you-will-see).
2. Choose if you want a desktop icon. Starting at sign-in isn't a choice: the connector only helps while it runs, so the installer always turns it on.
3. Finish the setup. It installs for your user only, with no administrator rights, in `%LOCALAPPDATA%\Programs\3D Maker Suite Connector`.
4. Leave **Launch 3D Maker Suite Connector** ticked on the last page.

### macOS

1. Open the `.dmg`.
2. Drag **3D Maker Suite Connector** onto **Applications**.
3. Open it from Applications. macOS may show a warning, see [Warnings you will see](#warnings-you-will-see). Once it runs, it turns on starting at login by itself.

### Linux

1. Unpack the archive:

```bash
tar -xzf 3d-maker-suite-connector-<version>-linux-x64.tar.gz
```

On an ARM64 computer, use the `linux-arm64` file.

2. Go into the unpacked folder and run the install script:

```bash
cd 3d-maker-suite-connector
./install.sh
```

3. Open **3D Maker Suite Connector** from your application menu. Once it runs, it turns on starting at login by itself.

The script needs no administrator rights. Running a newer `install.sh` updates the install.

### Linux with no desktop

Use this on a Raspberry Pi or a Linux server you reach over SSH, where nobody signs in at a screen and there is no application menu. The connector runs as a service: it starts when the machine boots, and comes back by itself after a crash. It needs a 64-bit Linux with systemd, x64 or ARM64.

1. On the hub, make a pairing code as in [Pair the computer](#pair-the-computer). It works once, for 10 minutes, so make it just before step 3.
2. On the machine, download the connector file for its system (see [Download](#download)) and unpack it as above.
3. Go into the unpacked folder and install it as a service, with the hub's address and the code:

```bash
cd 3d-maker-suite-connector
./install.sh --headless --hub-url https://maker.example.com --pairing-code AB12-CD34 --name "Workshop Pi"
```

`--name` is optional. It starts as the machine's name.

4. If the script prints a `sudo loginctl enable-linger <your user>` line, run it once. Without it the service stops when you sign out, and doesn't start at boot.
5. In **Hub management** the machine shows **Online**.

What the script does:

- It installs the connector in the same folder as on a desktop and adds a user service, `~/.config/systemd/user/3d-maker-suite-connector.service`, that starts at boot. It adds no application menu entry and no start-at-login file.
- It needs no administrator rights, except for the `loginctl` line above.
- The address and the code are kept in the service file, which only your user can read. The first start pairs with them. The pairing stays in the connector's data folder, so after that the code is ignored.
- If the hub is off or can't be reached yet, the connector tries again. If the hub refuses the code (wrong, used or expired), the connector keeps running, unpaired, and writes one line about it in the log. Make a new code and run `install.sh --headless` again with it. A code that was refused is never sent twice.
- It runs as your user, so the files it creates in your folders belong to you.

To look at it:

```bash
systemctl --user status 3d-maker-suite-connector
journalctl --user -u 3d-maker-suite-connector
```

The connector's own log is `logs/server.log` in its install folder. **Stop connector** in the hub, or `systemctl --user stop 3d-maker-suite-connector`, keeps it stopped until you run `systemctl --user start 3d-maker-suite-connector` or the machine restarts. If the connector crashes or is killed, it starts again after 5 seconds, then waits longer after each new crash, up to 5 minutes. systemd starts it again if its launcher is killed. Running a newer `install.sh --headless` without the address and code updates the install and keeps the ones the service has.

### Windows Server

Use this on a Windows Server where the connector should run from boot, with nobody signed in, also on Server Core with no desktop. The connector runs as a scheduled task, `3D Maker Suite Connector`, which starts it at boot as the account that installed it. That account must be an administrator: the connector runs as it, without its administrator rights, and no password is stored. Windows Server x64 only.

1. On the hub, make a pairing code as in [Pair the computer](#pair-the-computer). It works once, for 10 minutes, so make it just before you run the setup.
2. Download the Windows connector file (see [Download](#download)) to the server.
3. Install it in one of these two ways.

**With a desktop.** Sign in as the administrator the connector should run as, and double-click the setup file. Tick **Start at boot with nobody signed in (headless)**, then fill in the hub address, the code and the name on the next page. Windows asks for administrator rights once, to add the task.

**Server Core, or any server from the command line.** In an administrator PowerShell, run the setup with the hub address and the code:

```powershell
.\3d-maker-suite-connector-<version>-windows-x64-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /HEADLESS /HUBURL=https://maker.example.com /PAIRINGCODE=AB12-CD34 /NAME="Workshop server"
```

`/NAME` is optional. It starts as the server's name. The setup ends with exit code 8 if the task couldn't be added, and writes the reason in `logs\headless-task.log` in the install folder.

4. In **Hub management** the server shows **Online**.

What the setup does:

- It installs the connector in the same folder as on a desktop, `%LOCALAPPDATA%\Programs\3D Maker Suite Connector` of the installing account, and adds the task. It adds no Start-menu entry, no desktop icon and no start at sign-in.
- The address and the code are kept in the task, which only administrators can read. The first start pairs with them. After that the code is ignored. A code the hub refused is never sent twice, as on Linux.
- It runs as the installing account, so the files it creates belong to that account. Its data is in that account's `%APPDATA%\3d-maker-suite-connector`.

To look at it, and to stop and start it:

```powershell
Get-ScheduledTask -TaskName "3D Maker Suite Connector" | Get-ScheduledTaskInfo
Stop-ScheduledTask -TaskName "3D Maker Suite Connector"
Start-ScheduledTask -TaskName "3D Maker Suite Connector"
```

The connector's own log is `logs\server.log` in its install folder. **Stop connector** in the hub, or `Stop-ScheduledTask`, keeps it stopped until you run `Start-ScheduledTask` or the server restarts. If the connector crashes or is killed, it starts again after 5 seconds, then waits longer after each new crash, up to 5 minutes. If its launcher (the `nodew.exe` that runs `launcher.mjs`) is killed, it stays stopped until `Start-ScheduledTask` or the next boot: the task can't restart it. `Start-ScheduledTask` right after `Stop-ScheduledTask` is fine: the new start waits up to 15 seconds for the old one to end. Running a newer setup with `/HEADLESS` but without `/HUBURL` and `/PAIRINGCODE` updates the install and keeps the ones the task has.

A sync folder on a network share (`\\nas\share`) can't be reached this way yet. The task runs without the account's password, so Windows gives it no network credentials. Use a folder on the server's own disks for now. Running it as a named account with its password, which reaches shares, is planned.

## Warnings you will see

The installers are not code-signed, so your system warns once. Updates the connector downloads itself don't warn again.

- **Windows.** **Windows protected your PC** (SmartScreen) appears. Click **More info**, then **Run anyway**.
- **macOS 15.** It says the app can't be opened. Open the app once, go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run this in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/3D Maker Suite Connector.app"
```

- **Linux.** No warning.

## Pair the computer

Pairing links the connector to the hub. You do it once per computer.

On the hub:

1. Sign in as an admin and open **Settings → Hub management**.
2. Click **Pair a device**.
3. Pick the user the computer will act as. It gets that user's rights.
4. Click **Create code**.
5. Click **Copy code**, or write it down. It looks like `AB12-CD34`, works once, for 10 minutes, and is shown only once.

On the computer:

1. Open **3D Maker Suite Connector** from the Start menu, Applications or the application menu. Your browser opens on the connector's page, <http://127.0.0.1:4301>. Until it is paired, this page shows **Pair with your hub**.
2. Fill in the form, then click **Pair**.
3. The browser goes on to the computer's page on the hub. In **Hub management** the computer shows **Online**.

| Field | What to put | Required | Example |
|---|---|---|---|
| **Hub address** | The address you open the web app at, starting with `http://` or `https://` | Yes | `https://maker.example.com` |
| **Pairing code** | The code from **Hub management**. Capitals and the dash are optional | Yes | `AB12-CD34` |
| **Device name** | How the computer is listed in **Hub management**. It starts as the computer's name | No | `Workshop PC` |

After 5 wrong codes, pairing is locked for 15 minutes.

## The connector's own page

Open it from <http://127.0.0.1:4301/local>. It only opens on the computer itself. It shows:

| Item | What it tells you |
|---|---|
| **Hub** | The hub's address |
| **Device** | The name the hub knows it by |
| **User** | The user the computer acts as |
| **State** | **Online**, **Connecting…**, **Offline, retrying** or **The hub is turned off on this server** |
| **Connector version** | The version that runs now |
| **Sync folder** | The folder where hub projects are kept, `3D Maker Suite` in your home folder |
| **Project roots watched** | How many folders it keeps an eye on |
| **Sync** | **Up to date**, **Syncing…**, **Paused** or **Something didn't sync**, and how many changes wait |

The buttons are:

- **Open on the hub.** Opens the computer's page in the web app.
- **Open sync folder.** Opens the sync folder.
- **Delete on the hub too** and **Restore them.** They show only when the sync is paused, see [Deleted files](#deleted-files).
- **Change user.** See [Change the computer's user](#change-the-computers-user).
- **Restart server** and **Stop server.**
- **Unpair.** See [Unpair or remove it](#unpair-or-remove-it).

Every other setting is on the computer's page in the web app, not here.

## Change a setting

Open **Settings → Hub management** and click the computer. Its page holds everything: its name, its user, **Local page port**, **Start with the computer**, the slicers, and the switches from [What the connector does](#what-the-connector-does). The page needs the connector online, so it can change a setting at once.

A new port applies after **Restart connector**.

## Deleted files

If a computer deletes a lot of files from one hub folder at once, the connector holds the deletes, so a mistake can't empty a folder. Its sync shows **Paused**, and **Hub management** says so too. Open the connector's page and choose:

- **Delete on the hub too.** The files go to the hub's trash.
- **Restore them.** The hub's files come back to the computer.

Nothing is deleted for good. The limit is set in the hub's **Settings** in **Hub management**.

## Change the computer's user

Use this to make the computer act as someone else, without pairing again.

1. In **Hub management**, open the computer and click **Change user**. Pick the user and click **Copy code**.
2. On the connector's page, click **Change user** and enter the code. The hub must be online.
3. Choose what happens to the projects in this computer's folders: **Move to the new user** or **Stay with their owner**. Then confirm.

The computer keeps its name, folders and settings. After 5 wrong codes, wait 15 minutes.

## Updates

The connector follows the hub's version. After you update the hub, each connector downloads the same version (the file for its own system, ARM64 Linux included) and restarts by itself when it reconnects. The release file is checked against `SHA256SUMS` first.

In **Hub management** a computer that isn't on the hub's version shows **Outdated**. If the update failed it shows **Update failed**, with the reason: the download failed, or the new version didn't start and the connector went back to the old one. Click **Update now** on its page to try again at once. The hub raises an alert if a computer is still on another version 15 minutes after it connected.

## Restart and stop

- On the computer's page in the web app: **Restart connector** and **Stop connector**. The computer has to be online.
- On the connector's page: **Restart server** and **Stop server**.

A stopped connector keeps the computer offline for the hub until you start it again from the Start menu, Applications or the application menu, or until the next sign-in. A headless one stays stopped until its service ([Linux](#linux-with-no-desktop)) or task ([Windows Server](#windows-server)) is started again, or the machine restarts.

## Unpair or remove it

**Unpair.** On the connector's page, click **Unpair** and confirm. The computer forgets the hub. Its files stay where they are. The hub shows the computer as offline until an admin removes it.

**Revoke.** An admin can remove a computer from the hub: in **Hub management** choose **Revoke**. The computer loses access at once. The connector shows **This device was removed from the hub. Pair it again to reconnect.** To use it again, make a new code and pair.

**Uninstall.** Unpair first, then remove the program. Uninstalling keeps the sync folder and the connector's data.

| System | How to remove it |
|---|---|
| Windows | **Settings → Apps → Installed apps → 3D Maker Suite Connector → Uninstall**. It also stops starting at sign-in |
| macOS | Drag **3D Maker Suite Connector** from Applications to the Bin, then delete `~/Library/LaunchAgents/com.3dmakersuite.connector.login.plist` |
| Linux | Delete `~/.local/share/3d-maker-suite-connector/install`, `~/.local/share/applications/3d-maker-suite-connector.desktop` and `~/.config/autostart/3d-maker-suite-connector.desktop` |
| Linux, with no desktop | Run `systemctl --user disable --now 3d-maker-suite-connector`, then delete `~/.config/systemd/user/3d-maker-suite-connector.service` and `~/.local/share/3d-maker-suite-connector/install` |
| Windows Server, headless | **Settings → Apps → Installed apps → 3D Maker Suite Connector → Uninstall**, or `& "$env:LOCALAPPDATA\Programs\3D Maker Suite Connector\unins000.exe" /VERYSILENT` in an administrator PowerShell. It stops the connector and removes the task |

To remove everything, also delete the data folder (see the table below) and the `3D Maker Suite` folder in your home folder. The data folder holds the pairing, so the computer is unpaired once it is gone.

## For company IT

| System | Program | Data and logs |
|---|---|---|
| Windows | `%LOCALAPPDATA%\Programs\3D Maker Suite Connector`, logs in `logs\` | `%APPDATA%\3d-maker-suite-connector` |
| macOS | `/Applications/3D Maker Suite Connector.app` | `~/Library/Application Support/3d-maker-suite-connector`, logs in `install/logs/` |
| Linux | `~/.local/share/3d-maker-suite-connector/install`, logs in `logs/` | `~/.local/share/3d-maker-suite-connector` |
| Linux, with no desktop | the same, run by the user's systemd through `~/.config/systemd/user/3d-maker-suite-connector.service` (with linger) | the same |
| Windows Server, headless | the same as Windows, of the installing administrator, run at boot by the scheduled task `3D Maker Suite Connector` (S4U: no stored password, no elevation) | the same as Windows |

- **Allow by hash.** Every release file is in `SHA256SUMS`. You can also verify one with `gh attestation verify <file> -R emanuelmoniz/3d-maker-suite`.
- **Network.** The connector connects out to the hub (HTTPS, or HTTP on a LAN) and to GitHub releases for updates. It also reaches the printers and the spool library the hub gives it, on their web or MQTT port. Its own page listens on `127.0.0.1:4301` only.
- **No admin rights.** The installers write only in the user's folders. The one exception is the Windows Server headless choice, which needs an administrator once, to add its scheduled task.
- **Secrets.** The computer's token and the printers' keys are stored encrypted and are never logged.
- **More.** What a connector can and can't do is on [Hub setup](Hub-Setup.md#for-company-it).

## Limits and tips

- **No connector for a NAS's own system yet.** Windows (Windows Server too), macOS, Linux x64 and Linux ARM64 are covered. A NAS that can't add services needs a container, which comes later.
- **Windows Server, headless: no network shares yet.** Its task has no network credentials, so a sync folder on `\\nas\share` isn't reached. Windows on ARM has no headless install.
- **ARM can't slice.** A connector on ARM can't be a slice worker.
- **One hub per computer,** and one pairing per computer.
- **Starts at login.** The connector has no tray icon and no window. Its Start-menu or application-menu entry opens the hub's page for the computer, or the pair page before it is paired. When the hub can't be reached, it opens the connector's own page.
- **Index a shared folder from one connector only.** If two connectors share the same network folder, every project shows twice.
- **Keep cloud files on the computer.** A cloud drive's online-only files make a scan download everything. Set the folder to **always keep on this device** first.
- **Versions in a shared folder.** The app keeps older versions only of files uploaded through it. For saves from a slicer or a network share, use your storage's own history.

## Problems and fixes

- **The pair page says it can't reach the hub.** Check the address and that the hub is running. With `APP_ALLOWED_HOSTS` set on the hub, the name you typed must be in the list.
- **The pair page says the code is wrong, used or expired.** A code works once, for 10 minutes. Make a new one.
- **The pair page says the hub is turned off.** Turn **Hub** on in **Settings → General** on the hub.
- **Too many wrong codes.** Wait 15 minutes, then try again.
- **The connector doesn't start.** A hub may be running on the same computer, or the connector's data folder is the hub's data folder. The log says which. Find it in the table above.
- **The computer shows Offline in Hub management.** The connector is stopped, the computer is asleep, or it can't reach the hub. Start it from the menu, and check the network.
- **Update failed.** Read the reason on the computer's page. Click **Update now** when the cause is fixed. The connector stays on the old version until then.
- **A project shows twice.** Two connectors index the same shared folder. Keep only one.

## Related pages

- [Hub setup](Hub-Setup.md)
- [Choose how to run](Choose-How-to-Run.md)
- [Docker](Docker.md)
- [Public access](Public-Access.md)
