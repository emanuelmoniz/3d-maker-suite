# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.0.0-alpha.2] - 2026-10-21

### Added
- Alerts: one "Needs attention" list with severity, module and the task that raised each alert; the alert name opens its view
- Alerts: view with details (sync log), mark as read or unread, snooze, dismiss or restore, and actions to open the spool, task or integration
- Alerts: history table of snoozed, read, dismissed and resolved alerts, with filters and sort
- Alerts: per-task settings. Maintenance types set their own warning lead (days, hours or prints) and on/off switches; spools set a low weight; each sync type picks which of error, review and success it raises
- Alerts: ntfy and email (SMTP) channels with a test send; secrets are encrypted and never shown again
- Alerts: a warning for maintenance in print hours and prints by default

### Changed
- Alerts: live counts in the alert view, not in its title; the spool-low title is shorter and shows the weight

## [3.0.0-alpha.1] - 2026-10-21

### Added
- Projects: image gallery above the project info; pick images from the project folder, choose the cover, and open them in a viewer
- Projects: "Files per project" limit in Settings; a scan lists at most that many files per folder
- Projects: Plates, Prints, Files and the description are collapsible sections
- Projects: material usage and production cost components, shared by the project and quote pages
- Printers: success rate column and an hours filter in the printers table
- Tables: searchable choice filters on every table

### Changed
- Filament: default order by remaining weight, grams shown as whole grams everywhere
- Projects: "Set up slicing" is now "Set up print"; the project page layout and labels were reworked, and the folder label shows the project's last two folders
- Settings: config tables sort by brand and model; accessories can be exported; "Track usage" is hidden when there are no prints
- Quote page shows which printer its cost is for

### Fixed
- Folder scan does one pass per request, and the watcher scans only the folder that changed
- Scan drops gallery picks whose files were removed outside the app
- Folder labels use the path's own separator and run from the project root down
- Low-spool tag sits left of the remaining weight

## [2.0.0] - 2026-10-21

### Added
- Projects: manage the files in a project folder: upload, create folders, move (pick the destination among the folders), bulk move and remove
- Projects: choose the default 3D preview file, kept when the folder is re-scanned
- Projects: description editor with a markdown preview; saving writes the linked `.md` file
- Projects: "View all" shows a mosaic of the plate previews, plus one cost estimate for the whole print

### Fixed
- 3MF files with large meshes are parsed instead of dropped
- Preview choice works with Windows paths and returns to the project after saving
- Plate preview, description editor and slicing work on the edit page

## [2.0.0-alpha.3] - 2026-10-19

### Added
- Accounting: **Clients** with name and mobile (required), VAT, email, address and notes; VAT, mobile and email must be unique
- Quotes: numbered like the other modules, with notes, an optional client and an optional project; a list on the Costs page and tables on project and client pages
- Quote calculator reworked: picking a project fills the quote from it (printable files, plates, print profile and filament), all editable; without a project everything is manual and optional
- Orders: a number, a client, a project, an optional quote, a price, a status (accepted, in progress, done, canceled) and notes; a print can belong to one order, and the order page shows its prints and their cost
- Orders can be created from a quote; project and client pages list their orders
- Import and export of clients, quotes and orders from the file import, with a template and review like prints

### Changed
- "Pieces" on quotes becomes "Prints" and moves to the print section; labour hours are per print
- Sidebar: quotes, orders and clients sit in the Accounting group

## [2.0.0-alpha.2] - 2026-10-19

### Added
- Projects: slicing per plate with print profiles and filament per slot, run by Bambu Studio on the server's PC (set its **Slicer program** in Integrations); results are stored and cached until the file, presets or slicer change
- Projects: estimated cost of one complete print from the sliced (or typed) time and grams per plate, next to the printed-copies cost
- Projects: "Slicing" column and filter (not set up, needs slicing, sliced)
- Projects: printer per plate, the 3MF's own print profile, and spools per slot

### Changed
- Projects: filament usage is listed in rows, like the cost breakdown

### Fixed
- Painted filaments and a modifier's filament count as slots of their plate
- Slicing keeps the 3MF's own setting changes on top of the chosen print profile, and passes complete presets so purges and the prime tower count
- Clearing a plate's results when its presets were incomplete
- A printer or filament sync also imports built-in print profiles and filament presets
- Printer model labels don't repeat the brand

## [2.0.0-alpha.1] - 2026-10-18

### Added
- Accessories: data, pages and install history (put on or remove from a printer, with past periods), photos, tags, notes, typical power
- Accessory usage: prints of the printer it was on while installed, shown on the accessory page and in the accessories table
- Maintenance for accessories: types target a printer or an accessory, tasks point at one of them, and due status and alerts include both
- Lifetime hours and "include maintenance cost" per printer and accessory, with the Costs defaults as fallback; accessories also have "count in costs"
- Costs settings: a Printers section (count printers in costs, lifetime, maintenance) and accessory defaults
- A print pays for its printer plus every counted accessory installed on it when it started
- Printers: "count in costs" switch, and prints and print time columns in the printers table
- Printer and accessory import from a file, with the same cost columns and review
- Stats: material filter, outcome filter, and labels on every filter and chart control
- Estimated duration when a print is created or edited with grams and no duration

### Changed
- Stats: filament rows are split by grams, so rows add up to the totals; the filament filter counts only that filament's grams and share of time and costs
- Stats: the page opens on All time by month; series fill empty buckets so the chart and CSV keep a true time axis
- Every table can sort and filter; the project column sits on the prints table
- Sidebar: Accounting group, with Projects before Prints
- Covers are removed from prints; the Bambu cover mapping goes with them

### Fixed
- Lists keep their scroll position after search, sort and filter
- Stats project filter lists the highest number first
- Maintenance due table no longer crashes on types without a days interval

## [1.3.0] - 2026-10-16

### Added
- Sync from Bambu Cloud button on the Printers, Prints and Filament pages, for that page's data type
- Sync result alerts: new and updated rows, rows waiting for review, or an error
- Date and time format preferences in Settings → General (24- or 12-hour clock)
- Bulk set spool and bulk set project and usage tracking for print rows in the import review, in one panel with one Apply
- Searchable dropdowns replace every native select
- Default printer is a dropdown on the printers config page
- Filament default filter, and default sort orders on the lists

### Changed
- Projects: prints and printed-copies cost sit beside the preview, the description below the plates, and the prints list above the files
- Imported prints are numbered oldest first; cloud prints are renumbered on sync
- Back links go back in history, with a fixed route as the fallback

### Fixed
- Two-decimal grams accepted on every weight input
- Customize mode on the home page: controls no longer overlap widgets, touch targets are 40px
- Project folders stay renamable while the server runs
- Column filter popover stays on screen

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
