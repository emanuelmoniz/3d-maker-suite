# 3D Maker Suite - Development Plan v3 (target: 3.0.0)
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.
- Each feature step adds its own e2e spec. The last phase only runs a responsive pass over the whole suite.
- Steps that change `packages/db/src/schema.ts`: back up the DB **before** editing it (`pnpm dev` applies new migrations to the real DB).
- Releases: a `v3.0.0-alpha.N` pre-release closes phases 2, 3 and 4; `v3.0.0` closes the plan.
- Skills: `webapp-testing` for steps that need screenshots or browser checks, `frontend-design` for new visual pieces (gallery viewer, alert view).

Status legend: `[ ]` todo · `[x]` done

---

## Phase 1 - Bugs & quick fixes

### [x] Step 1 - Folder scan: one pass, only the changed project
**Model:** Sonnet · **Effort:** Medium
**Scope:** Pressing "Scan" seems to run twice, and every change on disk re-scans all projects. First confirm both: `start()` queues one more full pass when a request arrives during a scan, and the watcher in `scanner.ts` calls `start` for any change under a root. Fix: one click runs one pass. A watched change only re-scans the project folder it is in (map the changed path to its folder using `projectScanDepth`, then `refresh` it). A path under no known folder (a new folder) runs a discover on its root, not a full re-scan. A full scan stays available from the button. Writes made by the app itself (uploads, description editor) must not trigger a second scan of the same folder. The Windows folder-lock fix still holds. Check if full scan run when server start, it should.
**Done when:** the summary explains why it ran twice; one click = one pass; changing a file in one project only scans that project (test with two folders); a new folder is picked up; tests pass.
**Prompt:**
```
Do Step 1 of PLAN.md. Reproduce and explain the double run first. Keep one recursive watch
per root; only change what a change event triggers.
```

### [x] Step 2 - Filament: default order and whole grams everywhere
**Model:** Haiku · **Effort:** Low
**Scope:**
- Filament page: sorted by remaining weight by default, lowest first.
- Every weight in the app shows as whole grams: `728 g`, `1000 g`, never `1kg` and never decimals. Fix it once in the shared weight formatter, and replace the places that format weights on their own. Locale-aware number formatting stays.
- CSV exports keep their raw values.

**Done when:** the filament page opens sorted by remaining weight, lowest first; the summary lists every place that formats a weight, and all of them use the shared formatter; no `kg` left in the UI; tests pass.
**Prompt:**
```
Do Step 2 of PLAN.md. Grep every weight formatter first and route them all through one.
```

### [x] Step 3 - Small table fixes: config sorting, Track usage, accessory exports
**Model:** Haiku · **Effort:** Low
**Scope:**
- Printers config page: the Printer models table sorts by brand, and the Machine profiles table sorts by printer model.
- Integrations: hide the "Track usage" column when none of the integration's policies is `prints` (e.g. Bambu local).
- Settings → Backup → Export: add Accessories and Accessory installs. The server already exports both (`routes/export.ts`), so only the `TABLES` list in `BackupSection.tsx` and its i18n keys are missing.

**Done when:** both columns sort; Bambu local shows no Track usage column and Bambu Cloud still does; both exports download as CSV and JSON; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 3 of PLAN.md.
```

### [x] Step 4 - Searchable choice filters on every table
**Model:** Sonnet · **Effort:** Medium
**Scope:** Every multiple-choice filter in every table can be searched as you type, so the user doesn't scroll through every option. Known cases: printer model in the Print profiles and Machine profiles tables, and brand in the Printer models table. Do it once in the shared `FilterBar` / `DataTable` filter, not per table. Keyboard accessible, mobile friendly, no new dependency.
**Done when:** the summary lists every table with a choice filter; all of them search as you type; the keyboard works (type, arrows, enter, escape); e2e on one table; tests pass.
**Prompt:**
```
Do Step 4 of PLAN.md. List every choice filter first, then fix it in the shared filter
component.
```

### [x] Step 5 - Printers table: prints, hours, success rate
**Model:** Sonnet · **Effort:** Low
**Scope:** The printers table gets three columns: number of prints, print hours and success rate. All three sort and filter like the other columns. Reuse `printerStats` from core and the same duration rules as stats (estimated durations count). Define the success rate (e.g. successful / prints with an outcome, canceled left out) and state it in the summary.
**Done when:** the numbers match the printer page and stats for the same printer; the columns sort; tests pass.
**Prompt:**
```
Do Step 5 of PLAN.md. Reuse printerStats; tell me the success rate definition you used.
```

---

## Phase 2 - Project page

### [x] Step 6 - Project page layout and labels
**Model:** Haiku · **Effort:** Low
**Scope:**
- Remove the line "PLA · Multicolor - BambuStudio … · Bambu Lab A1 · 0.4 mm" from the project page.
- The location goes below the project name and buttons, left-aligned, full content width.
- The "Description" label becomes "Project info" on the project page and on the edit page.
- "Slicing setup" becomes "Print setup" everywhere it shows (i18n values only, keys can stay).

**Done when:** the page matches the description at 375 and 1440; i18n:check passes; e2e updated; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md.
```

### [x] Step 7 - Collapsible sections
**Model:** Sonnet · **Effort:** Low
**Scope:** One generic collapsible section component in `apps/web/src/components` (native `<details>`/`<summary>` unless there's a reason not to), closed by default, keyboard accessible. On the project page, Plates, Print setup, Prints and Files use it.
**Done when:** the four sections start closed and open with mouse and keyboard; e2e opens one; tests pass.
**Prompt:**
```
Do Step 7 of PLAN.md.
```

### [x] Step 8 - Material usage and production cost components
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- The project page and the quote calculator use the same component for the estimated cost of one print, renamed to "Production cost of one print" on both pages.
- Its material part becomes its own component, "Material usage of one print", shown before the production cost on both pages.
- Same numbers as today (`computeCost`), no new cost logic.

**Done when:** both pages render the same two components; a project and a quote made from it show the same numbers; e2e; tests pass.
**Prompt:**
```
Do Step 8 of PLAN.md. Show me the two component APIs and how both pages feed them first.
```

### [x] Step 9 - Project image gallery: data and edit page  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- On the edit page the user chooses the gallery images: one or more folders (all their images show) and/or single images, inside the project folder. Formats: SVG, PNG, JPEG.
- One image can be marked as the cover. The cover is the project's thumbnail on the projects page and everywhere else a project thumbnail shows. With no cover, today's thumbnail stays.
- The choices survive a re-scan (`editedFields`). Images are served through the v2 path guard. SVGs must be served so they can't run scripts (e.g. `Content-Security-Policy` / `<img>` only).

**Done when:** the schema is approved; gallery and cover save, reload and survive a re-scan; the cover shows as the thumbnail; route tests refuse paths outside the project; tests pass.
**Prompt:**
```
Do Step 9 of PLAN.md. Show me the schema, the routes and how SVGs are served safely first.
Back up the DB before editing schema.ts.
```

### [x] Step 10 - Project image gallery: viewer
**Model:** Sonnet (use frontend-design and webapp-testing skills) · **Effort:** Medium
**Scope:** A gallery section on the project page (collapsible, from Step 7). Clicking an image opens a full-screen modal with zoom (wheel, pinch, buttons) and pan (drag, touch), next/previous, and escape to close. Mobile friendly, keyboard accessible, i18n, no new dependency unless the reason holds. redesing image galery setings in project edit page. add search functions, user can preview files with the modal, in short a more friendly design to be easier to pick images and manage them.
**Done when:** it works with mouse, keyboard and touch at 375/768/1440 (screenshots); e2e; tests pass.
**Prompt:**
```
Do Step 10 of PLAN.md. Screenshot at the 3 viewports when done.
```

### [x] Step 11 - Docs, push & v3.0.0-alpha.1
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for Steps 1-10, CHANGELOG, version `3.0.0-alpha.1`. Refresh `pnpm screenshots` (project page changed). Commit, push `main`, create and push tag `v3.0.0-alpha.1`. The release workflow publishes it as a pre-release; check that the run succeeds (`gh run watch`) and the release exists (`gh release view v3.0.0-alpha.1`).
**Done when:** `main` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 11 of PLAN.md. Only document what changed since 2.0.0. Then push main, push the
tag and confirm the pre-release is published.
```

---

## Phase 3 - Alerts

### [x] Step 12 - Alert manager: severities, sources, details  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Today `alerts/evaluate.ts` has one kind per case, global settings (`lowSpoolGrams`, `maintenanceLeadDays`) and one `alert` flag per sync policy. The new model:
- Every alert has a **severity** (`error` · `warning` · `success`), a **module** (maintenance, integrations, filament, printers, …), a **task** (e.g. "Bambu Cloud · prints sync", the maintenance name, the spool) and a **detail** payload (e.g. the full sync log, the prints no spool matched).
- Each task decides which severities it raises (configured in Step 13). Defaults keep today's behaviour.
- Syncs store the full run log, so an alert can show it (bounded size, no secrets).
- The existing kinds are mapped onto the new model by the migration; open alerts survive it.
- Write `docs/adr/0008-alerts.md` (the model, how the old kinds map, the rejected options).

**Done when:** the ADR and the schema are approved; every current alert source raises through the manager with severity, module, task and detail; old alerts migrate; `alerts.test.ts` covers each severity; tests pass.
**Prompt:**
```
Do Step 12 of PLAN.md. Show me the ADR draft, the schema and how each existing kind maps
before implementing. Back up the DB before editing schema.ts.
```

### [x] Step 13 - Alert settings per task
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Maintenance: per maintenance type, a warning X days (or hours/prints) before due and an error when overdue, each one on or off. The global `maintenanceLeadDays` becomes the default.
- Filament: in spool settings, a low-weight warning at a configurable weight (default is today's `lowSpoolGrams`), on or off.
- Integrations: per sync task (prints, printers, print profiles, …), pick which of error / warning / success it raises. This replaces the single `alert` checkbox.
- Empty means "use the default", like the cost settings in v2.

**Done when:** each setting changes which alerts are raised (one test per module); defaults keep today's behaviour; e2e on one setting per module; tests pass.
**Prompt:**
```
Do Step 13 of PLAN.md. Reuse the "empty = default" pattern from the v2 cost settings.
```

### [x] Step 14 - Alert view, actions and notifications
**Model:** Sonnet (use frontend-design skill) · **Effort:** Medium
**Scope:**
- "Open alert" on the alerts page opens a detail view: module, task, severity, the full detail (sync log, prints without a spool match, …) and the actions that fit. Maintenance: mark as done, postpone. Integrations: open the review on a warning, open the integration page on an error.
- ntfy and email notifications carry the same details (title, severity, module, task, a detail summary, a link to the alert). Email gets the full detail and ntfy a short form, within its size limit.
- i18n for every label; the server-side notification text stays as it is today.

**Done when:** each module's alert opens with its detail and action, and the action works; a test email/ntfy body contains the details; e2e; tests pass.
**Prompt:**
```
Do Step 14 of PLAN.md. Reuse the existing alert actions (read, dismiss, snooze) where they fit.
```

### [x] Step 15 - Docs, push & v3.0.0-alpha.2
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for the alert manager, per-task settings and the alert view, CHANGELOG, version `3.0.0-alpha.2`. Commit, push `main`, create and push tag `v3.0.0-alpha.2`; check the workflow run and the pre-release.
**Done when:** `main` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 15 of PLAN.md. Only document what changed since 3.0.0-alpha.1. Then push main,
push the tag and confirm the pre-release is published.
```

---

## Phase 4 - Imports & auto slicing

### [x] Step 16 - Import accessory installs (file)
**Model:** Sonnet · **Effort:** Medium
**Scope:** Accessory installs become a file import type (template, parsing, review, apply), like prints. Accessory and printer are referenced by number or name; an unknown reference or an overlapping period is an invalid row (same rule as the API).
**Done when:** a template round-trips with the export; bad references and overlaps show in the review; tests in `importExport.test.ts`; e2e; tests pass.
**Prompt:**
```
Do Step 16 of PLAN.md. Follow how the prints import type is built, end to end.
```

### [x] Step 17 - Import projects (file)  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Projects become a file import type. A row with no folder (or a folder that doesn't exist) is highlighted given the option to user select a specific folder (if already contents, alert user and ask if wants to update project info with file info) or user select create folder option and app create folder with user folder name input or system create a folder with the a naming convention if user dont fill the folder name when create is selected.
- In the review the user can map a folder to each row (reuse `PathPicker`, within the project roots) and see or change which prints get linked.
- Prints are linked automatically with the same matching `linkPrints` uses; the user can add or remove prints in the review.
- A row whose folder already belongs to a project is an update or an invalid row (propose which).

**Done when:** the plan is approved; a template round-trips with the projects export; rows with and without a folder import; folder and print mapping in the review are applied; tests; e2e; tests pass.
**Prompt:**
```
Do Step 17 of PLAN.md. Show me the review columns, the folder/print mapping and how it
reuses linkPrints first.
```

### [x] Step 18 - Auto slicing on file change  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Auto slice per project folder root (a checkbox per root in the Project folders list, on by default; the list replaces the textarea and has a remove button per root), overridden per project in its Print setup (folder default / on / off). When the scanner sees that a sliced file changed, the outdated plates are sliced again with their saved setup, through the existing slice job (one at a time, never blocking the server).
- If the change alters the setup (plates added or removed, a plate with new filament slots), don't guess: raise a warning alert (Step 12 manager) linking to the project's Print setup, and slice only the plates that are still valid. An auto slice that fails raises an error alert.
- Runs on the Step 1 single-folder scan, so one change slices one project, and on full scans (the Scan button and startup), so changes made while the app was off are sliced too.

**Done when:** changing a fixture file re-slices only its outdated plates (mock slicer); a new plate or slot raises one warning and no wrong slice; a failed auto slice raises one error; auto slice off = today's behaviour; tests; e2e with the mock adapter; tests pass.
**Prompt:**
```
Do Step 18 of PLAN.md. Show me how a changed file is classified (same plates / changed
setup) before implementing.
```

### [x] Step 19 - Docs, push & v3.0.0-alpha.3
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for the accessory-install and project imports and auto slicing, CHANGELOG, version `3.0.0-alpha.3`. Commit, push `main`, create and push tag `v3.0.0-alpha.3`; check the workflow run and the pre-release.
**Done when:** `main` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 19 of PLAN.md. Only document what changed since 3.0.0-alpha.2. Then push main,
push the tag and confirm the pre-release is published.
```

---

## Phase 5 - Release

### [ ] Step 20 - Responsive pass & screenshots for v3
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Run the whole e2e suite at 375/768/1440 and fix what breaks. Fill e2e gaps left by earlier steps. Refresh the README screenshots with `pnpm screenshots`.
**Done when:** E2E green in CI; screenshots match the app.
**Prompt:**
```
Do Step 20 of PLAN.md. List the UI issues found and fix them in this step.
```

### [ ] Step 21 - Docs, push & v3.0.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs (anything missed), CHANGELOG, version `3.0.0`. Commit, push `main`, create and push tag `v3.0.0`. The release workflow publishes it as the latest release; check the run (`gh run watch`) and the release (`gh release view v3.0.0`).
**Done when:** `main` and the tag are pushed; the workflow is green; the release is the latest; docs match the app.
**Prompt:**
```
Do Step 21 of PLAN.md. Only document what changed since 3.0.0-alpha.3. Then push main,
push the v3.0.0 tag and confirm the release is published.
```

---

## Backlog mapping
| Backlog item | Step |
|---|---|
| folder scan runs twice, scans every project | 1 |
| filament page: order by remaining, grams format | 2 |
| printers config page: order by brand / printer model | 3 |
| Track usage in Bambu local integration | 3 |
| accessories export, accessories installs export | 3 |
| tables filters: searchable multiple choice | 4 |
| printers page: prints, hours, success rate | 5 |
| project page: remove info line, location, "Project info" | 6 |
| Slicing setup → Print setup | 6 |
| project page collapsed sections | 7 |
| estimated cost of one print / material usage components | 8 |
| image gallery: images, cover, edit page | 9 |
| image gallery: modal, zoom, pan | 10 |
| alerts refactor: alert manager, severities | 12 |
| alerts refactor: per-task alert settings | 13 |
| alerts refactor: alert view, call to action, notifications | 14 |
| accessories installs import | 16 |
| projects import | 17 |
| auto slicing | 18 |
