# Users and roles

By default there is no login: anyone who can reach the app has full access. That is fine for one PC. When the app runs on a LAN, a NAS or in Docker, create accounts so that each person signs in and the logs show who did what.

## Create the first admin

1. Start the app. Until an account exists, the server prints a **setup token** in its console (in Docker, run `docker compose logs app`).
2. Open the app. On this PC, the setup page opens directly. From another device, enter the setup token it asks for. Setup from a public domain behind a reverse proxy ([configuration.md](configuration.md#behind-a-reverse-proxy)) still needs the token.
3. Enter your email, name and a password of at least 8 characters. This account is an admin.

Until the first account exists, anyone who can open the page can create it. Do this right after the first start, before the app is reachable from your network.

## Roles

A role is a set of permissions. Each user has one role, and gets what it allows. Manage roles under **Settings → Roles**.

Three roles come built in:

| Role | Can do |
|---|---|
| **Viewer** | Read every module: printers, maintenance, filament, projects, prints, quotes, orders, clients, stats, alerts. |
| **Editor** | Write every module: the day-to-day data (spools, prints, projects, quotes, orders, clients, tags), maintenance done and accessory installs. Run syncs and review imports where allowed (see below). |
| **Admin** | Everything. The Admin role can't be changed, disabled or deleted. |

Everyone, viewers included, marks their own alerts read, snoozes and dismisses them, and changes their own display preferences (language, units, date and time format, theme, accent).

Editor and Viewer are ordinary roles: rename them, change their permissions, disable them, or delete them once nobody has them. **New role** starts from a copy of an existing role. Changes apply to the role's users right away. While a role is disabled, its users can't sign in.

### Permissions

Modules have four steps: **None** (hidden), **Read**, **Write** and **Manage**.

| Module | Write | Manage |
|---|---|---|
| Printers and accessories | Log accessory installs | Add and edit printers and accessories |
| Maintenance | Log work done | Edit the tasks and types |
| Filament | Add and edit spools | Archive and delete many spools at once |
| Projects | Add and edit projects and their files | Set up the project folders |
| Prints | Log and edit prints | Change print settings |
| Quotes, orders and clients | Make quotes and orders | Change rates, currency and order statuses |
| Catalog | Delete and restore hub presets, clean up conflict copies and held deletes, set what each workstation sends and installs | Add, edit, archive and delete brands, models, materials and profiles, and their import settings in Integrations |

With **Catalog** at Read, a user sees the catalog and the slicer presets. The printer, spool and print forms read brands, models, materials and profiles with Printers or Filament read too, and the presets are readable with Projects read.

**Stats** is None or Read. The rest are on or off:

- **Run syncs** and **Review imports**: only the integration tasks set to allow them (see below).
- **Set up integrations**: add, sign in and configure integrations and slicers.
- **Manage the hub**: pair and edit workstations, change hub settings.
- **Server and updates**, **Backups** (make, download, delete; only the Admin role restores one), **Logs**, **Branding**, **Alert settings** (thresholds, email and ntfy).
- **Users and roles**: add and edit users and roles.

### Projects of others

- **See everyone's projects.** Off: only the projects they own.
- **Edit everyone's projects.** Needs Projects write. Off: only their own; the others are download only.
- **Edit files on other workstations.** Change files in folders shared from someone else's workstation ([hub.md](hub.md#owners-and-permissions)).

Admin, Editor and Viewer see everyone's projects. Admin and Editor edit them. Only Admin edits files on other workstations.

### Give one user more or less

Open a user under **Settings → Users** to change any permission or project right for that user only. **Same as role** follows the role, also when the role changes later. Each row shows the user's value and the role's.

Admin-role users have every permission; the only thing to change for them is **Edit files on other workstations**.

### Who can manage whom

- Someone with **Users and roles** who isn't in the Admin role can't give more than they have: every step they pick, in a role or for a user, is at most their own.
- Only Admin-role users change admin accounts or move someone into or out of the Admin role.
- Nobody changes their own role, rights or state. Another user manager does.
- The app keeps at least one enabled admin: you can't disable, demote or delete the last one.

### Upgrading from fixed roles (before 5.1.0)

Each user keeps their role: admins become Admin, editors Editor, viewers Viewer, with the same rights as before. The old per-user switches (sees all projects, edits other people's projects, edits files on other people's devices) become overrides only where they differed from the new role's value. Nothing to do after the update.

## Integration tasks

People with **Set up integrations** set up integrations. They can also allow single tasks per data type (for example, spools but not prints), in the integration's **Editors** settings:

- **Can sync now**: users with **Run syncs** may run that task's sync.
- **Can review and import**: users with **Review imports** may review and import what that task brings in.

Both are off by default. A user with Run syncs or Review imports, but not Set up integrations, sees the Integrations page with only the allowed tasks, and no account, slicer or setup settings. Alerts show the sync or review button only for those tasks.

## Alerts are per person

Each person marks alerts read, snoozes or dismisses them for themselves. Other people still see the alert until they do the same. When the cause is fixed (maintenance done, a review finished, a spool's price or open date filled in), the alert resolves for everyone.

Which alerts a person gets is set per role (Off, In app or Notify) and can be overridden on their user page. **My account** in the account menu has their own alert choices and where Notify alerts are sent (email, ntfy). See [alerts.md](alerts.md).

## Manage users

People with **Users and roles** open **Settings → Users** to add people, change their role or rights, disable an account or reset a password. Disabling an account or resetting its password signs that person out everywhere. A change of role or rights applies at once, without signing them out.

Each person changes their own name and password under **My account** in the account menu.

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
