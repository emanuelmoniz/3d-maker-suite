# Install and first run

Pick your setup: [Windows](#windows), [macOS](#macos), [Linux](#linux) or [Docker](#docker) (NAS and home servers).

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

`pnpm start` builds the web app, applies database migrations and starts the server. Open <http://127.0.0.1:4300>. Stop it with `Ctrl+C`; run `pnpm start` again to launch it later.

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

```bash
git pull
pnpm install
pnpm start
```

For Docker, see above. New database migrations are applied automatically on start. Make a backup first (see [backups.md](backups.md)).

## Troubleshooting

- **Port already in use:** set another port with `PORT=4400 pnpm start` (PowerShell: `$env:PORT=4400; pnpm start`). In Docker, change the left side of `4300:4300`.
- **`better-sqlite3` fails to install:** use Node 22 LTS; on Linux install the build tools above.
- **Page is blank after an update:** hard-reload the page (`Ctrl+F5`, macOS `Cmd+Shift+R`).
- **Nothing loads from a phone:** see [configuration.md](configuration.md#access-from-other-devices).
