# Backups and restore

How the app keeps copies of your data, and how to bring one back.

## Who can use it

Making, downloading and deleting backups needs the backup right in **Settings**. **Restore** is only for the Admin role, because a restored database carries everyone's rights.

## What a backup holds

| Included | Not included |
|---|---|
| The database: printers, filament, prints, projects, costs, accounts, settings | Your project files, the 3D files in your project folders |
| Photos, thumbnails and quote files | Slicers you installed from the app |
| The hub's file versions, if there are any | The saved host, port and public address (`config.json`) |
| `secret.key`, which protects saved logins | Logs |

Saved logins, such as Bambu Cloud, keep working after a restore because the backup holds their key. For the same reason, **keep backup files private**.

## Kinds of backup

| Kind | When | Kept |
|---|---|---|
| **Automatic** | Every night at 03:00, if the app is running then | The newest 7 by default |
| **Manual** | When you click **Back up now** | Until you delete it |
| **Before an update** | Before each in-app update | With the update history, the last 5 |
| **Uploaded** | When you use **Upload a backup** | Until you delete it |

An automatic backup is skipped when the app is off at 03:00. It doesn't run later to catch up.

Backups are files in the `backups` folder of your data folder. See [Where your data is kept](Configuration.md#where-your-data-is-kept).

## Settings

Open **Settings** and go to the **Backup & export** section.

| Setting | What it means | Default |
|---|---|---|
| **Back up automatically every night** | Turns the 03:00 backup on or off | On |
| **Automatic backups to keep** | How many automatic backups stay. The oldest are deleted. Manual, uploaded and update backups are never removed by this. 1 to 100 | 7 |

Each backup in the list shows its date, its size, **Automatic** when it is one, and **Includes file versions** when it holds them. Next to it: **Download**, **Restore** (Admin only) and **Delete**.

## Make a backup

1. Go to **Settings → Backup & export**.
2. Click **Back up now**.
3. To keep a copy elsewhere, click **Download** on it and save the file on another drive.

## Restore a backup

A restore replaces **all current data** with the backup. Your current data is kept for you in a `pre-restore` folder inside the data folder, until the next restore replaces it.

1. Go to **Settings → Backup & export**.
2. Click **Restore** on the backup you want, and confirm.
3. The app says **Backup ready. Restart the app to finish restoring.** Nothing has changed yet.
4. Restart the app:
   - Installed app or source install: **Settings → Network → Restart server**.
   - Docker or NAS: `docker compose restart app`, or restart the container from the NAS.
5. The app swaps in the backup before it opens the database. Sign in with the accounts from the backup.

If you restore an older backup, you also go back in data, not in version. The app keeps its current version, and any database changes the newer version needs are applied when it starts.

## Restore on a new or empty install

1. Install the same version as the backup, or a newer one. A backup made by a newer version is refused.
2. Create the first admin, see [First run](First-Run.md).
3. In **Settings → Backup & export**, click **Upload a backup** and choose the backup `.zip` (2 GB at most).
4. Click **Restore** on it, confirm, and restart the app.
5. Sign in with an account from the backup. The temporary admin is gone.

Instead of uploading, you can copy the `.zip` into the `backups` folder of the data folder. It then shows in the list. This helps when the file is bigger than 2 GB.

## Limits and tips

- Copy backups to another drive or machine. A backup on the same disk doesn't help when the disk fails.
- A backup doesn't hold your project files. Back those up on their own.
- Only the Admin role restores. Keep a second admin account.
- Restoring changes the settings, accounts and integrations to the ones in the backup.
- The `pre-restore` folder uses disk space. Delete it by hand when you are sure of the restore.
- **Settings → Data → Export** makes CSV and JSON files for spreadsheets. They are not a backup.

## Problems and fixes

- **"That didn't work. Check that the file is a backup made by this app."** The file isn't a backup of 3D Maker Suite, or it was made by a newer version. Update the app and try again.
- **The restore didn't happen.** It only applies on the next start. Restart the app.
- **I can't see Restore.** Only the Admin role has it.
- **Saved logins ask to be set up again.** The backup was made without its key. Add the integration again.

## Related pages

- [Updates](Updates.md)
- [Move or uninstall](Move-or-Uninstall.md)
- [Configuration](Configuration.md)
- [Docker](Docker.md)
