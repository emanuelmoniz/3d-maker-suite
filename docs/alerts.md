# Alerts

The alerts page lists what needs attention, each with a short title ("Printers from Bambu Cloud could not sync", "Slicer preset Step 10 changed"). Opening one shows the rest: why a sync failed, what was kept in a conflict, the versions, its sync log. Configuration of the thresholds and the mail/ntfy servers is in [configuration.md](configuration.md#alerts); this page covers who gets what.

## Who gets which alert

Each kind of alert needs a permission, and a user never gets a kind whose permission they lack, nor an alert about a project they can't see.

| Alert | Needs |
|---|---|
| Maintenance due | Maintenance (read) |
| Spool low, no price, no open date | Filament (read) |
| Warranty ending, printer offline during a print | Printers (read) |
| Print finished, print failed | Prints (read) |
| Filament to review | Prints (write) |
| Sync waiting for review | Review syncs |
| Sync done, sync failed | Sync integrations |
| Slice setup changed, slice failed | Projects (read), and the project visible |
| Hub file conflict | Projects (read) |
| Preset conflict, preset skipped, preset deletes held | Manage slicer presets |
| Update available | Server settings |
| Slicer update | Manage integrations |
| Connector outdated, mass delete blocked | Manage the hub |

A sync alert also follows the sync policy's "users with the Sync (Review) permission" switch, unless the user manages integrations.

Per kind, a role sets **Off**, **In app** or **Notify** (notify also sends it by email or ntfy). In the **Roles** tab of **Users | Roles** this is the alerts card; on a user's page, **Same as role** follows the role, also when it changes later. Under **Settings → Alerts** a warning shows when no enabled user gets a condition alert (for example maintenance due).

Read, snooze and dismiss are per person. A condition alert (maintenance due, low spool) resolves for everyone once the cause is fixed; an event alert (sync failed, slice failed) stays until each person dismisses it.

## Printer alerts

For printers with live status (see [printers.md](printers.md)):
- **Print finished** and **Print failed** are event alerts, one per print, linking to the print. A cancelled print raises none, and neither does a print that came in by importing history.
- **Printer offline** is a condition alert: it opens when a printer stops answering during a print for more than 2 minutes, and resolves when it answers again. A printer that is off while idle raises nothing.
- **Printer unreachable** is its twin for a printer reached through a connector ([hub.md](hub.md#printers-through-a-connector)): the connector on its network went offline during a print for more than 2 minutes, so the printer can't be reached. It names the machine and resolves when the connector is back and reads the printer. A print that ended meanwhile is recorded then.

All four are In app by default; Admin gets them as Notify.

## Filament to review

Prints recorded automatically are never held back. A filament slot whose spool or grams aren't sure waits in **Filament to review** instead, and **Filament to review** is one condition alert with the number of slots waiting. It links to the queue and resolves when the queue is empty. In app by default; Admin gets it as Notify.

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
