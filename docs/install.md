# Install and first run

Pick your setup: [Installers](#installers) (no git, no Node), [Windows](#windows), [macOS](#macos), [Linux](#linux) or [Docker](#docker) (NAS and home servers).

## Installers

Download the file for your system from the [pre-release or release page](https://github.com/emanuelmoniz/3d-maker-suite/releases) and double-click it:

| System | File |
|---|---|
| Windows (x64) | `3d-maker-suite-<version>-windows-x64-setup.exe` |
| macOS, Apple silicon | `3d-maker-suite-<version>-macos-arm64.dmg` |
| macOS, Intel | `3d-maker-suite-<version>-macos-x64.dmg` |
| Linux (x64) | `3d-maker-suite-<version>-linux-x64.tar.gz` |

The installer brings its own Node, so you don't need Node, pnpm or Git. Windows installs per user, without admin. On macOS drag the app to Applications. On Linux, unpack the archive and run `install.sh`. Settings → About & updates then updates the app itself.

To check a download, compare its SHA-256 with `SHA256SUMS` from the same release (`sha256sum -c SHA256SUMS` on Linux and macOS, `Get-FileHash` on Windows).

### Warnings you will see

The installers are not code-signed (a certificate costs money every year), so the system warns once:

- **Windows** "Windows protected your PC" (SmartScreen): click **More info**, then **Run anyway**.
- **macOS 15** "can't be opened": open the app once, then go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run `xattr -dr com.apple.quarantine "/Applications/3D Maker Suite.app"` in Terminal. Ctrl-click → Open no longer works on macOS 15.
- **Linux**: no warning.

Updates downloaded from inside the app don't show these warnings again.

### Starting and stopping

The shortcut (Start menu, Applications or the desktop entry) starts the app and opens your browser at <http://127.0.0.1:4300>. There's no window to keep open; a second start just opens the browser again. To stop it, use **Settings → Server → Stop server**.

Turn on **Settings → Server → Start at login** to start it when you sign in.

### Where the installed app and its logs live

| System | Install folder | Logs |
|---|---|---|
| Windows | `%LOCALAPPDATA%\Programs\3D Maker Suite` | `logs\server.log` and `logs\launcher.log` in that folder |
| macOS | `/Applications/3D Maker Suite.app` plus `~/Library/Application Support/3d-maker-suite/install` | `logs/` in the install folder |
| Linux | `~/.local/share/3d-maker-suite/install` | `logs/` in the install folder |

Your data (database, key file, thumbnails, backups) stays in the data folder listed under [Where your data is](#where-your-data-is). Uninstalling removes the program and keeps your data.

## Windows

1. Install **Node.js 22 LTS** from <https://nodejs.org> (`node -v` should print `v22.x`) and [Git](https://git-scm.com).
2. In PowerShell:

```powershell
corepack enable
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

If `corepack enable` says access is denied, run PowerShell as administrator once, or use `npm install -g pnpm`.

## macOS

1. Install Node.js 22 LTS (<https://nodejs.org>, or `brew install node@22`) and Git (`xcode-select --install`).
2. In Terminal:

```bash
corepack enable
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

If `corepack enable` fails with a permissions error, use `sudo corepack enable` or `npm install -g pnpm`.

## Linux

1. Install Node.js 22 LTS (your distribution's package, [NodeSource](https://github.com/nodesource/distributions) or `nvm install 22`) and Git.
2. Same commands as macOS. `pnpm install` downloads a prebuilt SQLite driver; if none matches your system it compiles one, which needs `python3`, `make` and `g++` (`sudo apt install build-essential python3`).

## First run

`pnpm start` builds the web app, applies database migrations and starts the server. Open <http://127.0.0.1:4300>. Stop it with `Ctrl+C`; run `pnpm start` again to launch it later. Keep the terminal open while you use the app: updates and restarts from Settings happen in it.

## Start at login

Turn on **Settings → Server → Start at login**. It adds (or removes) an entry for your user only, no admin needed: a `Run` registry value on Windows, a LaunchAgent on macOS, an autostart `.desktop` file on Linux. The installers' "Start when I sign in" checkbox writes the same entry. With a git install the toggle starts `pnpm start`, so on Windows a console window opens at login (close it and the app stops); on macOS and Linux it runs without a window. The toggle isn't shown in Docker.

To set it up by hand instead (git installs, or if you want a hidden window or automatic restart on failure), let your system run `pnpm start` in the app's folder when you log in. `pnpm start` restarts itself after an update, so Settings → **Update** keeps working. Replace `C:\Apps\3d-maker-suite` or `/home/you/3d-maker-suite` with where you cloned it, and find `pnpm` with `where pnpm` (Windows) or `which pnpm`.

### Windows (Task Scheduler)

In PowerShell, once:

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c pnpm start" -WorkingDirectory "C:\Apps\3d-maker-suite"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "3D Maker Suite" -Action $action -Trigger $trigger
```

Start it now with `Start-ScheduledTask "3D Maker Suite"`; remove it with `Unregister-ScheduledTask "3D Maker Suite"`. The window stays hidden; stop the app from Task Manager (the `node` process) or with `Stop-ScheduledTask "3D Maker Suite"`.

### macOS (launchd)

Save as `~/Library/LaunchAgents/com.3dmakersuite.plist` (use the full path of `pnpm` in the first `string`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.3dmakersuite</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/pnpm</string><string>start</string></array>
  <key>WorkingDirectory</key><string>/Users/you/3d-maker-suite</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.3dmakersuite.plist`. Stop it with `launchctl unload` and the same path.

### Linux (systemd user unit)

Save as `~/.config/systemd/user/3d-maker-suite.service`:

```ini
[Unit]
Description=3D Maker Suite

[Service]
WorkingDirectory=%h/3d-maker-suite
ExecStart=/usr/bin/env pnpm start
Restart=on-failure

[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload && systemctl --user enable --now 3d-maker-suite`. Logs: `journalctl --user -u 3d-maker-suite`. To start it at boot without logging in: `sudo loginctl enable-linger $USER`. If `pnpm` isn't found, put its full path in `ExecStart` (`which pnpm`).

## Docker

Use this on a NAS or home server that is always on. You need Docker with Compose; you don't need Node.

1. Save [docker-compose.yml](../docker-compose.yml) on the server and set `APP_PASSWORD` in it.
2. Add your project folders as read-only volumes (the commented line in the file), for example `/volume1/3d-files:/projects/files:ro`.
3. Run `docker compose up -d` and open `http://<server-address>:4300`. In Settings → Projects, add the folders by their path **inside the container** (`/projects/files`).

Your data lives in the `app-data` volume (mounted at `/data`: database, key file, thumbnails, backups). Back up that volume. To build the image yourself instead of pulling it, replace `image:` with `build: .` in a clone of the repo.

Images are published to `ghcr.io/emanuelmoniz/3d-maker-suite`: `:X.Y.Z` and `:latest` for stable releases, `:X.Y.Z-alpha.N` and `:dev` for pre-releases. Update with `docker compose pull && docker compose up -d`; migrations run on start, so back up first (see [backups.md](backups.md)).

### What doesn't work in Docker or on a NAS

| Feature | Why | What to do instead |
|---|---|---|
| Open in slicer | A slicer can't run inside the container, and it would open on the server, not on your screen | Hidden automatically. Download the file and open it on your PC |
| Slicing projects | No slicer is installed in the image | Type time and grams per plate, or slice on your PC |
| Local slicer presets | The slicer's config folder lives on your PC, not in the container | [Import a catalog zip](import.md#slicer-catalog-from-a-zip), or mount the config folder into the container and set **Config folder** |
| Live folder watching on network shares | Change events don't arrive over SMB/NFS, and Docker Desktop on Windows/macOS may not forward them | Files are found on startup and on a manual scan; use **Scan folders** after adding files |
| Path picker | Browses the container's folders, so only mounted paths show | Mount the folders you need |
| Reaching the app | The server answers only to its own address unless a password is set | Keep `APP_PASSWORD` set; use HTTPS (a reverse proxy) outside your home network |

Bambu Cloud works the same as on a PC.

## Your PC or a NAS without Docker

You can also run `pnpm start` on a NAS that has Node 22. Set `HOST=0.0.0.0` and `APP_PASSWORD` to reach it from other devices (see [configuration.md](configuration.md#access-from-other-devices)); the limits above apply to it too. On a NAS, the Integrations page shows a local slicer as **Not available on this server** when its config folder isn't there.

## Where your data is

| Setup | Default folder |
|---|---|
| Windows | `%APPDATA%\3d-maker-suite` |
| macOS | `~/Library/Application Support/3d-maker-suite` |
| Linux | `$XDG_DATA_HOME/3d-maker-suite` (or `~/.local/share/3d-maker-suite`) |
| Docker | `/data` (the `app-data` volume) |

The folder holds `app.sqlite`, the encryption key for stored tokens (`secret.key`), project thumbnails and backups. Set `APP_DATA_DIR` to use another folder. Back up this folder to keep your history.

## Updating

The clone starts on `main`, which is always the latest stable release. The app checks GitHub once a day and shows a banner when a new version is out. Open **Settings → About & updates** and click **Update**:

1. The app backs up your data and downloads the release.
2. It restarts. In the terminal you see it switch versions, install and build; this usually takes under a minute. The page reloads by itself.
3. If anything fails, it goes back to the version you had and tells you why.

Every update keeps its backup, and the last 5 updates can be undone there with **Roll back to …**. A rollback restores the backup made before that update, so anything changed since is lost.

**Update channel:** *Stable* gets releases only. *Dev* also gets pre-releases (`-alpha.N`); use it only to test what comes next.

This needs the app started with `pnpm start` from a git clone with no local changes. Otherwise Settings shows the commands to run by hand. In the app's folder, stop the app and run (with the version you want):

```bash
git fetch --tags
git checkout v4.0.0
pnpm install
pnpm start
```

For Docker, see above. New database migrations are applied automatically on start. How it works: [ADR-0009](adr/0009-updates.md).

## Troubleshooting

- **Port already in use:** set another port with `PORT=4400 pnpm start` (PowerShell: `$env:PORT=4400; pnpm start`). In Docker, change the left side of `4300:4300`.
- **`better-sqlite3` fails to install:** use Node 22 LTS; on Linux install the build tools above.
- **Page is blank after an update:** hard-reload the page (`Ctrl+F5`, macOS `Cmd+Shift+R`).
- **Install or update fails on Windows:** we recommend cloning outside OneDrive, Dropbox or other synced folders (sync clients can lock files while `pnpm install` replaces them), and into a short path such as `C:\apps\3d-maker-suite` (very long paths break `pnpm`).
- **Nothing loads from a phone:** see [configuration.md](configuration.md#access-from-other-devices).
