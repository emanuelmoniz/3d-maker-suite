# Logs

The **Logs** page records what the app does, by module and level, to help with troubleshooting. Logging is **off** by default. Turn it on in **Settings → Logs**; the Logs page only appears in the menu while it is on.

- **Levels to keep:** debug, info, success, warn and error. Choose which ones are written.
- **Modules to log:** the parts of the app that write entries (printers, prints, import, integrations, backups, and so on). Untick a module to leave it out.
- **Keep for (days):** older entries are removed every hour (default 14).
- **Maximum entries:** the oldest entries beyond this are removed every hour (default 10,000).

Entries are stored in the app's database, so they are kept with your data and included in a backup. Credentials, tokens and passwords are never written to a log.

The Logs table can be filtered by time, level, module and message, and sorted by any column.
