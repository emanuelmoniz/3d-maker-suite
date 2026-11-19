# Configuration

Every environment variable, command-line flag and setting that changes how the server starts, with its default.

## Who can use it

Whoever runs the app: you on a PC, or the person who looks after the server or NAS. Settings inside the app need the right for **Settings → Network**.

## Where to set things

Each setting can come from up to four places. When more than one is set, the first one in this list wins:

1. A command-line flag (only `--host` and `--port`).
2. An environment variable.
3. The value saved in **Settings → Network** (only host, port and public address).
4. The default.

**Settings → Network** shows when a flag or an environment variable overrides the saved value.

How to set an environment variable:

| How you run it | Where |
|---|---|
| `pnpm start` on macOS or Linux | In front of the command: `HOST=0.0.0.0 pnpm start` |
| `pnpm start` in PowerShell | `$env:HOST="0.0.0.0"; pnpm start` |
| Docker | Under `environment:` in the compose file, then `docker compose up -d` again. See [Docker](Docker.md) |
| The installed app | Set it for your user in the system's environment settings, then restart the app |

The server does not read a `.env` file.

For a one-off run from source with flags:

```bash
pnpm --filter @3d-maker-suite/server start -- --port 4400 --host 0.0.0.0
```

## Variables you can set

| Variable | Default | What it does |
|---|---|---|
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | The address the app listens on. Change it to reach the app from other devices. Also a flag, `--host`, and **Host** in **Settings → Network** |
| `PORT` | `4300` | The port. 1 to 65535. Also a flag, `--port`, and **Port** in **Settings → Network** |
| `APP_DATA_DIR` | See [Where your data is kept](#where-your-data-is-kept) (`/data` in Docker) | The folder for the database, thumbnails, backups and `secret.key` |
| `APP_PASSWORD` | Not set | One shared password, asked as HTTP Basic sign-in with any user name. Used only until the first account exists, or while **User accounts** is off. See [Use from another device](Use-From-Another-Device.md) |
| `APP_ALLOWED_HOSTS` | Not set | Public host names that a reverse proxy forwards, separated by commas. Bare names or IPs only: no `http://`, port, path or wildcard. IPv6 goes in brackets. Matches are exact. Only read at start |
| `APP_PUBLIC_URL` | Not set | The address that links in alert emails and ntfy messages point to, for example `https://3d.example.com`. Must start with `http://` or `https://`. A trailing slash is dropped. It wins over **Public address** in **Settings → Network**, which then shows as fixed |
| `APP_TRUST_PROXY` | Not set | The IPs or CIDR ranges of your reverse proxies, separated by commas, for example `127.0.0.1` or `172.16.0.0/12`. The app then reads the client's address from `X-Forwarded-For`. Addresses only, not `true` or a number |
| `APP_MOCK_INTEGRATION` | Not set | `1` adds a fake integration, to try **Integrations** without an account |
| `APP_INSTALL` | Not set | Set by the install: `docker` in the Docker image, `bundle` in the installed app. In Docker, **Settings** shows `docker compose pull` instead of an **Update** button |

A bad value for `PORT`, `APP_ALLOWED_HOSTS`, `APP_PUBLIC_URL` or `APP_TRUST_PROXY` stops the app at start, with a message that says what is wrong.

## Variables set for you

Don't set these. The launcher and the installer set them.

| Variable | Set by | What it does |
|---|---|---|
| `APP_LAUNCHER` | `pnpm start`, the installed app | Says the server runs under the launcher, which restarts it and applies updates |
| `APP_LAUNCH_CMD` | `pnpm start`, the installed app | The command that **Start at login** registers |
| `APP_INSTALL_DIR` | The installed app | The folder with the installed versions |
| `APP_SHIPPED_VERSION` | The macOS app | The version inside the `.app`, so it can be restored |
| `APP_RELEASES_URL` | Nobody | Only for testing updates against local builds. A web address that answers like GitHub's releases list |

## Where your data is kept

If `APP_DATA_DIR` isn't set, the folder is:

| System | Folder |
|---|---|
| Windows | `%APPDATA%\3d-maker-suite` |
| macOS | `~/Library/Application Support/3d-maker-suite` |
| Linux | `$XDG_DATA_HOME/3d-maker-suite`, or `~/.local/share/3d-maker-suite` |
| Docker | `/data`, the volume or folder you mount |

The folder holds the database, thumbnails, backups, the saved host, port and public address (`config.json`), and `secret.key`, which protects saved logins. Keep it private.

## Settings stored in the app

Everything else is a setting in the app, stored in the database. It is not an environment variable, and it moves with a backup.

- **Settings → Network:** host, port and public address. **Restart server** and **Stop server** are at the top right of **Settings**.
- **Settings → General:** date and time format, tags, **User accounts**, **Hub** and **Start at login**.
- **Settings → Branding:** the app name, logo and favicon.
- **Settings → About & updates:** the update channel, **Stable** or **Dev**. Stable is the default.
- Each module's own settings: costs, printers, projects, prints, alerts, integrations and more.

## Limits and tips

- Changes to host and port apply after a restart.
- `APP_ALLOWED_HOSTS`, `APP_TRUST_PROXY` and `APP_PASSWORD` are deployment choices. They are environment only, so nobody can change them from the browser.
- The setup token isn't a setting. The app makes a new one at each start until the first account exists, see [First run](First-Run.md#find-the-setup-token).

## Problems and fixes

- **The app stops at start with `Invalid port`, `Invalid APP_ALLOWED_HOSTS entry`, `Invalid APP_PUBLIC_URL` or `Invalid APP_TRUST_PROXY entry`.** Fix the value the message names.
- **A change in Settings → Network has no effect.** A flag or an environment variable is overriding it. The page says which. Change or remove that one.
- **A variable has no effect in Docker.** Run `docker compose up -d` again after you edit the compose file. A restart alone keeps the old values.
- **A variable has no effect from a `.env` file.** The server doesn't read one. Set the variable in the shell or in the compose file.

## Related pages

- [First run](First-Run.md)
- [Use from another device](Use-From-Another-Device.md)
- [Docker](Docker.md)
- [Server and remote access](Server-and-Remote-Access.md)
- [Install from source](Install-from-Source.md)
