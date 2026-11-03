# Backups

- **Scheduled:** a backup runs every day at 03:00 and old ones are removed according to the retention setting.
- **Manual:** create one from the backup section of Settings.
- **Before an update:** each update from Settings makes an `update-…` backup first. Retention leaves these alone: they belong to the update history, which keeps the last 5 so you can roll back (see [install.md](install.md#updating)).
- **Restore:** choose a backup in Settings. The restore is applied on the next start, before the database opens, so the app restarts after restoring.
- **Export:** CSV and JSON exports of prints, spools and other tables are on the **Import | Export** page. Use them for spreadsheets or your own tools.

Backups live in the `backups` folder inside your data folder (see [install.md](install.md#where-your-data-is)). A backup holds your database, photos, the hub's file versions (if kept) and the key that protects saved logins, so keep copies private. Copy them to another drive for real safety.

## Moving to a new machine

A backup doesn't hold your project files, so they move separately.

1. **Back up.** On the old machine, go to Settings → Backup & export, choose **Back up now**, then **Download**. Stop the app so nothing changes after the backup.
2. **Move the files.** Copy your project folders to the new machine or disk. Keep the layout under each root, because projects keep their folder relative to the root. On Docker, mount the new folders ([projects.md](projects.md#docker-and-bind-mounts)).
3. **Restore.** Install the same version or a newer one on the new machine; a backup from a newer version is refused. Go to Settings → Backup & export, choose **Upload a backup** (2 GB at most), then **Restore**, and restart the app. Sign in with your old accounts. Saved logins keep working, because the backup holds their key.
4. **Change the projects root.** The old roots are still listed and are reported as missing by a scan; their projects stay. Add the new folders as roots in Settings → Projects, then use **Bulk change projects root** with **Move files** off ([projects.md](projects.md#moving-projects-to-another-root)).

**Connectors.** If the hub keeps its address, connectors reconnect by themselves. At a new address, a connector has to **Unpair** and pair again ([hub.md](hub.md#pair-a-device)). It then joins as a new device, so set up its device roots again and remove the old device in Hub management.
