# 3D Maker Suite - Development Plan v1.2 (target: 1.2.0-alpha.1)
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.

Status legend: `[ ]` todo · `[x]` done

---

## Phase 1 - Bugs

### [x] Step 1 - Duplicate outline classes
**Model:** Haiku · **Effort:** Low
**Scope:** VS Code's Tailwind IntelliSense flags `focus-within:outline focus-within:outline-2` as a conflict. In Tailwind v4, `outline-2` already sets the outline style, so `outline` is redundant. Drop `focus-within:outline` and keep `focus-within:outline-2`, and check that the focus ring still shows. Files: `pages/import/ImportPage.tsx`, `pages/import/SlicerZipPage.tsx`, `pages/printers/PrinterDetailPage.tsx`, `pages/settings/BackupSection.tsx`, `pages/settings/BrandingFields.tsx`.
**Done when:** no Tailwind conflict warnings left in `apps/web/src`; the file-upload labels still show a focus ring with the keyboard.
**Prompt:**
```
Do Step 1 of PLAN.md. Grep for any other conflicting Tailwind class pairs while you're there.
```

---

## Phase 2 - Configuration pages

Goal of Steps 2-3: each module keeps its own settings and catalog tables on a config page (`/<module>/settings`), opened by a gear button in the module's page header. Global Settings keeps only General, Appearance, Server and Backup. Done early so later steps put new settings in their final place.

### [x] Step 2 - Config page pattern + Costs, Prints, Projects, Alerts
**Model:** Sonnet · **Effort:** Medium
**Scope:** The local `Section` in `pages/SettingsPage.tsx` becomes a shared component. One reusable gear link (i18n label, keyboard accessible) goes in the `PageHeader` actions of each module page, opening `/<module>/settings`, which has a back link to the module. Move these fields out of Settings, without changing the schema (same `usePreferences` / `useSavePreferences`):
- **Costs** (`/costs/settings`): currency, energy cost, printer lifetime hours, include maintenance, labor rate, failure margin, markup.
- **Prints** (`/prints/settings`): failure reasons.
- **Projects** (`/projects/settings`): project roots, scan depth, viewer max MB.
- **Alerts** (`/alerts/settings`): low-spool grams, maintenance lead days, alert channels (`ChannelsSection`).

The Projects empty state that links to `/settings` now links to `/projects/settings`.
**Done when:** each field is edited on its config page only; Settings shows General, Appearance, Server and Backup; e2e still green.
**Prompt:**
```
Do Step 2 of PLAN.md. Move the existing fields, don't rewrite them. Routes stay in
router.tsx like the others; one shared gear button and one shared Section component.
```

### [x] Step 3 - Printers & Filament config pages
**Model:** Sonnet · **Effort:** Medium
**Scope:** `/printers/settings`: printer states (from Settings) plus the brands, printer models and machine profiles tables with their import actions (moved from `pages/printers/Catalog.tsx`). `/filament/settings`: filament profiles, filament brands and materials tables with their import actions. The Printers page keeps only the user's printers, and the Filament page keeps only spools. Existing form/detail routes (`/printers/brands/new`, `/filament/profiles/$id`, …) keep their URLs; their back links now point to the config page. Table URL state (prefixed search params) keeps working on the new page.
**Done when:** the Printers and Filament pages show only user printers and spools; every catalog table and import action is reachable from the config pages; back links are correct; e2e still green.
**Prompt:**
```
Do Step 3 of PLAN.md. Use the gear button and Section from Step 2. Move the catalog
components as they are; list every back link you change.
```

---

## Phase 3 - Pickers & projects

### [x] Step 4 - In-app path browser  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** A browser can't give the server a full local path, so the server lists folders instead. `GET /api/fs/list?path=` returns the folders (and, in file mode, files matching an extension filter) under a path. With no path it returns the drives (Windows) or `/` plus the home folder. It returns names and types only, never file contents. It needs the same auth as the rest of the API, and the non-loopback password rule still applies. A `PathPicker` modal in web, with mode `folder | file`, an optional extension filter, breadcrumbs, an "up" button, and keyboard and mobile support. It sits next to the text input, which stays editable. Used for the slicer executable and the slicer config folder (`pages/settings/IntegrationsPage.tsx`) and for project roots (Projects config page).
**Done when:** each of the three fields can be filled from the picker; the listing endpoint is unit-tested (drives/root, filter, missing path, no content leak); tests pass.
**Prompt:**
```
Do Step 4 of PLAN.md. Show me the endpoint contract and its security rules before
implementing (reuse launcher.ts insideRoots / the existing auth hook where it fits).
No new dependency.
```

### [x] Step 5 - Projects: add folder button + linked description file
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- An "Add project" button on the Projects page opens the `PathPicker` in folder mode and creates the project through `scanner.addFolder()`. The existing manual form stays.
- The description is empty by default: the scanner (`apps/server/src/projects/scanFolder.ts`) stops filling it from readme/.md/.txt. New `descriptionFile` column (Drizzle migration). The project form offers the folder's .md/.txt files (default "None"). A linked file's text becomes the description and is re-read on every rescan. Editing the description by hand clears the link. The source-URL auto-detection stays.
- Migration: descriptions that came from the scanner and were never edited (not in `editedFields`) are cleared.
- Fix: `ProjectFormPage` sends `null` for blank description/sourceUrl, which the server counts as user-edited. Blank must mean "not edited".

**Done when:** a new project has no description; linking a file shows its text and follows file changes on rescan; editing by hand unlinks; the add-folder button creates a project; tests pass.
**Prompt:**
```
Do Step 5 of PLAN.md. Back up the DB before running pnpm dev (it applies migrations).
Show me the migration and how many existing descriptions it would clear before applying it.
```

---

## Phase 4 - Data

### [x] Step 6 - Spool number, color name & display name  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Two new spool fields and one display name used everywhere.
- **Number:** `number` (integer, unique, editable). Migration numbers existing spools 1..n by creation date. New spools get max + 1 automatically, whether added by hand, by cloud sync, or by import when the file leaves it empty. Editing to a number that is taken gives a clear validation error.
- **Color name:** optional `colorName` (e.g. "Scarlet Red"), on the spool form, detail and import/export columns. Sources:
  1. Check a raw Bambu Cloud spool response for a color name. The adapter's zod schema currently drops unknown fields.
  2. Otherwise map hex → name from Bambu Studio's `filaments_color_codes.json` (or equivalent), if the local install ships it.
  3. Manual entry always works.
- **Display name:** "{number}-{profile label} {colorName}" (e.g. "1-Bambu PLA Matte Scarlet Red"), with the hex as fallback when there's no color name, built by an i18n pattern, not by string concatenation. Use one helper in web and one SQL expression on the server:
  - web: `lib/filament.ts` `filamentLabel()`, the local `spoolLabel` in `PrintFormPage`, spool widget, stats, print detail and review;
  - server: `spoolLabel` in `routes/filament.ts` (sort/filter) and `label()` / `spoolLabels()` in `import/spools.ts`.
- **Import templates:** the spool lists in the XLSX templates (e.g. the spool dropdown in the prints template) use the new display name. Prints import resolves a spool by its display name or by its number alone. The spool template and export get the `number` column, so an edited export re-imports and matches by number.

**Done when:** existing spools are numbered; new spools from any source get the next number; a synced Bambu spool shows "N-Bambu PLA Matte Scarlet Red" (or the hex fallback); every spool name in the app and in the templates comes from the shared helper; prints import resolves spools by name or number; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md. First verify where a color name can come from (raw Bambu Cloud
response, Bambu Studio color codes file) and list every place a spool name is rendered,
matched or written to a template. Show me the migration (numbering + colorName) and the
display-name helper before implementing. Back up the DB before running the migration.
```

### [ ] Step 7 - Estimated print duration
**Model:** Sonnet · **Effort:** Medium
**Scope:** When a print has filament grams but no duration (file import and sync), estimate the duration as grams ÷ grams per hour. The rate comes from the user's own prints that have both values: the same printer if it has at least N such prints, else all prints, else a new `gramsPerHour` preference (Prints config page, sensible default). Pure function in `packages/core/src/services`. Stored with a `durationEstimated` flag (migration). It is shown as "~1h 20m" with an "estimated" tooltip, and cleared when a real duration is entered. Energy, wear and maintenance costs then work for these prints (`computeCost` / `energyFor` unchanged).
**Done when:** an imported print without a duration gets an estimated one and a full cost; entering a real duration clears the flag; unit tests on the rate fallback chain; tests pass.
**Prompt:**
```
Do Step 7 of PLAN.md. Rate logic is a pure, tested core function. Back up the DB before
running the migration.
```

### [x] Step 8 - Sync review alerts
**Model:** Sonnet · **Effort:** Medium
**Scope:** New alert kind `sync_pending`, raised in `apps/server/src/alerts/evaluate.ts` `conditions()` when an enabled integration's type is in auto mode, its alert toggle is on and `sync_policies.pending > 0`. Entity id is `integrationId:type`; the context holds the count, integration and type, and is refreshed without notifying again. The alert resolves when the queue is empty. `AlertsPage` gets an explicit "Review" button to `/import/$source/$id/$type` (source `integration`), and `messageOf` gets a case for the ntfy/email channels. New `alert` boolean on `sync_policies` (default on, fallback in `capabilities.ts`), shown as a column in the hub policies table for review types in auto mode. Migration rebuilds `alerts` for the new kind (like `0014`).
**Done when:** an auto sync that leaves rows pending raises one alert per integration + type with a working Review button; confirming the review resolves it; turning the toggle off removes it; tests in `alerts.test.ts`.
**Prompt:**
```
Do Step 8 of PLAN.md. No change to the syncer: the alert is derived from
sync_policies.pending. Back up the DB before running the migration.
```

---

## Phase 5 - Release

### [ ] Step 9 - E2E & responsive pass for v1.2
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Playwright coverage for the config pages and gear buttons, the path picker (slicer exe, config folder, project roots), add project from folder, linked description file, spool numbering and display names (UI + import template), estimated duration, and the sync_pending alert with its Review button and toggle. Viewports 375/768/1440. Fix what breaks.
**Done when:** E2E green in CI.
**Prompt:**
```
Do Step 9 of PLAN.md. Same fresh-temp-data-dir pattern as the existing suite.
List UI issues found and fix them in this step.
```

### [ ] Step 10 - Docs & v1.2.0-alpha.1 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs updates (module config pages, path picker and its security note, project description files, spool numbers and color names, estimated durations, sync alerts), CHANGELOG, version `1.2.0-alpha.1`, release workflow publishes it as a GitHub pre-release.
**Done when:** tag builds a pre-release; docs match the app.
**Prompt:**
```
Do Step 10 of PLAN.md. Only document what changed since 1.1.0-alpha.1.
```

---

## Backlog mapping
| Backlog item | Step |
|---|---|
| ImportPage duplicate Tailwind outline classes | 1 |
| Costs / prints / projects / alerts configuration pages | 2 |
| Printers configuration page (settings + brands/models/profiles tables) | 3 |
| Filament configuration page (brands/profiles/materials tables) | 3 |
| Slicer exe location picker | 4 |
| Slicer config path picker | 4 |
| Add project folder from projects page | 4, 5 |
| Project description empty by default, pick an .md file | 5 |
| Spool sequential number (editable) + auto number | 6 |
| Spool color name | 6 |
| Spool names in the import template | 6 |
| Duration estimate from filament usage | 7 |
| Integrations sync alert + enable/disable per type and integration | 8 |
