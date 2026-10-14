# Install and first run

## Requirements

- Node.js 22 LTS (`node -v` should print `v22.x`)
- pnpm (the version is pinned in `package.json`; with Corepack enabled, `corepack enable` is enough)
- Windows 10/11, macOS or Linux

## Steps

```bash
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

`pnpm start` builds the web app, applies database migrations and starts the server. Open <http://127.0.0.1:4300>.

Stop the server with `Ctrl+C`. Run `pnpm start` again to launch it later.

## Your PC or a NAS

The app runs on the computer that stores the data, which is your PC by default. You can also run it on a NAS or home server that is always on, and open it from any device on your network.

| | Your PC | NAS or home server |
|---|---|---|
| Start | `pnpm start` | `pnpm start` with Node 22 on the NAS |
| Reach it from | this PC only (`127.0.0.1`) | other devices (`HOST=0.0.0.0` and `APP_PASSWORD`, see [configuration.md](configuration.md#access-from-other-devices)) |
| Open in slicer | works when the slicer is installed on the server | hidden: no slicer runs on the server |
| Local slicer presets | read from the slicer's config folder on the server | not available unless that folder is on the server; otherwise [import a catalog zip](import.md#slicer-catalog-from-a-zip) |
| Project folders | folders on the server | folders the server can see, so mount network shares on it |
| Bambu Cloud | works | works |

On a NAS, the Integrations page shows a local slicer as **Not available on this server** when its config folder isn't there. Mount the folder on the server, then set **Config folder** to its path in that integration. Or zip the folder on your PC and import the catalog, as described in [import.md](import.md#slicer-catalog-from-a-zip).

## Where your data is

| OS | Default folder |
|---|---|
| Windows | `%APPDATA%\3d-maker-suite` |
| macOS | `~/Library/Application Support/3d-maker-suite` |
| Linux | `$XDG_DATA_HOME/3d-maker-suite` (or `~/.local/share/3d-maker-suite`) |

The folder holds `app.sqlite`, the encryption key for stored tokens (`secret.key`), project thumbnails and backups. Set `APP_DATA_DIR` to use another folder. Back up this folder to keep your history.

## Updating

```bash
git pull
pnpm install
pnpm start
```

New database migrations are applied automatically on start. Make a backup first (see [backups.md](backups.md)).

## Troubleshooting

- **Port already in use:** set another port with `PORT=4400 pnpm start` (PowerShell: `$env:PORT=4400; pnpm start`).
- **Page is blank after an update:** hard-reload the page (`Ctrl+F5`).
- **Nothing loads from a phone:** see [configuration.md](configuration.md#access-from-other-devices).
