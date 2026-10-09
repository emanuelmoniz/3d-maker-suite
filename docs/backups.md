# Backups

- **Scheduled:** a backup runs every day at 03:00 and old ones are removed according to the retention setting.
- **Manual:** create one from the backup section of Settings.
- **Restore:** choose a backup in Settings. The restore is applied on the next start, before the database opens, so the app restarts after restoring.
- **Export:** CSV and JSON exports of prints, spools and other tables are in the same section. Use them for spreadsheets or your own tools.

Backups live in the `backups` folder inside your data folder (see [install.md](install.md#where-your-data-is)). A backup holds your database, photos and the key that protects saved logins, so keep copies private. Copy them to another drive for real safety.
