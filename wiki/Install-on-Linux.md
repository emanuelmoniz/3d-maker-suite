# Install on Linux

Use the archive (`.tar.gz`). It brings its own Node, so you don't need Node, pnpm or Git.

## Who can use it

Anyone with a 64-bit (x64) Linux computer that has a desktop.

## Download

1. Open the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) and pick the newest release.
2. Download `3d-maker-suite-<version>-linux-x64.tar.gz`. `<version>` is the release tag, such as `v4.1.0`.
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

## Stop the app

Go to **Settings → Network** and click **Stop server**.

## Start when you sign in

Turn on **Start at login** in **Settings → Network**. It adds an autostart `.desktop` file for your user. An app started this way runs in the background and doesn't open the browser.

## Where things are kept

| What | Where |
|---|---|
| The program | `~/.local/share/3d-maker-suite/install` |
| Logs | `logs/` in the install folder |
| Your data (database, key file, thumbnails, backups) | `$XDG_DATA_HOME/3d-maker-suite`, or `~/.local/share/3d-maker-suite` if that is not set |

Uninstalling removes the program and keeps your data. Back up the data folder to keep your history.

## Updating

Open **Settings → About & updates**. The app also shows a banner when a new version is out.

## Problems and fixes

- **The menu entry doesn't show up.** Sign out and in again, or start the app with the command the script printed.
- **The page doesn't open.** Open <http://127.0.0.1:4300> yourself. Check the logs in the install folder.
- **The page is blank after an update.** Reload it with `Ctrl+F5`.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [Install from source](Install-from-Source.md)
