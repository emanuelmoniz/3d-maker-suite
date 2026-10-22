# Configuration

Set these environment variables before `pnpm start` (in Docker, under `environment:` in the compose file). You can also put them in a `.env` file in the project root (it is git-ignored).

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
| `APP_INSTALL` | unset | `docker` in the Docker image: Settings shows `docker compose pull` instead of an Update button |
| `APP_LAUNCHER` | set by `pnpm start` | Tells the server it runs under the launcher, which restarts it and applies updates ([ADR-0009](adr/0009-updates.md)). Don't set it yourself. |

The update channel (Stable or Dev) is in Settings → About & updates; Stable is the default and Dev is for testers. See [install.md](install.md#updating).

## Alerts

The alerts page lists what needs attention. Each alert has a severity (error, warning, success), its module and the task that raised it. Open an alert to see its details, mark it read or unread, snooze it, dismiss it, or jump to its spool, task or integration. Dismissed and snoozed alerts move to the history table on the same page.

- **Per task** (Settings → Alerts): maintenance types set their own warning lead (days, hours or prints) and switch the warning and the overdue error on or off. Spools set the weight below which they are low and whether the low-spool alert is on. Each sync type chooses which of error, review and success it raises.
- **Channels** (Settings → Alerts): send alerts to an ntfy topic or by email (SMTP). The access token and SMTP password are stored encrypted and never shown again; leave them empty to keep them. **Send test** checks a channel before you rely on it.

## Access from other devices

```bash
HOST=0.0.0.0 APP_PASSWORD=choose-a-long-password pnpm start
```

Then open `http://<your-PC-address>:4300` from the other device and enter the password when asked. Use HTTPS (a reverse proxy) if you expose it outside your home network. Without `APP_PASSWORD`, the server rejects requests that are not addressed to `localhost` or `HOST`.

## In-app settings

The Settings page covers general options, appearance, costs (currency, energy, labour, markup, and the printer and accessory defaults), printers, accessories, prints, projects (the folders the app watches, with project depth, files depth and auto slice per folder, and the files-per-project limit), integrations, alerts, backups, language and network. Each module has its own config page, opened from the gear button on that module.

- **Path picker** (slicer executable, slicer config folders, project roots): browses the folders on the machine running the server and lists names only. It never opens or reads a file while you browse. It is not limited to the project roots, because that is how you choose them. Only use it on a server you trust, and set `APP_PASSWORD` before exposing the app beyond this PC.

- **Date and time format** (Settings → General): the date format and 24- or 12-hour clock used across the app.
- **Branding** (Settings → Appearance): the app name, logo and favicon. Leave the name empty for the default.
- **Network** (Settings → Network): the host and port saved for the next start. **Restart and open in new tab** applies them. The page shows when a command-line flag or environment variable is overriding the saved value.
- **Integrations** (Settings → Integrations): slicer config folders and programs belong to their integration. Slicing projects uses the **Slicer program** of the Bambu Studio integration.

These are stored in the database, not in environment variables.
