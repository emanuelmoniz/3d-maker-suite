# 3D Maker Suite

A local-first manager for your 3D printing: printers, accessories, maintenance, filament, projects, prints, costs, quotes and stats. Runs on your own PC. Your data stays in a SQLite file on your disk.

![Dashboard screenshot](docs/images/dashboard.png)

## Features

- **Printers**: inventory, timeline, comments, warranty and purchase info, lifetime and maintenance cost
- **Accessories**: install on a printer with dates, usage, photos, tags, maintenance and cost
- **Maintenance**: reusable tasks for printers and accessories, due by hours, prints or days
- **Filament**: brands, materials, profiles, spools with numbers and colour names, remaining grams, low-spool alerts
- **Users and roles**: accounts for a LAN, NAS or Docker install, with viewer, editor and admin roles and a log of who changed what ([docs/users.md](docs/users.md))
- **Alerts**: one list of what needs attention (low spools, maintenance, warranties, sync results), with severity, read, snooze and dismiss, a history table, and optional ntfy or email channels; each task chooses what it raises
- **Projects**: 3MF models with plates, thumbnails, tags, collections, filament colours, files you can upload, move and remove in folders, a chosen 3D preview file, an image gallery with a cover, a markdown description (linked `.md` or `.txt` file, with an editor), and slicing per plate (Bambu Studio or OrcaSlicer, locally or on the server, automatically when a sliced file changes) for an estimated cost of one complete print
- **Prints**: history with outcome, filament usage per AMS slot (up to 16 for multicolor), energy, and an estimated duration when only the grams are known
- **Clients**: people and companies you print for, with unique VAT, mobile and email
- **Quotes**: numbered quotes from a project or typed in, with notes, client and markup on cost
- **Orders**: work agreed with a client, from a quote or on its own, with a status, a price and the cost of its linked prints
- **Costs and stats**: cost per print snapshotted at record time (printer, counted accessories, filament, energy, labour), charts by period, filters by material and outcome
- **Integrations** (optional): Bambu Cloud, Bambu Studio and OrcaSlicer (on your PC, or installed on a server or NAS from the app), with a sync mode and frequency per data type
- **Import**: 19 types as spreadsheets (your things, money, maintenance, printer and filament catalogs) and slicer catalogs from a zip, reviewed row by row before anything is saved; every type exports in the same format
- **Backups**: scheduled online SQLite backups, restore, CSV, JSON and spreadsheet export
- **Logs** (optional): what the app does, by module and level, with retention limits; off by default
- **Light and dark themes**, mobile-friendly, keyboard navigable, searchable dropdowns; set your own app name, logo, favicon, date and time format

| | |
|---|---|
| ![Printers](docs/images/printers.png) | ![Project detail](docs/images/project.png) |
| ![Prints](docs/images/prints.png) | ![Filament](docs/images/filament.png) |
| ![Stats](docs/images/stats.png) | ![Quotes](docs/images/quotes.png) |

<details>
<summary>More screenshots</summary>

| | |
|---|---|
| ![Printer](docs/images/printer.png) | ![Accessory](docs/images/accessory.png) |
| ![Maintenance](docs/images/maintenance.png) | ![Maintenance task](docs/images/maintenance-type.png) |
| ![Spool](docs/images/spool.png) | ![Filament profile](docs/images/filament-profile.png) |
| ![Print](docs/images/print.png) | ![Projects](docs/images/projects.png) |
| ![Quotes](docs/images/quotes.png) | ![Quote](docs/images/quote.png) |
| ![Orders](docs/images/orders.png) | ![Order](docs/images/order.png) |
| ![Clients](docs/images/clients.png) | ![Client](docs/images/client.png) |
| ![Alerts](docs/images/alerts.png) | ![Alert](docs/images/alert.png) |
| ![Import and export](docs/images/import.png) | ![Integrations](docs/images/integrations.png) |
| ![Settings](docs/images/settings.png) | ![New quote](docs/images/quote-new.png) |
| ![Users](docs/images/users.png) | ![Sign in](docs/images/login.png) |

</details>

## Install

**Installers (Windows, macOS, Linux)**: download the file for your system from the [latest release](https://github.com/emanuelmoniz/3d-maker-suite/releases/latest) and double-click it. No Git, Node or pnpm needed. The installers are not code-signed, so Windows and macOS show a one-time warning: see [the install guide](docs/install.md#warnings-you-will-see).

**From source** (developers): **Node.js 22 LTS** and **pnpm**.

```bash
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

Then open <http://127.0.0.1:4300>. Steps for Windows, macOS, Linux and Docker (NAS): [docs/install.md](docs/install.md).

To update, use **Settings → About & updates → Update**: the app backs up, installs the new release, restarts, and lets you roll back ([details](docs/install.md#updating)).

## Connect Bambu Cloud (optional)

Sign in with your Bambu account on the Integrations page. The app syncs print history every hour and printers every day by default (mode and frequency are set per type), and you can sync each type or a date range by hand. Prints an automatic sync cannot match to one spool wait for your review, with a **Sync needs review** alert. Manual entry works without an account.

Details, region choice and troubleshooting: [docs/bambu-cloud.md](docs/bambu-cloud.md).

## Using it from another device

By default the app only answers on this PC. To reach it from your phone or another computer on your network, set `HOST` (or the host in Settings → Network) and create accounts for the people who use it ([docs/users.md](docs/users.md)). Running it on a NAS? See [docs/install.md](docs/install.md#docker). See [docs/configuration.md](docs/configuration.md).

## Documentation

| Topic | Where |
|---|---|
| Install and first run | [docs/install.md](docs/install.md) |
| Settings and environment variables | [docs/configuration.md](docs/configuration.md) |
| Bambu Cloud setup | [docs/bambu-cloud.md](docs/bambu-cloud.md) |
| Project folders: structure, depths, Docker | [docs/projects.md](docs/projects.md) |
| Import spreadsheets and slicer catalogs | [docs/import.md](docs/import.md) |
| Slicing: server slicers, profiles, Docker | [docs/slicing.md](docs/slicing.md) |
| Open in slicer | [docs/open-in-slicer.md](docs/open-in-slicer.md) |
| Backups | [docs/backups.md](docs/backups.md) |
| Logs | [docs/logs.md](docs/logs.md) |
| FAQ | [docs/faq.md](docs/faq.md) |
| Architecture and decisions | [docs/architecture.md](docs/architecture.md), [docs/adr](docs/adr/) |
| Contributing, adapters, languages | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changes | [CHANGELOG.md](CHANGELOG.md) |

## Status

Version 4.2.1. English only for now; the code is ready for more languages (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## License

[MIT](LICENSE). The Bambu Cloud integration uses an unofficial API and is not affiliated with Bambu Lab.
