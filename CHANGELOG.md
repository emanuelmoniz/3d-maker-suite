# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0-alpha.1] - 2026-10-15

### Added
- Settings module pages for costs, prints, projects, printers, filament and alerts, with gear buttons on each page
- Path picker in Settings to choose the slicer executable, config folders and project roots
- Projects: add a project from a folder, and link a `.md` or `.txt` file as its description (`.md` is rendered as markdown)
- Projects: pick the project on the print form
- Filament: spool number and colour name, with a display name built from them; numbers are unique and padded in display names
- Printers and projects get a unique, editable number and display name
- Spool numbers and colour names in the spreadsheet import
- Prints import creates print numbers and requires a project for every imported print
- Estimated print duration when a print has grams but no time, plus an "Estimate from filament" button on the print form
- `sync_pending` alert for rows an automatic sync leaves for your review, with a Review button and a toggle
- Review synced prints and match spools added later; pick the spool per slot in the sync review
- Spool pickers for file prints in the import review, add a spool from the review, and a track-usage tick per print row

### Changed
- Spools go empty at 0 g and refuse prints from before they were opened
- Spools are matched by capacity and age; guesses are flagged for review
- Filament usage always takes grams from the spool, including for prints older than it
- Spool page lists its prints and projects; clearer filament errors
- MakerWorld prints link to projects by the model title in the 3MF
- Duration section sits after filament on the print form

### Fixed
- Import matches references by their number, padded or not
- Duplicate file-upload label focus outline removed
- Responsive layout fixes found by the end-to-end pass at 375, 768 and 1440 px

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
