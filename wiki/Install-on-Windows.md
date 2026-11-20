# Install on Windows

Use the installer. It needs no Node, pnpm or Git, and no administrator rights.

## Who can use it

Anyone with a 64-bit Windows PC.

## Download

1. Open the [releases page](https://github.com/emanuelmoniz/3d-maker-suite/releases) and pick the newest release.
2. Download `3d-maker-suite-<version>-windows-x64-setup.exe`. `<version>` is the release tag, such as `v4.1.0`.
3. Optional: check the file. Compare its SHA-256 with `SHA256SUMS` from the same release. In PowerShell, run `Get-FileHash` on the file.

## Install

1. Double-click the file. Windows may show a warning (see [Warnings](#warnings-you-will-see)).
2. Choose if you want a desktop icon, and **Start 3D Maker Suite when I sign in**. Both are optional.
3. Finish the setup. It installs for your user only, in `%LOCALAPPDATA%\Programs\3D Maker Suite`.

## Warnings you will see

The installer is not code-signed, because a certificate costs money every year. Windows shows **Windows protected your PC** (SmartScreen) once.

1. Click **More info**.
2. Click **Run anyway**.

Updates downloaded inside the app don't show this again.

## First start

1. Open **3D Maker Suite** from the Start menu or the desktop icon.
2. Your browser opens on a **Starting 3D Maker Suite…** page. When the app is ready, it goes to <http://127.0.0.1:4300>.
3. The first screen of the app appears. There is no window to keep open.
4. Create the admin account. See [First run](First-Run.md).

Starting it again just opens the browser again.

## Stop the app

Open **Settings** and click **Stop server** at the top right.

## Start when you sign in

Turn on **Start at login** in the **General** card of **Settings**, or tick the box in the installer. It adds an entry for your user. An app started this way runs in the background and doesn't open the browser.

## Where things are kept

| What | Where |
|---|---|
| The program | `%LOCALAPPDATA%\Programs\3D Maker Suite` |
| Logs | `logs\server.log` and `logs\launcher.log` in that folder |
| Your data (database, key file, thumbnails, backups) | `%APPDATA%\3d-maker-suite` |

Uninstalling removes the program and keeps your data. Back up the data folder to keep your history.

## Updating

Open **Settings → About & updates**. The app also shows a banner when a new version is out.

## Problems and fixes

- **The page doesn't open.** Open <http://127.0.0.1:4300> yourself. Check `logs\launcher.log` in the install folder.
- **Port 4300 is in use.** Another program uses it. Close that program, or change the **Port** in **Settings → Network**.
- **The page is blank after an update.** Reload it with `Ctrl+F5`.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [First run](First-Run.md)
- [Install from source](Install-from-Source.md)
