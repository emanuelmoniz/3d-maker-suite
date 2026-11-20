# Troubleshooting

Symptoms and their fixes, and where to find the logs. Each page of this guide also has its own **Problems and fixes** section for its topic.

## Where to find the logs

| Where | What it shows |
|---|---|
| **Settings → Logs** | What the app did, by module and level. Logging is **off** by default. Turn it on with the gear button at the top right of the tab |
| Windows | `logs\server.log` and `logs\launcher.log` in the install folder |
| macOS and Linux | `logs/` in the install folder |
| Docker | `docker compose logs app`, or add `-f` to follow it |
| A source copy | The terminal where you ran `pnpm start` |
| The connector | `logs\` (Windows and Linux) or `install/logs/` (macOS) in its install folder, see [Connector setup](Connector-Setup.md#for-company-it) |

The install folders are listed on the page for your system, for example [Install on Windows](Install-on-Windows.md).

### Turn on the app's log

1. Open **Settings → Logs** and click the gear button.
2. Choose the **Levels to keep**: debug, info, success, warn and error.
3. Choose the **Modules to log**, such as printers, prints, import, integrations and backups.
4. Set **Keep for (days)** (default 14) and **Maximum entries** (default 10,000). Older entries are removed every hour.
5. Do the thing that fails, then reopen the tab and filter by time, level or module.

The log is stored with your data, so a backup includes it. Passwords, tokens and keys are never written to it.

## The app won't start or open

- **The page doesn't open.** Open <http://127.0.0.1:4300> yourself, then check the log of your install, as above.
- **The port is in use.** Another program uses port 4300. Close it, or change the **Port** in **Settings → Network**, or start with another port. See [Configuration](Configuration.md).
- **The app stops at start with `Invalid port`, `Invalid APP_ALLOWED_HOSTS entry` or a similar message.** Fix the value the message names. See [Configuration](Configuration.md#problems-and-fixes).
- **The page is blank after an update.** Reload with `Ctrl+F5` (`Cmd+Shift+R` on macOS).
- **The Docker container keeps restarting.** Run `docker compose logs app` and read the last lines. See [Docker](Docker.md#problems-and-fixes).
- **macOS says the app "can't be opened".** See [Warnings](Install-on-macOS.md#warnings-you-will-see).

## Reaching the app from another device

- **The page doesn't open from a phone or another computer.** Check the network, that the host is `0.0.0.0`, and the firewall. See [Use from another device](Use-From-Another-Device.md#problems-and-fixes).
- **`403 forbidden_host`.** The app doesn't know the address you typed. Add it to `APP_ALLOWED_HOSTS` and restart.
- **Everybody is locked out after a few wrong passwords.** Behind a reverse proxy, set `APP_TRUST_PROXY`. See [Public access](Public-Access.md#problems-and-fixes).
- **It worked yesterday and not today.** The computer's address changed. Give it a fixed address.

## Signing in

- **The page asks for a setup token.** It is printed in the console of the app, or in `docker compose logs app`, while no account exists. See [First run](First-Run.md#find-the-setup-token).
- **I can't find the token.** Restart the app and read the console again. It only prints while no account exists.
- **I forgot the admin password.** Reset it from the server's shell with `pnpm user:reset-password you@example.com`, in Docker `docker compose exec app pnpm user:reset-password you@example.com`. The new password is printed once. Sign in with it and change it under [My account](My-Account.md#name-and-password).
- **"Your role can't change this."** You opened a form by its address or from a bookmark, and your role may read that item but not change it. The app opened the item's page, or its list, instead. Ask an admin for the right, see [Roles](Roles.md).
- **"You can't open this"**, with a link to the dashboard. Your role has no right to that module or admin page at all, for example Settings → Users for a Viewer. Ask an admin if you need it.
- **"This doesn't exist, or you can't open it."** The item was deleted, or your role may not see it, for example another person's alert, someone else's computer or a private project. The app shows the same text for both, so it doesn't tell what exists. Open it from its list.
- **"Your role doesn't allow that. Ask an admin if you need it."** The server refused a change your role can't make. Nothing was saved. Ask an admin for the right.

## Updates and backups

- **The update failed and the app went back.** Read the step named in the message, then the **Logs**. See [Updates](Updates.md#problems-and-fixes).
- **"The app's folder has local changes."** A source copy with edited files can't switch version. Undo the changes, or update by hand.
- **A restore didn't happen.** It applies on the next start. Restart the app. See [Backups and restore](Backups-and-Restore.md#problems-and-fixes).
- **Saved logins ask to be set up again after a restore.** The backup was made without its key. Add the integration again.
- **Project files are missing after a restore.** Backups don't hold project files. Mount the folders again and use **Change project folder…**.

## Printers, sources and sync

- **A source says it is signed out.** Sign in again on its card in **Settings → Integrations**. Bambu Cloud sign-ins last about 3 months.
- **A sync failed.** Open the line's **⋯** menu, then the sync log, and read the message. A failed sync raises an alert.
- **Nothing syncs on its own.** The line's switch is off, or its mode is **Manual**. See [Sources and sync](Sources-and-Sync.md#auto-and-manual-sync).
- **A printer shows Offline.** It is off, off the network, or the address is wrong. Check it and its integration's address.
- **A printer shows Source error.** The source refuses the access code or key. Choose **Edit in Integrations** and enter it again.
- **There is no Sync button.** No source has that data type on **Auto**, or your role can't run syncs.
- **I can't delete something.** It is still in use. See [Archive and delete](Archive-and-Delete.md).

## The hub and computers

- **No Hub management tab.** The hub is off, or you aren't an admin. See [Hub setup](Hub-Setup.md#problems-and-fixes).
- **The connector can't reach the hub.** Check the address and that the hub is running. See [Connector setup](Connector-Setup.md#problems-and-fixes).
- **A computer shows Offline.** The connector is stopped, the computer is asleep, or it can't reach the hub.
- **A project shows twice.** Two connectors index the same shared folder. Keep only one.

## If nothing here helps

1. Turn the app's log on, repeat the problem, and read the entries around it.
2. Check the [FAQ](FAQ.md).
3. Open an issue on GitHub with the bug report template. Say your version (**Settings → About & updates**), how you run the app, what you did and what you saw. Leave out passwords, tokens and keys.

## Related pages

- [FAQ](FAQ.md)
- [Glossary](Glossary.md)
- [Updates](Updates.md)
- [Backups and restore](Backups-and-Restore.md)
