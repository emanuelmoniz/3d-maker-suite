# Install on macOS

Use the disk image (`.dmg`). It needs no Node, pnpm or Git.

## Who can use it

Anyone with a Mac. Apple silicon and Intel Macs each have their own file.

## Download

1. Open the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) and pick the newest release.
2. Download the file for your Mac. `<version>` is the release tag, such as `v4.1.0`.

| Mac | File |
|---|---|
| Apple silicon (M1 and newer) | `3d-maker-suite-<version>-macos-arm64.dmg` |
| Intel | `3d-maker-suite-<version>-macos-x64.dmg` |

3. Not sure which Mac you have? Open the Apple menu, then **About This Mac**. It shows an Apple chip (M1 or newer) or an Intel processor.
4. Optional: check the file. Compare its SHA-256 with `SHA256SUMS` from the same release by running `sha256sum -c SHA256SUMS` in Terminal.

## Install

1. Open the `.dmg`.
2. Drag **3D Maker Suite** onto **Applications**.

## Warnings you will see

The app is not code-signed, because a certificate costs money every year. macOS 15 says it **can't be opened**. You only need to do this once:

1. Open the app once, so macOS records it.
2. Go to **System Settings → Privacy & Security**.
3. Scroll down and click **Open Anyway**.

Or run this in Terminal instead:

```bash
xattr -dr com.apple.quarantine "/Applications/3D Maker Suite.app"
```

Ctrl-click and **Open** no longer works on macOS 15. Updates downloaded inside the app don't show this again.

## First start

1. Open **3D Maker Suite** from Applications.
2. Your browser opens on a **Starting 3D Maker Suite…** page. When the app is ready, it goes to <http://127.0.0.1:4300>.
3. The first screen of the app appears. There is no window to keep open.

## Stop the app

Open **Settings** and click **Stop server** at the top right.

## Start when you sign in

Turn on **Start at login** in the **General** card of **Settings**. It adds a LaunchAgent for your user. An app started this way runs in the background and doesn't open the browser.

## Where things are kept

| What | Where |
|---|---|
| The program | `/Applications/3D Maker Suite.app`, plus `~/Library/Application Support/3d-maker-suite/install` |
| Logs | `logs/` in the install folder |
| Your data (database, key file, thumbnails, backups) | `~/Library/Application Support/3d-maker-suite` |

Uninstalling removes the program and keeps your data. Back up the data folder to keep your history.

## Updating

Open **Settings → About & updates**. The app also shows a banner when a new version is out.

## Problems and fixes

- **"Can't be opened".** See [Warnings](#warnings-you-will-see).
- **The page doesn't open.** Open <http://127.0.0.1:4300> yourself.
- **The page is blank after an update.** Reload it with `Cmd+Shift+R`.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [Install from source](Install-from-Source.md)
