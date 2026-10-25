# ADR-0012: Users, sessions and fixed roles

- Status: Accepted (supersedes the "no login" part of ADR-0001)
- Date: 2026-10-24

## Context
ADR-0001 bound the app to 127.0.0.1 with no login. Since then it runs on a LAN (`HOST=0.0.0.0`) and in Docker on a NAS, guarded by one shared `APP_PASSWORD` (HTTP Basic). A shared password can't tell people apart: everyone can change server settings, restore a backup or wipe the logs, and the logs can't say who did what. A household or a small print shop needs a few accounts with different rights, without an identity provider or a new dependency.

## Decision

### Data
- `users`: id, email (unique, compared lower-cased), display name, password hash, role `admin | editor | viewer`, disabled, created at, last login at.
- `sessions`: sha256 of the token, user id, expires at. The token itself is never stored.
- `user_settings`: user id, key, value. Same shape as `settings`, for the per-user display keys below.
- `logs.actor`: the user id behind a request line (null for background jobs and the no-users mode).
- Passwords: scrypt from `node:crypto` with a random salt per user, compared with `timingSafeEqual` (`lib/password.ts`).
- The zod `userSchema` has no hash field, so the API can't return one by mistake.

### Session
- Login creates a random 32-byte token, sent as a cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the request came over HTTPS (directly or via `X-Forwarded-Proto` from a reverse proxy).
- 30-day sliding expiry: a request in the last half of the window extends it. Logout deletes the row. Expired rows are pruned by the existing hourly job.
- Cookie parse/set is a few lines in `lib/session.ts`; no `@fastify/cookie` or session plugin.
- `SameSite=Lax` plus "writes are never GET" is the CSRF protection: a cross-site form POST carries no cookie.

### Modes and first run
- **No users** (every install until someone sets one up): today's behaviour. Loopback/host guard, and `APP_PASSWORD` Basic auth when set.
- **Setup**: `POST /api/auth/setup` creates the first admin. It is allowed only while the `users` table is empty, and only when one of these holds:
  - the request comes from loopback,
  - it carries the current `APP_PASSWORD`,
  - it carries the one-time setup token the server prints to the console at boot while no users exist (Docker: `docker logs`). A new token each boot; never written to the `logs` table.
- **Users exist**: every request needs a session, except the public routes below. `APP_PASSWORD` is ignored, with a warning at boot telling the admin to remove it. The host guard stays on for loopback binds (DNS rebinding).
- Lost admin password: a `pnpm` script (and the same command in the Docker image) resets a named user's password from the server's shell. Shell access to the data dir already means full access, so this opens nothing new.

### Permissions
One `onRequest` hook in `lib/auth.ts` replaces `accessGuard`. It looks up the request's prefix in its own table (not `moduleOf()`, which groups fs, updates and logs under "system" for the Logs page) and compares the user's role with what the method needs.
- **Viewer**: GET/HEAD only, on the prefixes marked R below.
- **Editor**: everything except the admin-only prefixes and keys.
- **Admin**: everything.
- Anything not in the table needs admin. A new prefix is admin-only until someone adds it here.

R = GET/HEAD, W = POST/PUT/PATCH/DELETE, - = 403.

| Prefix | Viewer | Editor | Admin | Notes |
|---|---|---|---|---|
| static files, SPA shell | public | public | public | the login page has to load |
| `/api/health` | public | public | public | Docker healthcheck |
| `/api/auth/setup`, `/api/auth/login` | public | public | public | setup only while no users exist; login rate-limited |
| `/api/auth/logout`, `/api/auth/me` | R W | R W | R W | any session; `me` also changes your own name and password |
| `/api/printers`, `/api/accessories`, `/api/maintenance` | R | R, W accessory installs/removals (`/accessories/:id/installs`) and `POST /maintenance/tasks` (log done) | R W | adding and editing printers, accessories and maintenance types is setup, so admin-only |
| `/api/brands`, `/api/printer-models`, `/api/machine-profiles`, `/api/filament-brands`, `/api/filament-materials`, `/api/print-profiles` | R | R | R W | catalogs belong to the module settings |
| `/api/filament` | R | R W, but `/profiles` is R | R W | spools are daily work, profiles are setup |
| `/api/projects` (files, trash, slicing, scan, open) | R | R W | R W | `/:id/open` starts the slicer on the server machine |
| `/api/prints` (incl. filament review) | R | R W | R W | |
| `/api/costs` (files, slice, quotes) | R | R W | R W | the calculator uses POST, so viewers see saved quotes only |
| `/api/orders`, `/api/clients` | R | R W | R W | |
| `/api/stats` | R | R | R | read-only already |
| `/api/tags`, `/api/collections` | R | R W | R W | |
| `/api/alerts` (list, history, dismiss, evaluate) | R, W `PATCH /:id` (read, unread, snooze, dismiss) | R W | R W | the PATCH writes the caller's own state, see "Alerts per user" |
| `/api/alerts/channels` | - | - | R W | channels hold webhook and SMTP secrets |
| `/api/preferences` | R, W own display keys | R, W own display keys | R W | see below |
| `/api/branding` | R | R | R W | everyone sees the logo and favicon |
| `/api/integrations` | R | R, W `/:id/sync` of a task with `editorSync` | R W | GET never returns secrets, and to non-admins not the setup either (`config`, `hasSecrets`, slicer folder and program); "Open in slicer" needs the list. See "Editor tasks" |
| `/api/slicer-zip` | - | - | R W | |
| `/api/import` | - | W `/integration/:id/:type` and `/:entity/apply` of that review, for a task with `editorReview` | R W | file imports stay admin-only |
| `/api/backups` | - | - | R W | a download is the whole database |
| `/api/logs` | - | - | R W | |
| `/api/fs` | - | R `/list` and W `/folder` (new folder), both confined to the project roots | R | browses the server's disk; editors need it for the project folder pickers (change or link a folder) |
| `/api/server-config` (autostart, restart, stop) | - | - | R W | |
| `/api/updates` | - | - | R W | |
| `/api/users` | - | - | R W | |
| `/api/docs` | - | - | R | OpenAPI UI |

### Preferences
Per-user display keys, which any role (viewer included) may change for themselves: `language`, `units`, `dateFormat`, `timeFormat`, `themeMode`, `accent`, `dashboardLayout`. They're saved in `user_settings` for the caller and fall back to the global value. `GET /api/preferences` returns the global values with the caller's own on top. In the no-users mode they stay global, as today.

Every other key is global and admin-only, so new keys start admin-only: costs, workflow, alert and module settings (`currency`, `markupPct`, `printerStates`, `orderStatuses`, `defaultPrinterId`, `lowSpoolGrams`, `maintenanceLead*` and the rest), plus:

Infrastructure keys: `appName`, `projectRoots`, `projectScanMaxFiles`, `viewerMaxMb`, `projectUploadMaxMb`, `backupAuto`, `backupKeep`, `logActive`, `logLevels`, `logModules`, `logRetentionDays`, `logMaxEntries`, `updateChannel`.

A PATCH with any key the caller may not change is rejected as a whole (403), nothing is half-saved.

### Editor tasks
An integration's setup is admin-only, but the admin can hand editors single tasks: per data type (`sync_policies` row), `editorSync` allows "Sync now" and `editorReview` allows its review and import. Both default to off. Admins always may; viewers never.
- `can()` has no database and no body, so it lets editors reach `POST /api/integrations/:id/sync`, `POST /api/import/integration/:id/:type` and `POST /api/import/:entity/apply`. Each of these routes then calls `mayTask()` (next to `can()` in `lib/auth.ts`) with the task's integration, type and flag, and answers 403 without it. An apply that isn't an integration's review is admin-only.
- One sync request is one type, so there is no "sync all" to narrow.
- The web shows the Integrations page to an editor with at least one flag on, with only those tasks' rows and only their Sync now / Review buttons: no switch, account, slicer, settings or sync log. Alert buttons follow the same flags. A finished sync's link to a catalog section stays admin-only, since that is module settings.

### Alerts per user
An alert is the same for everyone; whether a person has read, snoozed or dismissed it is their own (`alert_states`: alert id, user id, read at, snoozed until, dismissed at, updated at; cascade on both).
- From `alerts`, the same for everyone: kind, severity, context, detail, `resolvedAt`, `notifiedAt`.
- Read, snooze and dismiss come from the caller's `alert_states` row. Without a row they fall back to the `alerts` columns, which hold the state from before accounts existed, so old read or dismissed alerts don't come back for everyone. The no-users mode has no rows and keeps using those columns, as before.
- Resolved wins: once the cause is fixed (maintenance done, a review finished, a spool's price or open date filled in), the check that runs after each write resolves the alert for everyone, and it counts as read.
- `PATCH /api/alerts/:id` writes the caller's row, starting from what they saw. History's "updated" is the later of their own change and a resolve.
- When a user's own snooze ends, the alert comes back unread for that user only. The channels (ntfy, email) are told once per alert, never per user.

### Safety rules
- The last enabled admin can't be disabled, demoted or deleted (409).
- Disabling a user, changing their role or resetting their password ends all their sessions.
- Login rate limit: 5 failures per email + IP lock that pair for 15 minutes. Kept in memory; a restart clears it.
- A failed login says "wrong email or password", never which one.
- Hashes, tokens and the setup token are never logged or returned (the logger already redacts `cookie` and `*.password`).

### What a viewer sees
Every page with data: dashboard, printers, maintenance, filament, projects (with the 3D viewer and files), prints, quotes, orders, clients, stats, alerts. On alerts they get read, unread, snooze and dismiss, but not the fix buttons (edit spool, mark done, review, the integration and update links). Buttons that would change something are hidden, based on the role from `/api/auth/me`; the server enforces the same rules, so hiding is only for comfort. Settings shows only their own display preferences and their account. Editors see the same Settings, and log work (prints, spools, maintenance done, accessory installs) but cannot open any module settings page or add or edit printers, accessories, maintenance types or catalogs. Their integration buttons, on the Integrations page and on alerts, are the tasks an admin allowed them (see "Editor tasks").

## Rejected options
- **Custom roles or a per-permission matrix**: more UI and more ways to get it wrong, for households of two to five people. Three fixed roles cover "owner", "helps with prints" and "only looks".
- **JWT**: can't be revoked without a server-side list, which is a session table again. One server gains nothing from stateless tokens.
- **OAuth / SSO / OIDC**: needs internet access and an identity provider, too much for a home NAS. A reverse proxy with its own auth in front of the app still works.
- **Permission checks on each route**: scattered across every route file and easy to forget on a new one. One prefix table with default-deny is one place to read and test.
- **Keeping `APP_PASSWORD` next to accounts**: two ways in, and the shared one can't be traced in the logs.

## Consequences
- Each change in the logs shows who made it.
- Scripts that call the API need to log in and send the cookie; the no-users mode stays for single-PC installs that don't want accounts.
- Display preferences follow the person; cost and workflow settings stay shared.
- New routes and preference keys are admin-only until they're added to the table, so forgetting one fails closed.
