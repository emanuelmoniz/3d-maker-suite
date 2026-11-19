# Updates

How to move 3D Maker Suite to a newer version, and how to go back if something goes wrong.

## Who can use it

Whoever runs the app. In the app, the update controls are in **Settings**. Docker installs update from the server's command line.

## Before you start

- Check that a backup exists, see [Backups and restore](Backups-and-Restore.md). The app makes one by itself before an in-app update. Docker and manual updates don't.
- Updates apply database changes (migrations) when the app starts, and a migration only goes forward.

## What your install can do

| How you run it | In-app **Update** button | In-app **Roll back** | Where to read |
|---|---|---|---|
| Installed app (Windows, macOS, Linux) | Yes | Yes | [In the app](#update-in-the-app) |
| `pnpm start` from a copy with no local changes | Yes | Yes | [In the app](#update-in-the-app) |
| Source copy with local changes, or started another way | No, **Settings** shows commands | No | [From source by hand](#from-source-by-hand) |
| Docker or a NAS | No, **Settings** shows commands | No | [Docker](#docker) |

## Update in the app

1. Open **Settings** and go to the **About & updates** section. The app checks GitHub once a day and shows a banner when a version is out. Click **Check now** to look right away.
2. When a newer version exists, the section reads **Version X is available**. Click **What's new** to read the release notes.
3. Click **Update to X** and confirm.
4. The app makes a backup, downloads the version and restarts. It is away for about a minute. The page reloads by itself.
5. If something fails, the app goes back to the version you had and the section tells you which step failed (switching versions, checking Node.js, installing, building or starting). The **Logs** and the app's console say more.

An installed app downloads its own bundle for your system and checks it against the release's checksum before it installs. If the checksum is wrong, nothing is installed.

### Update channel

**Update channel** in the same section has two choices:

| Channel | What it gets |
|---|---|
| **Stable** (default) | Releases only |
| **Dev (pre-releases)** | Also pre-releases such as `6.3.0-alpha.1`. Use it to test what comes next |

Switching back to **Stable** doesn't take you back to an older version. It only stops offering pre-releases. To go back, see [Go back to an earlier version](#go-back-to-an-earlier-version).

## From source by hand

When **Update** isn't offered, **Settings** shows the commands. Stop the app, then run them in its folder, with the version you want:

```bash
git fetch --tags
git checkout v6.2.0
pnpm install
pnpm start
```

## Docker

1. Make a backup first.
2. In the folder with your compose file, run:

```bash
docker compose pull
docker compose up -d
```

To follow pre-releases, set the image to `:dev`, or to an exact tag such as `:6.3.0-alpha.1`. More in [Docker](Docker.md#updating).

## Go back to an earlier version

### In the app

**Update history** in **About & updates** lists the last 5 updates. Each update that worked has **Roll back to X** while its backup exists.

1. Click **Roll back to X** and confirm.
2. The app goes to that version and restores the backup it made before that update.
3. **Everything you changed after that update is lost**, because the backup is the data as it was right before the update.

The button is missing when the backup was deleted, or when an installed app no longer has that version's folder.

### In Docker

1. Set the image to the older tag, for example `:6.2.0`.
2. Run `docker compose up -d`.
3. Restore the backup you made before updating, see [Restore a backup](Backups-and-Restore.md#restore-a-backup).

A newer database may not open in an older version as it is, so don't skip the restore.

## Limits and tips

- An update needs a free minute. Don't close the terminal of a source install while it runs.
- A release can need a newer Node.js than your installed app has. The app then says so and asks you to download the installer from the release page. Your data stays.
- Only the last 5 updates can be rolled back. Older ones lose their backup.
- Backups made by a newer version can't be restored into an older one.

## Problems and fixes

- **The page is blank after an update.** Reload it with `Ctrl+F5`, or `Cmd+Shift+R` on macOS.
- **"The app's folder has local changes."** A source copy with edited files can't switch versions. Undo the changes (`git status` lists them), or update by hand.
- **"Could not download the update."** Check the internet connection and try again.
- **"The download was damaged."** The checksum didn't match. Nothing was installed. Try again later.
- **"Could not reach GitHub."** The check failed. Try **Check now** again later.
- **The update failed and the app went back.** Read the step in the message, then the **Logs**.

## Related pages

- [Backups and restore](Backups-and-Restore.md)
- [Docker](Docker.md)
- [Install from source](Install-from-Source.md)
- [Move or uninstall](Move-or-Uninstall.md)
