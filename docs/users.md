# Users and roles

By default there is no login: anyone who can reach the app has full access. That is fine for one PC. When the app runs on a LAN, a NAS or in Docker, create accounts so that each person signs in and the logs show who did what.

## Create the first admin

1. Start the app. Until an account exists, the server prints a **setup token** in its console (in Docker, run `docker compose logs app`).
2. Open the app. On this PC, the setup page opens directly. From another device, enter the setup token it asks for.
3. Enter your email, name and a password of at least 8 characters. This account is an admin.

Until the first account exists, anyone who can open the page can create it. Do this right after the first start, before the app is reachable from your network.

## Roles

| Role | Can do |
|---|---|
| **Viewer** | See everything: printers, filament, projects, prints, quotes, orders, clients, stats, alerts. Mark alerts read or unread, snooze and dismiss them. Change their own display preferences (language, units, date and time format, theme, accent). |
| **Editor** | Everything a viewer can, plus add and change the day-to-day data: spools, prints, projects, quotes, orders, clients, tags, alerts. Log maintenance done and accessory installs. Run the integration tasks an admin allowed (see below). |
| **Admin** | Everything, including users, server settings (network, autostart, restart, stop), updates, backups and restores, import, integrations setup, alert channels, logs, branding, and the module settings (printers, accessories, maintenance types, catalogs, costs and workflow). |

The app keeps at least one enabled admin: you can't disable, demote or delete the last one.

## Integration tasks for editors

Admins set up integrations. They can also let an editor run single tasks, per data type (for example, spools but not prints):

- **Sync now**: the editor may run that task's sync.
- **Review**: the editor may review and import what that task brings in.

Both are off by default. An editor with at least one of them sees the Integrations page with only those tasks, and no account, slicer or setup settings. Alerts show the sync or review button only for the tasks they're allowed.

## Alerts are per person

Each person marks alerts read, snoozes or dismisses them for themselves. Other people still see the alert until they do the same. When the cause is fixed (maintenance done, a review finished, a spool's price or open date filled in), the alert resolves for everyone.

## Manage users

Admins open **Settings → Users** to add people, change their role, disable an account or reset a password. Disabling an account, changing its role or resetting its password signs that person out everywhere.

Each person changes their own name and password under **Settings → My account**.

## Logs

With logging on, each entry of a request shows the user who made it. Background jobs (such as an automatic sync) have no user.

## From another device (LAN, NAS, Docker)

Set the host to `0.0.0.0` and sign in from the other device with your account. You no longer need a shared password. See [configuration.md](configuration.md#access-from-other-devices).

**Moving from `APP_PASSWORD`:** the shared password is ignored once an account exists, and the server warns about it at start. Create your accounts, sign in once to check, then remove `APP_PASSWORD` from your environment or `docker-compose.yml`.

## Forgot the admin password

Reset it from the server's shell. The new password is printed once; sign in with it and change it under **My account**. The command ends that user's sessions.

```bash
pnpm user:reset-password you@example.com
```

In Docker:

```bash
docker compose exec app pnpm user:reset-password you@example.com
```

Anyone who can run this command already has full access to the data, so it doesn't open anything new.
