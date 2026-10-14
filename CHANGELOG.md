# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0-alpha.1] - 2026-10-14

### Added
- Integrations hub: one page for every account and slicer, with a sync mode, frequency and "Sync now" per data type, and a sync log
- Sync by type and date range; Bambu print history can be re-imported for a range
- Bambu Cloud and Bambu Studio are separate integrations; Studio reads a local config folder
- OrcaSlicer integration: reads its presets and can open projects in OrcaSlicer
- Import page for spreadsheets (spools, printers, prints): download a template, upload or export, review every row before saving, and see the import history
- Import printers and print history from integrations, and filament and machine profiles from a local slicer
- Import a slicer catalog from a zip, for a server with no slicer installed
- Multicolor prints: up to 16 filament slots per print in the import
- Filament brands and materials catalog; printer brands, printer models and machine profiles
- Maintenance types can apply to several printer models or to specific printers
- Projects: multicolor column and filter, last print column and sort, 3MF filament colours in the 3D viewer
- Tables use server-side paging, sorting and column filters
- Server port and host set by a command-line flag, environment variable or in Settings (with a restart button)
- Custom app name, logo and favicon in Settings
- Integrations link in the sidebar; back links on detail, edit and login pages

### Changed
- Integrations page lists each integration's enabled state; a disabled card hides its sync and import options

### Fixed
- Spool low alerts show the spool name and refresh when the spool changes
- Projects: sliced plates are told apart; sliced exports are read; 3MF scan finds more files
- Bambu print history pages by offset (the API ignores the cursor)
- Printers page loads its translations and keeps the show-archived switch when no printer is active

## [1.0.0] - 2026-10-09

### Added
- Printers with timeline, comments, warranty and purchase details
- Maintenance tasks due by hours, prints or days
- Filament profiles, spools and low-spool alerts
- Projects from 3MF files, with thumbnails, tags and collections
- Prints with outcome, filament usage per AMS slot and energy
- Cost snapshots and stats by period
- Bambu Cloud integration: printers, print history and spools
- Scheduled online backups, restore, CSV and JSON export
- Optional `APP_PASSWORD` for access from other devices
- Light and dark themes, responsive layout, keyboard navigation

### Security
- Host check on incoming requests; optional password for remote access
- Raw settings API removed; `@fastify/static` updated
