# Alerts

The alerts page lists what needs attention. Configuration of the thresholds and the mail/ntfy servers is in [configuration.md](configuration.md#alerts); this page covers who gets what.

## Who gets which alert

Each kind of alert needs a permission, and a user never gets a kind whose permission they lack, nor an alert about a project they can't see.

| Alert | Needs |
|---|---|
| Maintenance due | Maintenance (read) |
| Spool low, no price, no open date | Filament (read) |
| Warranty ending | Printers (read) |
| Sync waiting for review | Review syncs |
| Sync done, sync failed | Sync integrations |
| Slice setup changed, slice failed | Projects (read), and the project visible |
| Hub file conflict | Projects (read) |
| Preset conflict, preset skipped, preset deletes held | Manage slicer presets |
| Update available | Server settings |
| Slicer update | Manage integrations |
| Connector outdated, mass delete blocked | Manage the hub |

A sync alert also follows the sync policy's "users with the Sync (Review) permission" switch, unless the user manages integrations.

Per kind, a role sets **Off**, **In app** or **Notify** (notify also sends it by email or ntfy). In **Settings → Roles** this is the alerts card; on a user's page, **Same as role** follows the role, also when it changes later. Under **Settings → Alerts** a warning shows when no enabled user gets a condition alert (for example maintenance due).

Read, snooze and dismiss are per person. A condition alert (maintenance due, low spool) resolves for everyone once the cause is fixed; an event alert (sync failed, slice failed) stays until each person dismisses it.

## Delivery per user

Under **My account → My delivery** each person chooses where *Notify* alerts go:
- **Email**: on or off, to the account email or another address.
- **ntfy**: their own topic and, if the topic needs it, an access token. The token is stored encrypted and never shown again.
- **Send test** sends to your own destinations.

The mail server and the ntfy server are set once by an admin under **Settings → Alerts**. Each alert is sent once per person and channel; a destination that fails is retried at a later check, and a failing one waits 15 minutes so a wrong topic doesn't slow the others. Snoozing an alert holds your delivery until the snooze ends. Disabled users and users of a disabled role get nothing.

Without accounts, the global email recipient and ntfy topic from Settings → Alerts apply, as before.

## Thresholds

Thresholds are the same for everyone, because alerts are shared: the low-spool weight, and the maintenance warning lead (per type). The per-spool, per-maintenance-type and per-sync-policy switches stay too.

## Upgrading from 5.1.0-alpha.1 or 5.0

The old "alert about missing spool prices / open dates" switches become role defaults (off unless the switch was on). Admin gets every alert as Notify, Editor and Viewer as In app. Your existing email recipient and ntfy topic and token move to the oldest enabled admin's delivery, so notifications keep arriving.
