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
