# 3D Maker Suite

A local-first manager for your 3D printing: printers, maintenance, filament, projects, prints, costs and stats. Runs on your own PC. Your data stays in a SQLite file on your disk.

<!-- SCREENSHOT: dashboard (light theme), 1280px wide -->
![Dashboard screenshot](docs/images/dashboard.png)

## Features

- **Printers**: inventory, timeline, comments, warranty and purchase info
- **Maintenance**: reusable tasks, due by hours, prints or days
- **Filament**: profiles, spools, remaining grams, low-spool alerts
- **Projects**: 3MF models with plates, thumbnails, tags and collections
- **Prints**: history with outcome, filament usage per AMS slot, energy
- **Costs and stats**: cost per print snapshotted at record time, charts by period
- **Bambu Cloud sync** (optional): printers, print history and filament spools
- **Backups**: scheduled online SQLite backups, restore, CSV and JSON export
- **Light and dark themes**, mobile-friendly, keyboard navigable

<!-- SCREENSHOT: printers list or project detail -->
![Printers screenshot](docs/images/printers.png)

## Install

Requirements: **Node.js 22 LTS** and **pnpm**.

```bash
git clone https://github.com/emanuelmoniz/3d-maker-suite.git
cd 3d-maker-suite
pnpm install
pnpm start
```

Then open <http://127.0.0.1:4300>. Full steps and Windows notes: [docs/install.md](docs/install.md).

## Connect Bambu Cloud (optional)

Sign in with your Bambu account on the Integrations page. The app syncs printers and print history every 15 minutes. Manual entry works without an account.

Details, region choice and troubleshooting: [docs/bambu-cloud.md](docs/bambu-cloud.md).

## Using it from another device

By default the app only answers on this PC. To reach it from your phone or another computer on your network, set `APP_PASSWORD` and `HOST`. See [docs/configuration.md](docs/configuration.md).

## Documentation

| Topic | Where |
|---|---|
| Install and first run | [docs/install.md](docs/install.md) |
| Settings and environment variables | [docs/configuration.md](docs/configuration.md) |
| Bambu Cloud setup | [docs/bambu-cloud.md](docs/bambu-cloud.md) |
| Open in slicer | [docs/open-in-slicer.md](docs/open-in-slicer.md) |
| Backups | [docs/backups.md](docs/backups.md) |
| FAQ | [docs/faq.md](docs/faq.md) |
| Architecture and decisions | [docs/architecture.md](docs/architecture.md), [docs/adr](docs/adr/) |
| Contributing, adapters, languages | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changes | [CHANGELOG.md](CHANGELOG.md) |

## Status

Version 1.0. English only for now; the code is ready for more languages (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## License

[MIT](LICENSE). The Bambu Cloud integration uses an unofficial API and is not affiliated with Bambu Lab.
