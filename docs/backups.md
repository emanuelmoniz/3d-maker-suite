# Backups

- **Scheduled:** a backup runs every day at 03:00 and old ones are removed according to the retention setting.
- **Manual:** create one from the backup section of Settings.
- **Before an update:** each update from Settings makes an `update-…` backup first. Retention leaves these alone: they belong to the update history, which keeps the last 5 so you can roll back (see [install.md](install.md#updating)).
- **Restore:** choose a backup in Settings. The restore is applied on the next start, before the database opens, so the app restarts after restoring.
- **Export:** CSV and JSON exports of prints, spools and other tables are on the **Import | Export** page. Use them for spreadsheets or your own tools.

Backups live in the `backups` folder inside your data folder (see [install.md](install.md#where-your-data-is)). A backup holds your database, photos, the hub's file versions (if kept) and the key that protects saved logins, so keep copies private. Copy them to another drive for real safety.
