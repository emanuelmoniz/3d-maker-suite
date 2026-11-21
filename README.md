<h1 align="center"><img src="docs/brand/logo-color-horizontal.svg" alt="3D Maker Suite" height="96"></h1>

A local-first manager for your 3D printing: printers, accessories, maintenance, filament, projects, prints, costs, quotes and stats. Runs on your own PC. Your data stays in a SQLite file on your disk.

![Dashboard screenshot](docs/images/dashboard.png)

## Features

- **Printers**: inventory, timeline, comments, warranty and purchase info, lifetime and maintenance cost
- **Accessories**: install on a printer with dates, usage, photos, tags, maintenance and cost
- **Maintenance**: reusable tasks for printers and accessories, due by hours, prints or days (a tab of Printers)
- **Filament**: spools with numbers and colour names, remaining grams, low-spool alerts
- **Catalog and presets**: printer and filament brands, models and materials, and the slicer's printer, process and filament presets, by hand or from a slicer
- **Hub and connector**: workstations, a NAS or a file server join your server with a small connector app (Windows, macOS, Linux x64 and ARM64; with nobody signed in on a Raspberry Pi, a Linux server or Windows Server x64); each machine page shows its CPU, memory, disks and addresses ([the guide](https://emanuelmoniz.github.io/3d-maker-suite/Hub-Setup))
- **Users and roles**: accounts for a LAN, NAS or Docker install, with viewer, editor and admin roles and a log of who changed what ([the guide](https://emanuelmoniz.github.io/3d-maker-suite/Users))
- **Alerts**: one list of what needs attention (low spools, maintenance, warranties, sync results), with severity, read, snooze and dismiss, a history table, and optional ntfy or email channels; each task chooses what it raises
- **Projects**: 3MF models with plates, thumbnails, tags, filament colours, files you can upload, move and remove in folders, a chosen 3D preview file, an image gallery with a cover, a markdown description (linked `.md` or `.txt` file, with an editor), and slicing per plate (Bambu Studio or OrcaSlicer, locally or on the server, automatically when a sliced file changes) for an estimated cost of one complete print
- **Prints**: history with outcome, filament usage per AMS slot (up to 16 for multicolor), energy, and an estimated duration when only the grams are known; each network printer can stop recording on its own while its live status goes on ([the guide](https://emanuelmoniz.github.io/3d-maker-suite/Prints))
- **Clients**: people and companies you print for, with unique VAT, mobile and email
- **Quotes**: numbered quotes from a project or typed in, with notes, client and markup on cost
- **Orders**: work agreed with a client, from a quote or on its own, with a status, a price and the cost of its linked prints
- **Costs and stats**: cost per print snapshotted at record time (printer, counted accessories, filament, energy, labour), charts by period, filters by material and outcome
- **Live printers** (optional): status on the dashboard and each printer's page, and prints recorded by themselves when a job ends, from Klipper (Moonraker), Bambu Lab (cloud or your network), Prusa (PrusaLink) and OctoPrint printers; a printer that reads its trays (Bambu LAN) loads its spools by itself; see the [support matrix](#supported-printers)
- **Integrations** (optional): Bambu Cloud, Bambu Studio and OrcaSlicer (on your PC, or installed on a server or NAS from the app), and Spoolman (import spools, write usage back), with a sync mode and frequency per data type, cards fold (a card with an error opens by itself), and a **Sync** button on Printers, Filament, Prints and Catalog for the sources on Auto
- **Import**: 16 types as spreadsheets (your things, money, maintenance, printer and filament catalogs) and slicer catalogs from a zip, reviewed row by row before anything is saved; every type exports in the same format
- **Backups**: scheduled online SQLite backups, restore, CSV, JSON and spreadsheet export
- **Logs** (optional): what the app does, by module and level, with retention limits; off by default
- **Light and dark themes**, mobile-friendly, keyboard navigable, searchable dropdowns; set your own app name, logo, favicon, date and time format

| | |
|---|---|
| ![Printers](docs/images/printers.png) | ![Filament](docs/images/filament.png) |
| ![Prints](docs/images/prints.png) | ![Project detail](docs/images/project.png) |
| ![Stats](docs/images/stats.png) | ![Quotes](docs/images/quotes.png) |

<details>
<summary>More screenshots</summary>

| | |
|---|---|
| ![Printer](docs/images/printer.png) | ![Accessory](docs/images/accessory.png) |
| ![Maintenance](docs/images/maintenance.png) | ![Maintenance task](docs/images/maintenance-type.png) |
| ![Spool](docs/images/spool.png) | ![Filament preset](docs/images/filament-preset.png) |
| ![Print](docs/images/print.png) | ![Projects](docs/images/projects.png) |
| ![New quote](docs/images/quote-new.png) | ![Settings](docs/images/settings.png) |
| ![Orders](docs/images/orders.png) | ![Order](docs/images/order.png) |
| ![Clients](docs/images/clients.png) | ![Client](docs/images/client.png) |
| ![Alerts](docs/images/alerts.png) | ![Alert](docs/images/alert.png) |
| ![Import and export](docs/images/import.png) | ![Integrations](docs/images/integrations.png) |
| ![Users](docs/images/users.png) | ![Roles](docs/images/roles.png) |
| ![Sign in](docs/images/login.png) | ![My account](docs/images/my-account.png) |
| ![Hub management](docs/images/hub.png) | ![File versions](docs/images/file-history.png) |
| ![Slicer presets](docs/images/presets.png) | ![Quote](docs/images/quote.png) |

</details>

## Install

**Installers (Windows, macOS, Linux x64 and ARM64)**: download the file for your system from the [latest release](https://github.com/emanuelmoniz/3d-maker-suite/releases/latest) and double-click it. No Git, Node or pnpm needed. The installers are not code-signed, so Windows and macOS show a one-time warning: see [the install guide](https://emanuelmoniz.github.io/3d-maker-suite/Install-on-Windows).

**From source** (developers): **Node.js 22 LTS** and **pnpm**.

```bash
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

Then open <http://127.0.0.1:4300>. Steps for Windows, macOS, Linux, Docker (also for a NAS) and from source: [the install pages](https://emanuelmoniz.github.io/3d-maker-suite/Choose-How-to-Run).

To update, use **Settings → About & updates → Update**: the app backs up, installs the new release, restarts, and lets you roll back ([details](https://emanuelmoniz.github.io/3d-maker-suite/Updates)).

## Connect Bambu Cloud (optional)

Sign in with your Bambu account on the Integrations page. The app syncs print history every hour and printers every day by default (mode and frequency are set per type), and you can sync each type or a date range by hand. Every new print is recorded at once; a filament slot the app isn't sure about waits in **Prints → Filament to review**. Manual entry works without an account.

Details, region choice and troubleshooting: [Bambu Cloud in the guide](https://emanuelmoniz.github.io/3d-maker-suite/Bambu-Cloud).

## Using it from another device

By default the app only answers on this PC. To reach it from your phone or another computer on your network, set `HOST` (or the host in Settings → Network) and create accounts for the people who use it ([the guide](https://emanuelmoniz.github.io/3d-maker-suite/Users)). Running it on a NAS? See [Docker on a NAS](https://emanuelmoniz.github.io/3d-maker-suite/Docker#on-a-nas). See [Configuration in the guide](https://emanuelmoniz.github.io/3d-maker-suite/Configuration).

## Supported printers

A printer on your network is added by its address (and key) in Integrations, linked to a printer you already have or a new one, and is read-only: the app never controls a printer. Prints are recorded when a job ends, once, also when two sources report the same printer.

| Printer | Source | Live status | Prints recorded | Grams | Spool |
|---|---|---|---|---|---|
| Klipper | [Moonraker](https://emanuelmoniz.github.io/3d-maker-suite/Moonraker) | yes | live, and its history | file totals per tool; the length really extruded for a cancelled print | the Spoolman spool a job names |
| Bambu Lab | [Bambu LAN](https://emanuelmoniz.github.io/3d-maker-suite/Bambu-LAN) | yes | live | the job's 3MF, per AMS slot | AMS RFID tag; trays loaded by themselves |
| Bambu Lab | [Bambu Cloud](https://emanuelmoniz.github.io/3d-maker-suite/Bambu-Cloud) | no | history | from the cloud | the cloud's filament manager |
| Prusa (MK4, XL, MINI, MK3) | [PrusaLink](https://emanuelmoniz.github.io/3d-maker-suite/PrusaLink) | yes | live | the job file's totals | loaded spool |
| Any printer behind OctoPrint | [OctoPrint](https://emanuelmoniz.github.io/3d-maker-suite/OctoPrint) | yes | live | the job file's totals | loaded spool |

Bambu Cloud and Bambu LAN can both be set up for one printer: it stays one printer and each print is recorded once. [Spoolman](https://emanuelmoniz.github.io/3d-maker-suite/Spoolman) is a spool library, not a printer source: it imports your spools and gets each print's usage written back.

PrusaLink and OctoPrint follow printer messages others published, and Bambu LAN with LAN Only mode on is untried: none of them is checked on a real printer yet.

## Documentation

The user guide is at [emanuelmoniz.github.io/3d-maker-suite](https://emanuelmoniz.github.io/3d-maker-suite/), with search, and every install and Docker image carries a copy for its own version at `/guide/` that works offline. The same pages are also on the [GitHub wiki](https://github.com/emanuelmoniz/3d-maker-suite/wiki). Both are written in [`wiki/`](wiki), see [the wiki guide](docs/wiki-guide.md). Its pages:

| Topic | Where |
|---|---|
| Install and first run | [Choose How to Run](https://emanuelmoniz.github.io/3d-maker-suite/Choose-How-to-Run) |
| Settings and environment variables | [Configuration](https://emanuelmoniz.github.io/3d-maker-suite/Configuration) |
| Bambu Cloud setup | [Bambu Cloud](https://emanuelmoniz.github.io/3d-maker-suite/Bambu-Cloud) |
| Klipper printers (Moonraker) setup | [Moonraker](https://emanuelmoniz.github.io/3d-maker-suite/Moonraker) |
| Bambu Lab printers on your network (Bambu LAN) setup | [Bambu LAN](https://emanuelmoniz.github.io/3d-maker-suite/Bambu-LAN) |
| Prusa printers (PrusaLink) setup | [PrusaLink](https://emanuelmoniz.github.io/3d-maker-suite/PrusaLink) |
| OctoPrint setup | [OctoPrint](https://emanuelmoniz.github.io/3d-maker-suite/OctoPrint) |
| Spoolman: import spools, write usage back | [Spoolman](https://emanuelmoniz.github.io/3d-maker-suite/Spoolman) |
| Project folders: structure, depths, Docker | [Projects](https://emanuelmoniz.github.io/3d-maker-suite/Projects) |
| Import spreadsheets and slicer catalogs | [Import and Export](https://emanuelmoniz.github.io/3d-maker-suite/Import-and-Export) |
| Printers, usage and maintenance | [Printers](https://emanuelmoniz.github.io/3d-maker-suite/Printers) |
| Archive, delete and bulk actions | [Archive and Delete](https://emanuelmoniz.github.io/3d-maker-suite/Archive-and-Delete) |
| Slicing: server slicers, presets, Docker | [Slicers](https://emanuelmoniz.github.io/3d-maker-suite/Slicers) |
| Slicer program | [Slicers](https://emanuelmoniz.github.io/3d-maker-suite/Slicers) |
| Hub and connector | [Hub Setup](https://emanuelmoniz.github.io/3d-maker-suite/Hub-Setup) |
| Users and roles | [Users](https://emanuelmoniz.github.io/3d-maker-suite/Users) |
| Backups | [Backups and Restore](https://emanuelmoniz.github.io/3d-maker-suite/Backups-and-Restore) |
| Logs | [Logs](https://emanuelmoniz.github.io/3d-maker-suite/Logs) |
| FAQ | [FAQ](https://emanuelmoniz.github.io/3d-maker-suite/FAQ) |
| Architecture and decisions | [docs/architecture.md](docs/architecture.md), [docs/adr](docs/adr/) |
| Contributing, adapters, languages | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changes | [CHANGELOG.md](CHANGELOG.md) |

## Status

Version 6.2.0. English only for now; the code is ready for more languages (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## License

[MIT](LICENSE). The Bambu Cloud integration uses an unofficial API and is not affiliated with Bambu Lab.
