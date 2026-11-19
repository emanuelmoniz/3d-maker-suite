# Install from source

Run the app from a copy of the code. Use this if you want to change the code or can't use an installer. Most people should use an installer instead.

## Who can use it

Anyone comfortable with a terminal.

## Before you start

You need:

- **Node.js 22 LTS** from <https://nodejs.org>. `node -v` must print `v22.x`.
- **Git**.
- **pnpm.** Turn it on with `corepack enable`. If that is refused, run the terminal as administrator once, or run `npm install -g pnpm`.
- On Linux: `python3`, `make` and `g++` (for example `sudo apt install build-essential python3`). They are only needed if no prebuilt SQLite driver fits your system.

On Windows, clone into a short path such as `C:\apps\3d-maker-suite`, and outside OneDrive or Dropbox. Sync tools can lock files, and very long paths break `pnpm`.

## Install and start

```bash
corepack enable
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

`pnpm start` builds the web app, applies the database migrations and starts the server. Open <http://127.0.0.1:4300>.

Keep the terminal open while you use the app. Updates and restarts from **Settings** happen in it. Stop the app with `Ctrl+C`. Run `pnpm start` again to start it later.

## Start when you sign in

Turn on **Start at login** in the **General** card of **Settings**. It runs `pnpm start` in the app's folder. On Windows a console window opens at login, and closing it stops the app. On macOS and Linux it runs without a window.

## Where your data is kept

| System | Folder |
|---|---|
| Windows | `%APPDATA%\3d-maker-suite` |
| macOS | `~/Library/Application Support/3d-maker-suite` |
| Linux | `$XDG_DATA_HOME/3d-maker-suite`, or `~/.local/share/3d-maker-suite` |

Set `APP_DATA_DIR` to use another folder.

## Updating

The copy starts on `main`, which is the latest stable release.

1. Open **Settings → About & updates**.
2. Click **Update**. The app backs up your data, switches version and restarts. The page reloads by itself.
3. If it fails, it goes back to the version you had and tells you why.

The last 5 updates can be undone with **Roll back to …**. A rollback restores the backup made before that update, so anything changed since is lost.

The update button needs the app started with `pnpm start` from a copy with no local changes. Otherwise **Settings** shows the commands to run by hand. Stop the app, then run these in its folder (use the version you want):

```bash
git fetch --tags
git checkout v4.0.0
pnpm install
pnpm start
```

## Problems and fixes

- **Port already in use.** Use another port: `PORT=4400 pnpm start`. In PowerShell: `$env:PORT=4400; pnpm start`.
- **`better-sqlite3` fails to install.** Use Node 22 LTS. On Linux, install the build tools above.
- **The page is blank after an update.** Reload it with `Ctrl+F5` (`Cmd+Shift+R` on macOS).
- **Install or update fails on Windows.** Move the copy to a short path outside synced folders.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [Install on Windows](Install-on-Windows.md)
- [Install on macOS](Install-on-macOS.md)
- [Install on Linux](Install-on-Linux.md)
