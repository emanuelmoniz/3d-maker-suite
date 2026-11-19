# Sources and sync

What a source is, which kinds of data a source can bring in, and how **Auto** and **Manual** sync work. Other pages link here instead of explaining it again.

## Who can use it

- Anyone with the right to see a module sees the sources of that module.
- Setting up a source, or changing when it syncs, needs **Set up integrations** or the module's **Manage** right.
- Running a sync, or reviewing what it found, needs the **Run syncs** and **Review imports** rights.

## What a source is

A source is anything that can feed the app with data. You never have to use one. Everything can be typed in by hand.

| Kind of source | Examples |
|---|---|
| An online account | Bambu Cloud, Spoolman |
| A printer on your network | Bambu LAN, Moonraker, PrusaLink, OctoPrint |
| A slicer | Bambu Studio, OrcaSlicer, on the server or on a computer paired with a hub |
| A computer paired with the hub | Its shared project folders and its slicers' presets |
| A file you upload | A slicer zip, a spreadsheet on the **Import** page |

Several sources can feed the same kind of data. When two sources know the same thing, the app keeps one copy. For example, a printer that you add through Bambu Cloud and Bambu LAN is still one printer.

## Data types

A data type is one kind of thing a source can bring in.

| Data type | What it holds | Where you set its sources |
|---|---|---|
| Printers | The printers of an account | **Printers → Settings → Sources** |
| Prints | The print history of an account | **Prints → Settings → Sources** |
| Spools | Spools and their weights | **Filament → Settings → Sources** |
| Catalog | Printer brands and models, filament brands and materials | **Catalog → Catalog settings → Sources** |
| Presets | Printer, process and filament presets, system and user | **Catalog → Catalog settings → Sources** |
| Projects | Project folders and their files | **Projects → Settings → Sources** |

A source only says what it is **allowed** to bring in. The settings page of the data type decides how and when. That is why every settings page has a **Sources** tab.

A **Sources** tab lists the sources that are switched on. You don't add anything there by hand: you switch a source on where you set it up, which is **Settings → Integrations** for accounts and slicers, and **Hub management** for computers. Switching a source off takes it off the tab and keeps the data it already brought in.

## Share to the hub and receive from the hub

With the [hub](Hub-Setup.md) on, a **Sources** tab can have two sections.

- **Share to the hub:** sources that bring data into the hub. Accounts, the server's slicer, and computers that share folders or presets.
- **Receive from the hub:** computers that the hub sends data to. Projects, catalog and presets only.

Printers, prints and spools have no receive section.

## Auto and manual sync

Each line of a **Sources** tab is one data type from one source. Its **When** column says how it runs.

| Setting | What it does |
|---|---|
| **Auto** | Runs by itself. You pick the **Frequency**: every 15 minutes, every hour, every day, every week or every month, with the time or day it starts. **Any time** counts from the last sync. Times are in the server's time zone |
| **Automatic when the files change** | For slicer files only. It runs by itself within a minute of a change in the slicer's folder |
| **Manual** | Never runs by itself. It runs only when you click **Sync now** |
| **Off** | The line is switched off. Its switch in the **On** column is off |

Turning a line's switch off and on again brings back its usual setting.

### Sync now, and the Sync button

- **Sync now** is in the **⋯** menu of a line. It runs that line right now, whatever its schedule.
- **Sync** sits next to **Add** on the Printers, Filament, Prints and Catalog pages. One click runs that page's data type now, in every source where it is on **Auto** and where your role may sync. Sources set to **Manual** or **Off** are left out. A page with no such source has no button.
- A source that is already syncing is skipped. Try again in a moment.

### What to sync

For printers, spools, the catalog and presets, **Edit** on a line has two more settings:

| Option | What a sync does |
|---|---|
| **Everything** | Adds every row the source offers and keeps them up to date |
| **Only what I already have** | Keeps your rows up to date. A new row is added only when you already have its brand. Brands and materials themselves are never added |

Print history has neither, because an imported print never changes.

### Review and import

Some rows need a decision from you, for example a spool that could match two of yours. These rows wait instead of being saved.

- The line shows how many rows are waiting, for example **3 to review**.
- Open **Review and import** in the line's **⋯** menu. Choose **Create**, **Update** or **Skip** for each row, then import.
- Waiting rows can raise a **Sync needs review** alert.
- Reviewing is not a sync. The next **Sync now** or automatic run carries on from the last sync, so a row you skipped can still come in later.

The app takes a backup before an import saves anything.

### The sync log

The **⋯** menu of a line also opens its sync log: when it ran, what it did and what failed. A failed sync raises a **sync failed** alert, and the app keeps working with the data it has.

## What a sync never changes

- **Your own edits to fields the source doesn't own.** An import only fills what is empty.
- **Archived items.** A sync leaves them alone. See [Archive and delete](Archive-and-Delete.md).
- **Old costs.** A print keeps the cost it was recorded with.
- **A printer on your network.** A source never renames it. Rename the printer itself.

## Limits and tips

- The app never controls a printer. Sources only read.
- Credentials are stored encrypted and are never shown again.
- A line that fails keeps its last good data. Fix the cause, then use **Sync now**.
- With the hub on, a computer's lines follow its files. They have no schedule to set.

## Problems and fixes

- **There is no Sync button.** No source has that data type on **Auto**, or your role can't run syncs.
- **A line says it needs review.** Open **Review and import** in its **⋯** menu.
- **A source says it is signed out.** Sign in again on its card in **Settings → Integrations**.
- **Nothing syncs on its own.** Check that the line's switch is on and its mode isn't **Manual**.
- **A sync failed.** Open the line's sync log and read the message. See [Troubleshooting](Troubleshooting.md).

## Related pages

- [Archive and delete](Archive-and-Delete.md)
- [Hub setup](Hub-Setup.md)
- [Glossary](Glossary.md)
- [Troubleshooting](Troubleshooting.md)
