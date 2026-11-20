# Install on Linux

Use the archive (`.tar.gz`). It brings its own Node, so you don't need Node, pnpm or Git.

## Who can use it

Anyone with a 64-bit Linux computer that has a desktop: x64 (Intel or AMD), or ARM64, such as a Raspberry Pi 4 or 5 with Raspberry Pi OS (64-bit). Slicing isn't available on ARM.

## Download

1. Open the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) and pick the newest release.
2. Download `3d-maker-suite-<version>-linux-x64.tar.gz`, or `3d-maker-suite-<version>-linux-arm64.tar.gz` on an ARM64 computer. `<version>` is the release tag, such as `v4.1.0`. `uname -m` tells which you have: `x86_64` is x64, `aarch64` is ARM64.
3. Optional: check the file. Download `SHA256SUMS` from the same release into the same folder and run `sha256sum -c SHA256SUMS`.

## Install

1. Unpack the archive:

```bash
tar -xzf 3d-maker-suite-<version>-linux-x64.tar.gz
```

2. Go into the unpacked folder and run the install script:

```bash
cd <the unpacked folder>
./install.sh
```

The script copies the app to `~/.local/share/3d-maker-suite/install` and adds **3D Maker Suite** to your application menu. It needs no administrator rights. Running a newer `install.sh` updates the install.

Linux shows no warning.

## First start

1. Open **3D Maker Suite** from your application menu. Or run the command the script printed at the end.
2. Your browser opens on a **Starting 3D Maker Suite…** page. When the app is ready, it goes to <http://127.0.0.1:4300>.
3. The first screen of the app appears. There is no window to keep open.
4. Create the admin account. See [First run](First-Run.md).

## Stop the app

Open **Settings** and click **Stop server** at the top right.

## Start when you sign in

Turn on **Start at login** in the **General** card of **Settings**. It adds an autostart `.desktop` file for your user. An app started this way runs in the background and doesn't open the browser.

## Where things are kept

| What | Where |
|---|---|
| The program | `~/.local/share/3d-maker-suite/install` |
| Logs | `logs/` in the install folder |
| Your data (database, key file, thumbnails, backups) | `$XDG_DATA_HOME/3d-maker-suite`, or `~/.local/share/3d-maker-suite` if that is not set |

Uninstalling removes the program and keeps your data. Back up the data folder to keep your history.

## Updating

Open **Settings → About & updates**. The app also shows a banner when a new version is out. An ARM64 computer gets the ARM64 release file.

## Problems and fixes

- **The menu entry doesn't show up.** Sign out and in again, or start the app with the command the script printed.
- **The page doesn't open.** Open <http://127.0.0.1:4300> yourself. Check the logs in the install folder.
- **The page is blank after an update.** Reload it with `Ctrl+F5`.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [First run](First-Run.md)
- [Install from source](Install-from-Source.md)
