# 3D Maker Suite - Development Plan v2 (target: 2.0.0)
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.
- Each feature step adds its own e2e spec. The last phase only runs a responsive pass over the whole suite.
- Steps that change `packages/db/src/schema.ts`: back up the DB **before** editing it (`pnpm dev` applies new migrations to the real DB).
- Releases: a `v2.0.0-alpha.N` pre-release closes phases 3, 4 and 5; `v2.0.0` closes the plan.

Status legend: `[ ]` todo · `[x]` done

---

## Phase 1 - Bugs & quick fixes

### [x] Step 1 - Tables keep their scroll position
**Model:** Sonnet · **Effort:** Low
**Scope:** Sorting or searching a table scrolls the page back to the top. The page must stay where it is. Find the root cause (likely the router resetting scroll when the list's search params change) and fix it once in the shared list/table code, so every table gets it.
**Done when:** sorting, filtering and searching any table keep the scroll position; going to another page still starts at the top; e2e covers one long table; tests pass.
**Prompt:**
```
Do Step 1 of PLAN.md. Reproduce first and explain the root cause. Fix it where every
table routes through, not page by page.
```

### [x] Step 2 - Sidebar: Accounting section, Projects before Prints
**Model:** Haiku · **Effort:** Low
**Scope:** New sidebar group "Accounting" (i18n) after Work. Costs moves into it; Clients and Orders join it in their own steps. In Work, Projects comes before Prints. The mobile bottom bar and "More" follow the same order.
**Done when:** the sidebar reads Overview · Equipment · Work (Projects, Prints) · Accounting (Costs) · Insights; i18n:check passes; e2e green.
**Prompt:**
```
Do Step 2 of PLAN.md.
```

### [x] Step 3 - Project column on the Prints page
**Model:** Haiku · **Effort:** Low
**Scope:** The Prints table gets a "Project" column, first on the left, sortable and filterable like the other columns, linking to the project. Empty when the print has no project.
**Done when:** the column shows, sorts, filters and links; e2e; tests pass.
**Prompt:**
```
Do Step 3 of PLAN.md. Reuse the project label helper the other pages use.
```

### [x] Step 4 - Sort and filter on every table
**Model:** Sonnet · **Effort:** Medium
**Scope:** The review tables (print review queue, import review `ReviewTable` / `SourceReviewPage`) get the same sort and filters as the other tables. Audit every table in `apps/web/src` for sort, filter and search, and fix every gap through the shared `DataTable` / `FilterBar`, not with per-table code.
**Done when:** the audit list (table → what it had → what was added) is in the summary; every table sorts and filters; e2e for the review tables; tests pass.
**Prompt:**
```
Do Step 4 of PLAN.md. List every table and what it supports first, then fix the gaps
through DataTable.
```

### [x] Step 5 - README screenshots
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:**
- `pnpm screenshots`: a Playwright script that starts on a fresh temp data dir with demo data (same pattern as the e2e suite) and writes `docs/images/*.png`, light theme, 1280px wide: dashboard, printers, project detail, prints, filament, stats, costs.
- README shows the missing images (today it links to two files that don't exist).
- CLAUDE.md "Finish a step" gets a rule: when a step visibly changes a page that has a screenshot, re-run `pnpm screenshots` and commit the images.

**Done when:** `pnpm screenshots` writes every image; README shows them; CLAUDE.md has the rule; the script is not part of `pnpm test:e2e` or CI.
**Prompt:**
```
Do Step 5 of PLAN.md. Reuse the e2e fixtures for the demo data. No new dependency.
```

---

## Phase 2 - Stats

### [x] Step 6 - Estimated durations count everywhere
**Model:** Sonnet · **Effort:** Medium
**Scope:** Prints with an estimated duration must count in stats, printer usage hours, maintenance runtime and costs. The server sums already seem to use `duration_sec` whatever `durationEstimated` is, so first find where estimated prints are really missing: e.g. prints with grams but no duration from before estimation existed, or prints added by hand (only the import estimates today). Fix the gap: estimate on manual create/edit too, and backfill existing prints, keeping `durationEstimated` true so a real duration still replaces it.
**Done when:** the summary lists what was already counted and what wasn't; a print with grams and no duration gets an estimate however it's created; the backfill's before/after count is shown and approved; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md. Verify first and tell me where estimated prints are missing before
changing anything. Back up the DB before running the backfill.
```

### [x] Step 7 - Stats page review  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** The stats page data looks wrong. Review every number and table on it against the DB. Known issues: print time; filament print time (the filament breakdown hard-codes `seconds` to 0); filament names without their color; the projects table is too long. Also check the other breakdowns, totals vs series, filters, CSV and cost lines. Propose fixes and layout changes (e.g. top N with "show all") and wait for approval.
**Done when:** each number is checked against a SQL query on a copy of the real DB and the result is in the summary; the approved changes are done; filament labels include the color; the projects table is bounded; tests in `stats.test.ts`; e2e; tests pass.
**Prompt:**
```
Do Step 7 of PLAN.md. Work on a copy of my DB. List every number on the page, how it is
computed and what is wrong, with proposed changes, before changing anything.
```

---

## Phase 3 - Accessories

### [x] Step 8 - Accessories: data and pages  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- An accessory (AMS, AMS lite, hotend, enclosure, …) has printer-like info: number (like printers and spools), name, type, serial, purchase date and price, warranty end and notes, state, notes, archived. Propose free-text type vs a small catalog.
- Install history: an accessory is on one printer at a time, with an install date and an optional removal date. Adding it to a printer asks for the install date, removing it asks for the removal date. Overlapping periods are refused.
- Printers page: accessories table below the printers table. Printer page: accessories section to add and remove. Accessory page: details and install history, where a record can be deleted.

**Done when:** the schema is approved; an accessory can be created, installed, removed and installed again; history records can be deleted; overlaps are refused; e2e; tests pass.
**Prompt:**
```
Do Step 8 of PLAN.md. Show me the tables, constraints and pages first. Reuse the printer
form and detail patterns. Back up the DB before editing schema.ts.
```

### [x] Step 9 - Accessory usage and maintenance  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Accessory usage = the prints (time and count) of the printer it was on, inside each install period. Shown on the accessory page and in the accessories table.
- Maintenance types and tasks can target an accessory as well as a printer. Due status uses the accessory's usage (time, prints, days); the Maintenance page and alerts include accessories.

**Done when:** usage follows install periods (tests for prints on the edges of a period); logging a task on an accessory resets its due status; accessory maintenance raises alerts; e2e; tests pass.
**Prompt:**
```
Do Step 9 of PLAN.md. Show me how maintenance types and tasks get an accessory target
(schema + maintenanceDue) before implementing. Back up the DB before editing schema.ts.
```

### [x] Step 10 - Lifetime and maintenance cost per printer and accessory  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Printer and accessory settings get: lifetime hours and "include maintenance cost". Accessories also get "count in costs". Empty means "use the default".
- Costs settings hold the defaults: today's global `printerLifetimeHours` / `includeMaintenanceCost`, plus the accessory defaults.
- Print and project costs, stats and the quote calculator use them: wear and maintenance of the printer, plus of each counted accessory installed on it when the print started.

**Done when:** per-device values override the defaults; an accessory adds cost only to prints inside its install periods; `printCosts`, the stats SQL and the calculator agree (one test compares them); tests pass.
**Prompt:**
```
Do Step 10 of PLAN.md. Show me how printerRates and the stats rate CTE handle rates that
depend on the print date before implementing. Back up the DB before editing schema.ts.
```

### [x] Step 11 - Docs, push & v2.0.0-alpha.1
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs updates for Steps 1-10 (accessories, stats, cost settings), CHANGELOG, version `2.0.0-alpha.1`. Commit, push `main`, create and push tag `v2.0.0-alpha.1`. The release workflow publishes it as a pre-release; check that the run succeeds (`gh run watch`) and the release exists (`gh release view v2.0.0-alpha.1`).
**Done when:** `main` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 11 of PLAN.md. Only document what changed since 1.3.0. Then push main, push the
tag and confirm the pre-release is published.
```

---

## Phase 4 - Slicing

### [x] Step 12 - Slicing spike + ADR  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Bambu Studio doesn't keep slice results in a saved project, so time and grams per plate must come from slicing. Find out if and how the slicers on the server's PC (Bambu Studio, OrcaSlicer) can slice a 3MF headless: CLI flags to pick plates, machine/process/filament presets (the ones the slicer adapters already read), where to read time and grams from (the 3MF parser already reads `slice_info`), run time, failure modes. Design: a `slice` capability in `packages/core/src/integrations` implemented by the slicer adapters (core stays brand-agnostic), one slice at a time as a job, results cached by file hash + settings.
**Done when:** `docs/adr/0007-slicing.md` records the decision and the rejected options; a throwaway script slices one plate of a fixture on this PC and prints time and grams. If headless slicing isn't feasible, stop and ask (fallback: time and grams typed per plate).
**Prompt:**
```
Do Step 12 of PLAN.md. Use Context7 / the slicers' docs and try the CLI on this PC.
No app code yet: only the ADR and a proof script.
```

### [x] Step 13 - Project slicing setup  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** On the project page the user picks the printable 3MF files, then per file the plates to count, and per plate the filament(s) (filament profiles) and the print profile. The print profile defaults to the default printer's (`defaultPrinterId`) and can be changed per plate. Saved per project. One shared component, reused by the quote calculator in Step 18.
**Done when:** the setup saves and reloads; defaults come from the default printer; a file changed on disk marks its plates as outdated; e2e; tests pass.
**Prompt:**
```
Do Step 13 of PLAN.md. Show me the tables and the component API first. Back up the DB
before editing schema.ts.
```

### [x] Step 14 - Slice, store results, project cost estimate
**Model:** Opus · **Effort:** Medium
**Scope:**
- "Slice" on the project runs the Step 12 capability for each selected plate: a background job with progress and errors per plate that never blocks the server. Time and grams per plate are stored with the setup.
- The project page shows the estimated cost of one complete print of the project (`computeCost` with the plate results), next to the existing printed-copies cost, which stays.
- Projects page: a "slicing needed" column and filter (never sliced, or outdated).

**Done when:** slicing a fixture project stores results and shows the estimate; re-slicing only runs outdated plates; the filter works; e2e with the mock adapter; tests pass.
**Prompt:**
```
Do Step 14 of PLAN.md. Add a fake slicer to the mock adapter so tests and e2e don't need
a real slicer.
```

### [x] Step 15 - Docs, push & v2.0.0-alpha.2
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for slicing (requirements: which slicer must be installed, where to set its path), CHANGELOG, version `2.0.0-alpha.2`. Commit, push `main`, create and push tag `v2.0.0-alpha.2`; check the workflow run and the pre-release.
**Done when:** `main` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 15 of PLAN.md. Only document what changed since 2.0.0-alpha.1. Then push main,
push the tag and confirm the pre-release is published.
```

---

## Phase 5 - Accounting

### [x] Step 16 - Clients
**Model:** Sonnet · **Effort:** Medium
**Scope:** Clients module under Accounting: list, client page and form. Name and mobile are mandatory; VAT, email, address and notes are optional. VAT, mobile and email are unique when filled (email case-insensitive). The client page's quotes and orders tables come with Steps 17 and 19.
**Done when:** clients can be created and edited; a duplicate shows an error on its field (i18n); e2e; tests pass.
**Prompt:**
```
Do Step 16 of PLAN.md. Uniqueness as partial unique indexes in the DB, mapped to field
errors by the API. Back up the DB before editing schema.ts.
```

### [x] Step 17 - Saved quotes: numbering, client, notes, tables  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Quotes get a number like printers, prints, projects and spools, and show everywhere with the app's naming convention (number + the name the user chose).
- A quote has notes/description, an optional client (search, or create one from the costs page) and an optional project.
- Costs page: all quotes in a full-width table below the calculator (sort, filter, open/edit, delete), like the other tables.
- Project page and client page: a quotes table each.

**Done when:** the migration numbers existing quotes by `createdAt`; the three tables work; e2e; tests pass.
**Prompt:**
```
Do Step 17 of PLAN.md. Show me the migration and where the tables go first. Back up the DB
before editing schema.ts.
```

### [x] Step 18 - Quote calculator rework  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Picking a project fills every field from it, all editable: its printable files and plates from Step 13 are preselected; the user can add or remove 3MF files (only `.3mf`) and plates, override the print profile, and pick materials from the filament profiles list (defaults from the project, editable in place). Same slicing component and service as projects.
- Without a project, everything is manual and optional (printer, files, material, …): the calculator works without projects, printers or profiles.
- "Pieces" becomes "Prints" and moves to the print section; labor hours are per print.

**Done when:** project → filled quote → edit → save → reopen gives the same numbers; a manual quote with nothing selected works; quotes saved before this step still open; core cost tests updated; e2e; tests pass.
**Prompt:**
```
Do Step 18 of PLAN.md. Show me the new form state and how it maps to computeCost and the
quote before rewriting CostsPage.
```

### [ ] Step 19 - Orders  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** Orders module under Accounting. An order has a number, a client, a project (mandatory), a quote (optional), a price, a status (accepted, in progress, done, canceled) and notes. A print can belong to one order (optional; set from the print form and from the order page). The order page shows its prints and their cost (`printCosts`) next to the price. Project page and client page get an orders table.
**Done when:** the schema is approved; orders can be created, edited and moved through the statuses; linked prints show their cost; project and client pages list their orders; e2e; tests pass.
**Prompt:**
```
Do Step 19 of PLAN.md. Show me the tables and the order page first. Back up the DB before
editing schema.ts.
```

### [ ] Step 20 - Import quotes and orders (file)
**Model:** Sonnet · **Effort:** Medium
**Scope:** Quotes and orders become types of the existing file import (template, parsing, review, apply), like prints. Client, project and quote are referenced the way prints reference printers (number or name); an unknown reference is an invalid row. If export is paired with import types, add the export too.
**Done when:** a template round-trips; bad references show in the review; tests in `importExport.test.ts`; e2e; tests pass.
**Prompt:**
```
Do Step 20 of PLAN.md. Follow how the prints import type is built, end to end.
```

### [ ] Step 21 - Docs, push & v2.0.0-alpha.3
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for clients, quotes, orders and their import, CHANGELOG, version `2.0.0-alpha.3`. Commit, push `main`, create and push tag `v2.0.0-alpha.3`; check the workflow run and the pre-release.
**Done when:** `main` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 21 of PLAN.md. Only document what changed since 2.0.0-alpha.2. Then push main,
push the tag and confirm the pre-release is published.
```

---

## Phase 6 - Project files & release

### [ ] Step 22 - Project files API  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** The app may run on a server whose disk the user can't open in Explorer, so every file action must work from the browser.
- New project: create its folder inside a configured project root (the user picks the root when there is more than one). The roots stay watched as today.
- Inside a project folder: list, create, rename, move and delete folders and files; upload files; replace a file by uploading over it (explicit flag, never silent).
- Every path is resolved and checked to stay inside the project's folder (or the chosen root for a new project): no `..`, no symlink/junction escape, no absolute paths from the client.
- Uploads stream to disk with a size limit; no new dependency unless the reason holds (e.g. one file per request as a raw body). Propose delete vs move to an app trash folder.
- The scanner picks up every change, and the Windows folder-lock fix from v1.3 still holds.

**Done when:** route tests refuse path traversal, symlink escape, writes outside the project and renames onto an existing name; a new project's folder is created and scanned into a project; tests pass.
**Prompt:**
```
Do Step 22 of PLAN.md. Show me the routes, the path guard and the upload approach before
implementing. Reuse routes/fs.ts and the scanner where they fit.
```

### [ ] Step 23 - Project files UI
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Project page: a Files section with the project folder as a tree. Create, rename, move and delete folders and files; upload by picker and drag & drop with progress; replace a file. Delete asks for confirmation. Projects page: "New project" asks for the root (when more than one), creates the folder and opens the project to upload into. Keyboard accessible, mobile friendly, i18n.
**Done when:** every action works from the UI at 375/768/1440; e2e on a temp root; tests pass.
**Prompt:**
```
Do Step 23 of PLAN.md. Screenshot at the 3 viewports when done. Reuse PathPicker,
ConfirmDialog and DataTable where they fit.
```

### [ ] Step 24 - Project description editor and preview file
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- The user marks which file is the default for the 3D preview (today the scanner picks `filePath`); a re-scan keeps the choice (`editedFields`).
- The user picks the `.md` file used as description (check what the form's description file field already does and fill the gap).
- The description editor is a markdown editor (textarea + preview with the existing `Markdown` component, no new dependency). Saving creates or updates the description file in the project folder through the Step 22 path guard.

**Done when:** the preview file choice survives a re-scan; editing the description writes the `.md` file and a re-scan shows the same text; e2e; tests pass.
**Prompt:**
```
Do Step 24 of PLAN.md. Tell me what the description file field already does before
changing anything.
```

### [ ] Step 25 - Responsive pass & screenshots for v2
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Run the whole e2e suite at 375/768/1440 and fix what breaks. Fill e2e gaps left by earlier steps. Refresh the README screenshots with `pnpm screenshots`.
**Done when:** E2E green in CI; screenshots match the app.
**Prompt:**
```
Do Step 25 of PLAN.md. List the UI issues found and fix them in this step.
```

### [ ] Step 26 - Docs, push & v2.0.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs (project files, description editor, anything missed), CHANGELOG, version `2.0.0`. Commit, push `main`, create and push tag `v2.0.0`. The release workflow publishes it as the latest release; check the run (`gh run watch`) and the release (`gh release view v2.0.0`).
**Done when:** `main` and the tag are pushed; the workflow is green; the release is the latest; docs match the app.
**Prompt:**
```
Do Step 26 of PLAN.md. Only document what changed since 2.0.0-alpha.3. Then push main,
push the v2.0.0 tag and confirm the release is published.
```

---

## Backlog mapping
| Backlog item | Step |
|---|---|
| table search and order (scroll jumps up) | 1 |
| create new sidebar section "accounting" | 2 |
| sidebar order (projects before prints) | 2 |
| prints page: project column first | 3 |
| review page: filters and order, all tables | 4 |
| prints (screenshots) in readme.md | 5 |
| estimation duration counts in stats and usage | 6 |
| review stats page data | 7 |
| accessories module: info, tables, printer section, install history | 8 |
| accessories module: usage, maintenance | 9 |
| accessories module: lifetime, maintenance, cost settings and defaults | 10 |
| file slicing | 12, 13, 14 |
| clients module | 16 |
| costs module: numbering, notes, client, quotes tables | 17 |
| costs module: project autofill, files/plates, profiles, manual mode, prints, labor per print | 18 |
| orders module | 19 |
| import module for quotes and orders | 20 |
| project upload and folder management: new project folder, folders, files, upload | 22, 23 |
| project upload and folder management: default 3D preview file, md description, markdown editor | 24 |
