# Configuration

Set these environment variables before `pnpm start`. You can also put them in a `.env` file in the project root (it is git-ignored).

`HOST` and `PORT` can also be set in **Settings → Network** and as command-line flags. Precedence: flag, then environment variable, then the saved setting, then the default. For a one-off run with a flag:

```bash
pnpm --filter @3d-maker-suite/server start -- --port 4400 --host 0.0.0.0
```

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4300` | HTTP port |
| `HOST` | `127.0.0.1` | Address to listen on. Only change this to reach the app from other devices. |
| `APP_DATA_DIR` | see [install.md](install.md#where-your-data-is) | Where the database, thumbnails, backups and key file live |
| `APP_PASSWORD` | unset | HTTP Basic password. Required when `HOST` is not a loopback address. Any user name works. |
| `APP_MOCK_INTEGRATION` | unset | Set to `1` to add a fake integration for trying the Integrations page without an account |

## Access from other devices

```bash
HOST=0.0.0.0 APP_PASSWORD=choose-a-long-password pnpm start
```

Then open `http://<your-PC-address>:4300` from the other device and enter the password when asked. Use HTTPS (a reverse proxy) if you expose it outside your home network. Without `APP_PASSWORD`, the server rejects requests that are not addressed to `localhost` or `HOST`.

## In-app settings

The Settings page covers general options, appearance, costs (currency, energy, labour, markup), printers, prints, projects (the folders the app watches), integrations, alerts, backups, language and network.

- **Branding** (Settings → Appearance): the app name, logo and favicon. Leave the name empty for the default.
- **Network** (Settings → Network): the host and port saved for the next start. **Restart and open in new tab** applies them. The page shows when a command-line flag or environment variable is overriding the saved value.
- **Integrations** (Settings → Integrations): slicer config folders and executables belong to their integration.

These are stored in the database, not in environment variables.
