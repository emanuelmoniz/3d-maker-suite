# FAQ

Short answers to common questions. Each one points to the page with the full story.

## Your data

**Does my data leave my PC?**
No. The app stores everything locally. It contacts an outside service only when you connect one, such as Bambu Cloud, and only to sync. See [Sources and sync](Sources-and-Sync.md).

**Where is my data kept?**
In the app's data folder, with the database, thumbnails, backups and the key that protects saved logins. See [Configuration](Configuration.md#where-your-data-is-kept).

**How do I back it up?**
The app can back up every night, on demand, and before an update. See [Backups and restore](Backups-and-Restore.md).

**Will my old costs change when I change a filament price?**
No. Each print stores its cost when it is recorded.

**Why does the Filament table on Stats show less than the total cost?**
It shows **Material cost**: only what the filament cost. Energy, labour and wear aren't part of it. The other tables show the total cost.

## Printers and accounts

**Do I need a Bambu account?**
No. Everything can be entered by hand. An account only adds automatic sync.

**Why does Bambu Cloud ask for a code?**
Bambu asks for an email code or a 2FA code on new sign-ins. Enter the code in the app.

**Can I use it with printers that are not Bambu?**
Yes. Add them by hand, or connect them through Moonraker, PrusaLink or OctoPrint.

**Does the app control my printer?**
No. It only reads status. It never sends commands to a printer.

**Do I need a slicer to estimate a project's cost?**
No. Type the print time and grams for each plate, or let a slicer on the server's computer slice the plates. Sliced numbers match the slicer's own for the same presets.

## Running it

**Is there a Docker image?**
Yes: `ghcr.io/emanuelmoniz/3d-maker-suite`, for Intel and AMD (x64) processors. See [Docker](Docker.md), and [Docker on a NAS](Docker.md#on-a-nas).

**Can I use it from my phone?**
Yes, on the same network or from outside through a reverse proxy. See [Use from another device](Use-From-Another-Device.md) and [Server and remote access](Server-and-Remote-Access.md).

**Do I have to create an account?**
Not for one computer. With no accounts, anyone who can reach the app has full access. Create accounts as soon as other people can reach it. See [First run](First-Run.md).

**How do I update?**
In **Settings → About & updates**, or from the command line for Docker and source copies. See [Updates](Updates.md).

**Can I go back to an earlier version?**
Yes, see [Updates](Updates.md#go-back-to-an-earlier-version). Restore a backup if you need your data from before.

**Can I move to another computer?**
Yes. See [Move or uninstall](Move-or-Uninstall.md).

## Using it

**What's the difference between Archive and Delete?**
Archive hides an item and keeps all its history. Delete removes it for good, and only when nothing uses it. See [Archive and delete](Archive-and-Delete.md).

**What is a source?**
Anything that feeds the app with data: an account, a printer on your network, a slicer, or a computer paired with the hub. See [Sources and sync](Sources-and-Sync.md).

**Why did a sync not add everything?**
The line may be set to **Only what I already have**, or some rows wait in **Review and import**. See [Sources and sync](Sources-and-Sync.md#what-to-sync).

**What are the hub and the connector?**
The hub shares projects, catalog and presets between computers. A connector is the small program that pairs a computer with it. See [Hub setup](Hub-Setup.md) and [Connector setup](Connector-Setup.md).

**What does a word in the app mean?**
See the [Glossary](Glossary.md).

## Getting help

**Where do I look when something goes wrong?**
[Troubleshooting](Troubleshooting.md), then the app's log in **Settings → Logs**.

**Where do I report a bug?**
Open an issue on GitHub and use the bug report template.

## Related pages

- [Troubleshooting](Troubleshooting.md)
- [Glossary](Glossary.md)
