# ADR-0016: Roles, permissions and alerts per user

- Status: Accepted (Plan 5.1.0 Step 6; partly supersedes ADR-0012). Amended by ADR-0020: a `catalog` module permission takes the catalog writes from `printers` and `filament`, and replaces `presets.manage` (ADR-0017).
- Date: 2026-11-02

## Context
ADR-0012 gave every user one of three fixed roles, checked against one prefix table in `lib/auth.ts`. ADR-0014 added three per-user project switches. Since then the app runs as a hub for small teams, and the fixed roles stop fitting: someone who handles filament and prints but must not see quotes, a helper who may add printers but not change cost settings, one person who needs a single extra right. Alerts have the same problem: everyone sees every alert, and the channels (ntfy, email) send each alert once to one shared destination, so a viewer gets maintenance alerts they can't act on and nobody gets their own notifications.

## Decision

### Data
- `roles`: id, name (unique), built-in (`admin` · `editor` · `viewer` · none), disabled, permissions, project rights, alert kinds (the last three as JSON, keyed by the catalogs below).
- `users.role` becomes `users.roleId` (not null, a role with users can't be deleted).
- Per-user overrides on `users`: permissions, project rights, alert kinds. Each is a partial map; a missing key means "same as role".
- Per-user delivery: email on or off, an optional email address (empty = the account email), ntfy topic, ntfy token (encrypted, ADR-0005).
- `alert_states` gets the per-user send stamp (`notifiedAt`, see "Delivery").
- Seeded roles: **Admin** (built-in, every permission at its top, every project right; can't be edited, disabled or deleted), **Editor** and **Viewer** with exactly today's rights (tables below). Editor and Viewer are ordinary roles once seeded: they can be renamed, edited, disabled, and deleted when no user has them.

### Effective rights
`effective(user) = role values, then the user's overrides on top`. The auth hook reads them per request (the session lookup already joins the user; it joins the role too), so a change to a role or an override applies on the next request, with no session reset. `/api/auth/me` returns the effective permissions and project rights, and the web hides what they don't allow (`useCan(permission)`).

Admin-role users take no permission overrides. Of the project rights only `editOtherDevices` can be overridden for them, because ADR-0014 lets an admin turn it off today.

### Permission catalog
Modules have levels **none · read · write · manage**. Each level includes the ones before it. Read is GET/HEAD; write is daily work; manage is the module's setup and its settings page (the gear button in the module header). The other permissions are on or off.

The table is today's role × prefix table (ADR-0012) and the rules `can()` adds to it, regrouped. R / W / M = what the level read / write / manage adds. Paths are under `/api`.

| Permission | What it opens | Admin | Editor | Viewer |
|---|---|---|---|---|
| `printers` | R: `/printers`, `/accessories`, `/brands`, `/printer-models`, `/machine-profiles`, `/print-profiles`. W: accessory installs and removals (`/accessories/:id/installs`). M: every other write on those prefixes; keys `defaultPrinterId`, `printerStates` | manage | write | read |
| `maintenance` | R: `/maintenance`. W: `POST /maintenance/tasks` (log done). M: `/maintenance/types` writes | manage | write | read |
| `filament` | R: `/filament`, `/filament-brands`, `/filament-materials`. W: `/filament` writes except `/filament/profiles`. M: `/filament/profiles`, brand and material writes | manage | write | read |
| `projects` | R: `/projects`, GET `/roots`. W: `/projects` writes (files, trash, slicing, scan, open), `/collections` writes, `GET /fs/list` and `POST /fs/folder` confined to the project roots. M: `/roots` writes, `/fs` outside the roots; keys `projectScanMaxFiles`, `viewerMaxMb`, `projectUploadMaxMb` | manage | write | read |
| `prints` | R: `/prints`. W: `/prints` writes, filament review included. M: keys `gramsPerHour`, `failureReasons` | manage | write | read |
| `costs` (quotes, orders, clients) | R: `/costs`, `/orders`, `/clients`. W: their writes (the calculator is a POST). M: keys `currency`, `energyCostPerKwh`, `laborRatePerHour`, `failureMarginPct`, `markupPct`, `printerLifetimeHours`, `printerCountInCosts`, `includeMaintenanceCost`, `accessoryLifetimeHours`, `accessoryCountInCosts`, `accessoryIncludeMaintenanceCost`, `orderStatuses` | manage | write | read |
| `stats` | R: `/stats`. Levels none · read only | read | read | read |
| `integrations.sync` | `POST /integrations/:id/sync`, for a task whose policy has `editorSync` (see "Integration tasks") | on | on | off |
| `integrations.review` | `POST /import/integration/:id/:type` and `POST /import/:entity/apply` of that review, for a task whose policy has `editorReview` | on | on | off |
| `integrations.manage` | every other `/integrations` route, the managed slicer (`/integrations/:id/slicer`), file imports under `/import`, `/slicer-zip`, `/fs` outside the roots (slicer folders), the setup fields in GET `/integrations`; key `defaultSlicerId` | on | off | off |
| `hub.manage` | `/hub` (devices, pairing codes, connector settings); keys `hubEnabled`, `hubDeleteGuard`, `hubLocks`, `hubLockIdleMin`, `hubVersions`, `hubVersionsKeep`, `hubDefaultSyncMode`, `deviceFolderMaxMb` | on | off | off |
| `settings.server` | `/server-config`, `/updates`, `/docs`; key `updateChannel` | on | off | off |
| `settings.backup` | `/backups` except restore; keys `backupAuto`, `backupKeep` | on | off | off |
| `settings.logs` | `/logs`; keys `logActive`, `logLevels`, `logModules`, `logRetentionDays`, `logMaxEntries` | on | off | off |
| `settings.branding` | `/branding` writes; key `appName` | on | off | off |
| `settings.alerts` | `/alerts/channels` (the mail and ntfy servers); keys `lowSpoolGrams`, `maintenanceLeadDays`, `maintenanceLeadHours`, `maintenanceLeadPrints` | on | off | off |
| `users.manage` | `/users`, `/roles`. `GET /users` also with `projects` manage, for a root's picked editors | on | off | off |

*Amended by ADR-0020: catalog writes (`/brands`, `/printer-models`, `/machine-profiles`, `/print-profiles`, `/filament/profiles`, `/filament-brands`, `/filament-materials`) move from `printers` and `filament` manage to a new `catalog` module (none · read · write · manage), which also replaces `presets.manage`. Their reads stay open to `printers` or `filament` read, for the pickers.*

Not a permission:
- **Any session:** `/auth` (logout, `me`: own name and password), GET `/preferences` and the own display keys (`USER_PREFERENCE_KEYS`), GET `/branding`, GET `/integrations` without the setup (the list "Open in slicer" needs), GET `/alerts` (list, history, detail; filtered as in "Who gets which alert"), `PATCH /alerts/:id` (the caller's own read, snooze, dismiss).
- **Any write permission** (write or manage on a module, or any on/off permission): `/tags` create, rename, delete; `POST /alerts/evaluate`.
- **Write on the tagged module:** `PUT /tags/taggings/:type/:id`. `project` → projects, `print` → prints, `spool` → filament, `printer` and `accessory` → printers.
- **A device's own routes:** `/hub/events` and `/hub/device/*` with a device token, for any user (ADR-0014). `POST /hub/pair` stays public.
- **Admin role only:** backup restore (a restored database carries any user's rights, so it would be a way around every rule below), and every prefix or preference key not in this table. A new route or key fails closed, as before.

A PATCH of `/preferences` with any key the caller's permissions don't cover is still rejected as a whole (403).

`can()` keeps its shape: one table, default deny, now taking effective rights instead of a role. The special cases in today's `can()` become rows of the table above, so they can be read and tested in one place.

### Project rights
On or off per role, overridable per user. They replace ADR-0014's per-user switches.

| Right | Admin | Editor | Viewer |
|---|---|---|---|
| `projects.seeAll`: see every project, not only my own | on | on | on |
| `projects.editOthers`: edit other people's projects | on | on | off |
| `projects.editOtherDevices`: edit files in another user's device root | on (an Admin user can be overridden off) | off | off |

ADR-0014's rules stay, reworded in permissions:
- Editing any project file needs `projects` write. Without it a project is download-only (today's viewer rule), on the user's own device root too.
- `roots.editBy = roles` means "users with `projects` write"; `admins` means Admin-role users; `users` means the picked users, who also need `projects` write; `none` is unchanged.
- `projectAccess` and `visibleProjects` read `seeAll` and `editOthers` where they read "is admin" or the switches today. The Admin role has both on, so admins behave as before.

### Overrides
Every permission and project right has three choices for a user: **same as role**, or a value. A module's value is a level (none · read · write · manage), the rest are allow or deny. The user edit page shows the effective value next to each choice. Only users with `users.manage` edit overrides, and never their own.

### Escalation and safety rules
- A user with `users.manage` who isn't in the Admin role (a "manager") can't grant more than they have: every value they set in a role, an override or by picking a role for someone is at most their own effective value.
- Nobody changes their own role, overrides or disabled state.
- Only Admin-role users create, edit, disable or delete Admin-role users, or move someone into or out of the Admin role. Nobody edits the Admin role itself.
- A disabled role: its users can't sign in, their sessions end, their device tokens stop working (the same as a disabled user).
- A role with users can't be deleted: 409 `role_in_use`.
- The last enabled Admin-role user can't be disabled, moved to another role or deleted: 409, as today.
- Changing a role or an override no longer ends sessions (rights are read per request). Disabling a user, disabling their role, and resetting a password still end them.
- Device tokens act with their user's effective rights.
- No-users mode is unchanged: everyone may do everything, as the Admin role.

### Integration tasks
`editorSync` and `editorReview` on a sync policy stay as an extra gate: a user with `integrations.sync` (or `.review`) but without `integrations.manage` may run only the tasks whose flag is on. A user with `integrations.manage` can switch the flags anyway, so the flags don't gate them. `mayTask()` keeps its place in the routes. The flags' labels change from "editors" to "users with the Sync (Review) permission".

### Who gets which alert
Alerts are still raised once per condition, and their rows are shared.
- **Condition kinds** resolve for everyone when the cause is fixed (resolved wins, ADR-0012). **Event kinds** are raised once and stay until each user dismisses them. Read, snooze and dismiss stay per user (`alert_states`).
- Each kind needs a permission. A user never gets a kind whose permission they lack, nor an alert about a project they can't see, whatever their subscription says.
- Per kind a role sets **off · in app · notify** (notify includes in app); a user can override any kind ("same as role" resets it).
- Settings → Alerts warns when no enabled user gets a condition kind.

| Kind | Needs | Class |
|---|---|---|
| `maintenance_due` | `maintenance` read | condition |
| `spool_low`, `spool_no_price`, `spool_no_open_date` | `filament` read | condition |
| `warranty_ending` | `printers` read | condition |
| `sync_pending` | `integrations.review`, and the policy's `editorReview` unless `integrations.manage` | condition |
| `sync_success`, `sync_error` | `integrations.sync`, and the policy's `editorSync` unless `integrations.manage` | event |
| `slice_setup_changed`, `slice_failed` | `projects` read, and the project visible | event |
| `hub_conflict` | `projects` read, and the project visible when the file is in one | event |
| `update_available` | `settings.server` | event, resolved by the update check |
| `slicer_update` | `integrations.manage` | event, resolved by the slicer check |
| `connector_outdated`, `hub_mass_delete` | `hub.manage` | condition |

New kinds (Plan 6.0.0 and later) join this table with their permission, or they are Admin-role only.

The filter applies to `GET /api/alerts`, history, detail and the unread badge, and to delivery.

Settings that stay or move:
- `spoolNoPriceAlert` and `spoolNoOpenDateAlert` move into the role defaults (those kinds are off in every role unless the switch was on). The conditions are then always checked; who sees them is the subscription.
- Thresholds stay global (`lowSpoolGrams`, `maintenanceLead*`), because the alert rows are shared.
- The per-spool, per-maintenance-type and per-policy switches stay.

### Delivery
- The mail server (host, port, user, password, from) and the ntfy server stay global, under `settings.alerts`.
- Each user turns on email (to their email address, by default the account email) and/or sets their own ntfy topic and token. The token is encrypted, never logged and never returned (the API says only whether one is set). A test button sends to the user's own destinations.
- An alert is sent to each user who gets it as notify, once per user and channel. The stamp lives in that user's `alert_states` row (`notifiedAt`, one time per channel id); a channel that failed is tried again at a later check, one that went through is not sent again. A failing destination waits 15 minutes before its next try (kept in memory), so a wrong topic doesn't slow every check. The evaluate queue runs one check at a time, so two checks can't send the same alert.
- With users, the global `to`, topic and ntfy token are not used: a user's ntfy goes with their own token or none.
- A user's own snooze holds their delivery and re-arms it when it ends (the alert comes back unread and unsent for them). Disabled users and users of a disabled role get nothing.
- No-users mode: the Admin role's kinds and the global destinations of today (the channel's `to` and topic) apply.

### Migration
Each step that changes the schema migrates its part (Drizzle migrations, Plan 5.1.0 Steps 7, 10 and 11):
1. **Roles** (Step 7): create `roles`, seed Admin, Editor and Viewer as above; `users.roleId` from `users.role`.
2. **Project rights** (Step 7): the role defaults are the table above. A user's old switch becomes an override only where it differs from their new role's default and had an effect: for editors all three, for viewers `seeAll`, for admins `editOtherDevices` off. Then the old columns go.
3. **Alert kinds** (Step 10): every role gets every kind its permissions allow; Admin as notify, Editor and Viewer as in app (they had no own destination). The two spool kinds follow the old global switches. Then the switches leave the preferences.
4. **Delivery** (Step 11): today's email recipient and ntfy topic and token become the oldest enabled admin's delivery (email on, the old `to` as their address when it isn't the account email), so nothing stops. The global `to` and topic stay for the no-users mode.

A role-matrix test proves the seeded roles answer every route as before the migration.

## Rejected options
- **Keep three fixed roles and add more switches:** every new need adds a column and a UI row for everyone; ADR-0014's three switches were already that.
- **Modules with none · read · write only** (as first planned): today's Editor logs work but doesn't set things up (adds printers, edits maintenance types or filament profiles, opens a module's settings). Without a fourth level the seeded Editor would gain all of that, or lose the work.
- **One "module settings" permission** for every module's setup: can't let someone set up printers without also changing cost settings.
- **A permission per route** or per HTTP method: hundreds of checkboxes, and every new route needs a decision in the UI. Module levels plus a few on/off permissions are what people actually tell apart.
- **Permission checks in each route:** same reason as in ADR-0012; one table with default deny stays the one place to read and test.
- **Per-object ACLs** (rights per printer, per spool): no one asked, and projects already have owners, visibility and root rules.
- **Permissions in the session or a token:** stale until the next login, so every change would have to end sessions. Reading them per request is one join.
- **Delivery per role** (one destination per role): notifications are personal; a shared topic is what the global channel already does.

## Consequences
- A role or override change takes effect on the next request, with no logout.
- An admin can build a role per job (filament helper, quoting, read-only client view) without code changes; new routes and keys still need a row in the table, or they stay Admin-role only.
- Settings → Users becomes a table with an edit page per user; Settings → Roles is new (Step 8).
- Each person gets only the alerts they can act on or see, on their own channels; thresholds and the servers stay shared.
- ADR-0012's role × prefix table, safety rules on roles and "the channels are told once per alert", and ADR-0014's per-user switches, are replaced by this ADR. Sessions, login, setup, no-users mode, per-user display preferences and per-user alert states stay as ADR-0012 describes them.
