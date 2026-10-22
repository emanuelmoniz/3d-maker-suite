# 3D Maker Suite - Development Plan v4 (target: 4.0.0)
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.
- Each feature step adds its own e2e spec. The last phase only runs a responsive pass over the whole suite.
- Steps that change `packages/db/src/schema.ts`: back up the DB **before** editing it (`pnpm dev` applies new migrations to the real DB).
- Branches: from Step 1 on, steps commit to `dev`. Pre-releases `v4.0.0-alpha.N` are tagged on `dev` and close phases 2, 3 and 4; `v4.0.0` merges `dev` into `main` and closes the plan.
- Skills: `webapp-testing` for steps that need screenshots or browser checks, `frontend-design` for new visual pieces (gallery, log page, update dialog), `dataviz` for the bar chart widget.

Status legend: `[ ]` todo · `[x]` done

---

## Phase 1 - Release channels & quick fixes

### [x] Step 1 - Dev branch and release channels
**Model:** Haiku · **Effort:** Low
**Scope:**
- Create `dev` from `main` and push it. CI runs on pushes and PRs to `main` and `dev`.
- Release workflow: a stable tag (`vX.Y.Z`) must be on `main`, a pre-release tag (`vX.Y.Z-*`) on `dev`; otherwise the run fails with a clear message.
- CLAUDE.md workflow: steps commit to `dev`; a stable release = fast-forward `main` to `dev` + tag. Update the "ask to push" memory to say `dev`.

**Done when:** `dev` exists on GitHub; CI runs on it; the workflow check is in place (dry-read in the summary); CLAUDE.md updated.
**Prompt:**
```
Do Step 1 of PLAN.md.
```

### [x] Step 2 - Bambu Cloud spools sync: off by default, double tracking warning
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Spool usage tracking from Bambu Cloud is unreliable. First find out why: search online for official Bambu Lab threads / wiki / known issues (AMS remaining %, RFID vs third-party spools, cloud data lag) and check our own sync code. Document the findings with links in `docs/bambu-cloud.md`.
- Spools sync is off by default when the integration is added (existing integrations keep their setting).
- Spools sync may track usage. If both prints sync and spools sync track usage, show a non-blocking warning in the integration settings: tracking usage from both at the same time is not recommended (usage counts twice / conflicts).

**Done when:** the summary says whether the problem is ours or the API's (fixed if ours); docs list the threads; a new integration has spools sync off; the warning shows only when both track usage; tests pass.
**Prompt:**
```
Do Step 2 of PLAN.md. Research and explain the usage problem before changing code.
```

### [x] Step 3 - Bar chart widget: dates and values
**Model:** Sonnet (use dataviz skill) · **Effort:** Medium
**Scope:** The bar chart widget on Home and Stats shows more about each bar: its date (period) and value, readable at a glance and on touch. Propose 2-3 options first (e.g. value labels on bars, clearer date ticks, tooltip with date + formatted value, average line), then build the chosen one once in the shared widget. Locale-aware dates/numbers, i18n, light/dark, Recharts only.
**Done when:** the options are approved; both pages use the same widget; it reads well at 375 and 1440 (screenshots); tests pass.
**Prompt:**
```
Do Step 3 of PLAN.md. Show me the options with a short mock or screenshot each first.
```

### [x] Step 4 - Project edit page: one save, collapsible cards, deep link
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- One "Save" button on the edit page. The "Save setup" button goes. "Slice" saves the print setup only, then slices.
- Save button also save print setup even if cahnges maded and not sliced.
- Every settings section of the edit page is a collapsible card (reuse the v3 collapsible component used on the project page), closed by default.
- "Print setup" in the "Production cost of one print" card on the project page opens the edit page at the Print setup section, already open.

**Done when:** no "Save setup" left; Slice saves then slices; sections start closed; the deep link opens Print setup; e2e; tests pass.
**Prompt:**
```
Do Step 4 of PLAN.md.
```

---

## Phase 2 - Projects

### [x] Step 5 - Folder settings per root: project depth and files depth  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Today `projectScanDepth` is global: a project sits at most N levels below a root (1 = `root/project`, 2 = `root/category/project`), and a folder holding a model file is a project even above that depth. Confirm this in the summary.
- Each root gets its own settings, set when adding the root and editable later in Settings → Projects: **project depth** (default 1), **files depth** (levels below the project folder searched and watched; "All" = no limit, the default; replaces `MAX_DEPTH` in `scanFolder.ts`) and **auto slice** (folds in `autoSliceOffRoots`).
- Existing settings migrate: each root keeps today's depth and auto slice; files depth becomes "All". `projectScanMaxFiles` stays as the safety cap.
- The watcher ignores changes deeper than a root's files depth.

**Done when:** the settings shape and migration are approved; two roots with different depths discover the right folders; files depth limits listed and watched files; old settings migrate; tests pass.
**Prompt:**
```
Do Step 5 of PLAN.md. Show me the new roots setting shape, the migration from projectRoots /
projectScanDepth / autoSliceOffRoots and the watcher change first.
```

### [x] Step 6 - Project gallery redesign
**Model:** Sonnet (use frontend-design and webapp-testing skills) · **Effort:** Medium
**Scope:**
- The gallery is no longer a collapsible section: it sits above the "Production cost of one print" card, in the right column.
- A big square viewer (image fills the area, cropped to the smaller side) with previous/next buttons and touch swipe. Clicking it still opens the full-screen modal.
- Square thumbnails below, scrolling horizontally (buttons and touch); picking one shows it in the viewer.
- Mobile: the right column (gallery and cost cards) shows before the 3D preview.
- Cleaner, more interactive overall; keyboard accessible, i18n, no new dependency.

**Done when:** it works with mouse, keyboard and touch at 375/768/1440 (screenshots); e2e; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md. Screenshot at the 3 viewports when done.
```

### [x] Step 7 - Docs, push & v4.0.0-alpha.1
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for Steps 1-6, CHANGELOG, version `4.0.0-alpha.1`. Refresh `pnpm screenshots` (project page changed). Commit, push `dev`, create and push tag `v4.0.0-alpha.1` on `dev`. Check the run (`gh run watch`) and the pre-release (`gh release view v4.0.0-alpha.1`).
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 7 of PLAN.md. Only document what changed since 3.0.0. Then push dev, push the tag
and confirm the pre-release is published.
```

---

## Phase 3 - Import/export & logs

### [x] Step 8 - Import | Export page
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- "Import" becomes "Import | Export" (menu and page title, i18n values).
- The Export section moves from Settings → Backup to this page. Backup and restore stay in Settings.
- A template download for every type that can be imported.
- Instructions on the page: data in another app or file → download the matching template, copy your data into it, import it; earlier export files can be imported here as they are.

**Done when:** export works from the new page and is gone from Settings; every importable type has a template; i18n:check passes; e2e; tests pass.
**Prompt:**
```
Do Step 8 of PLAN.md.
```

### [x] Step 8b - One file format for template and export, editable review  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Template = export: same columns and labels, the export adds an `id` column. Formats XLSX, CSV and JSON, picked with a format select after "What to export" (and for the template). JSON uses column keys (`[]` for a template); CSV uses the translated labels. Import accepts all three, headers by key or label (`headerKeys`).
- The raw dump goes: `routes/export.ts` (`/api/export/:table`) and the "All data, as CSV or JSON" list. Backups still hold everything.
- Server: `/:entity/template` and `/:entity/export` take `?format=xlsx|csv|json`. CSV cells formatted like the xlsx export (money in major units, refs by name, ISO dates, formula-escape, BOM).
- Review = the file: columns of `IMPORT_COLUMNS[entity]` in file order with the template labels (+ Id when the file has it).
- Every value cell is editable, with an input per column type: text, number (decimal comma ok), date/datetime, enum select, ref combobox (or a new name, as in a file), colour. Id/Number are read-only on rows that update. Edited cells get a marker and a reset. Live validation with core `parseCell`.
- Apply: a decision takes `values` (raw cells). `review.ts` `plan()` overlays them on the stored row and runs `parseRow → check → canon` again. Any error rejects the apply (as today). `id`/`number` on an update → `identity_locked`. No re-match: the row keeps its target. An invalid row fixed by edits can be created or updated.
- The user still chooses every row (Create / Update / Skip, bulk actions).

**Done when:** export → re-import is all Identical in each format for the 9 current types; a template has the export's headers minus `id`; edits save, bad edits and identity edits are rejected (tests in `import.test.ts` / `importExport.test.ts`); e2e: export CSV → upload → edit a cell → import; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 8b of PLAN.md. Show me the review table cell editing (one mock per column type)
and the apply `values` contract first.
```

### [x] Step 9 - Import catalogs: brands, models, profiles, filament catalog
**Model:** Opus · **Effort:** Medium
**Scope:** Brands, printer models, machine profiles, print profiles, filament brands, filament materials and filament profiles become file import types in the Step 8b format (template/export in XLSX/CSV/JSON, editable review). The handlers in `apps/server/src/import/catalog.ts` and `filamentProfiles.ts` already exist (slicer zip and integrations). Add them to `IMPORT_ENTITIES`, give them real `update`s (brands and filament brands are no-ops today), `refs` for template dropdowns and `targets` for export. References by number or name, same rules as the API.

| Type | Columns | Identity |
|---|---|---|
| Brands | Name* | name |
| Printer models | Brand*, Model* | brand + model |
| Machine profiles | Brand*, Model*, Name*, Nozzle (mm) | brand + model + name |
| Print profiles | + Layer height (mm) | brand + model + name |
| Filament brands | Name*, Website | name |
| Filament materials | Name*, Nozzle (°C), Bed (°C), Density (g/cm³) | name |
| Filament profiles | as today | brand + material + name |

Filament materials split out of `filamentBrands` (no more `kind` column). The slicer zip / integration source (`integrations/sourceRows.ts`) offers materials as `filamentMaterials`, and the zip page lists it. The slicer zip import otherwise stays as it is.

**Done when:** each type round-trips with its export in every format (export → re-import Identical → edit → Update); a bad reference shows as invalid in the review; `slicerCatalog.test.ts` still passes; tests in `importExport.test.ts`; e2e on brands; tests pass.
**Prompt:**
```
Do Step 9 of PLAN.md. Follow how the spools import type is built, end to end, in the
Step 8b format.
```

### [ ] Step 10 - Import maintenance and order projects
**Model:** Sonnet · **Effort:** Medium
**Scope:** Maintenance types, maintenance (tasks / history) and order projects become file import types, same pattern as Step 9. Printer, accessory, type, order and project are referenced by number or name; an unknown reference is an invalid row. New handlers in `apps/server/src/import/maintenance.ts` and `orderProjects.ts`.

| Type | Columns | Identity |
|---|---|---|
| Maintenance types | Name*, Target* (printer/accessory), Description, Link, Every (days / hours / prints), Warn before (days / hours / prints), Warn alert (yes/no), Due alert (yes/no), Models, Printers, Accessory types, Accessories (`;` lists) | name |
| Maintenance | Type*, Printer, Accessory (exactly one, the type's target), Done* (date and time), Runtime at (h), Prints at, Cost, Notes | type + printer/accessory + done |
| Order projects | Order* (number), Project* (number or name) | order + project |

Hours are converted to and from the `*Sec` columns. Runtime/prints at, left empty, take the target's usage at that time, as the API does.

**Done when:** each template round-trips with its export in every format; a wrong target or unknown reference is invalid; tests in `importExport.test.ts`; e2e on maintenance; all 19 export types can now be imported; docs/import.md lists the 19 types; tests pass.
**Prompt:**
```
Do Step 10 of PLAN.md. Follow the Step 9 import types.
```

### [ ] Step 11 - Log module  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Logs are stored in a SQLite `logs` table (Drizzle migration) with time, type (`debug` · `info` · `success` · `warn` · `error`, more if useful), module, message and an optional detail. Never secrets.
- Settings → Logs: "Log active" (off by default; on at `info` level when running `pnpm dev`), levels to keep, modules to log, retention (days and max entries, pruned by a croner job).
- A "Logs" menu item before Settings, only while logging is active. When inactive nothing is logged.
- The log page: a table with filters and sorting (reuse `DataTable` / `FilterBar`).
- Hook into the existing pino logger rather than adding log calls everywhere, where possible.

**Done when:** the schema and how pino feeds the table are approved; entries appear by module and level; inactive = no rows and no menu; retention prunes; tests; e2e; tests pass.
**Prompt:**
```
Do Step 11 of PLAN.md. Show me the schema, how logs reach the table and the retention job
first. Back up the DB before editing schema.ts.
```

### [ ] Step 12 - Docs, push & v4.0.0-alpha.2
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for the Import | Export page, the new import types and the log module, CHANGELOG, version `4.0.0-alpha.2`. Commit, push `dev`, create and push tag `v4.0.0-alpha.2` on `dev`; check the workflow run and the pre-release.
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 12 of PLAN.md. Only document what changed since 4.0.0-alpha.1. Then push dev,
push the tag and confirm the pre-release is published.
```

---

## Phase 4 - Install & updates

### [ ] Step 13 - Install on Windows, macOS, Linux and Docker
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Review every install instruction (README, `docs/install.md`, `docs/configuration.md`) and make it easy for Windows, macOS and Linux (macOS is supported: check its paths and steps).
- Docker: a `Dockerfile` (Node 22, builds better-sqlite3), a `docker-compose.yml` example (data volume, project folder mounts, `HOST=0.0.0.0`, `APP_PASSWORD`). The release workflow publishes `ghcr.io/emanuelmoniz/3d-maker-suite` with `:X.Y.Z` + `:latest` for stable and `:X.Y.Z-alpha.N` + `:dev` for pre-releases.
- Document what doesn't work on a NAS / in Docker and why (slicing, open in slicer, local slicer presets, folder watching on network shares, …). Add one entry to `BACKLOG.md` → Ideas / modules listing each incompatible feature and the suggested fix (append only).
- CLAUDE.md: drop "no Docker for now".

**Done when:** a clean `docker compose up` runs the app with persisted data; the image publishes on a test pre-release; docs list each OS and Docker; the incompatibility table and backlog entry exist; tests pass.
**Prompt:**
```
Do Step 13 of PLAN.md. You may append to BACKLOG.md Ideas / modules for this step only.
```

### [ ] Step 14 - Versioning and one-click updates  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- The app shows its version (Settings → About and the sidebar footer), read from the root `package.json`.
- Settings: update channel **stable** (latest release from `main`) or **dev** (pre-releases from `dev`).
- A daily check (croner) and a "Check now" button read GitHub releases; a newer version raises an alert (Step 12 v3 manager) and shows a banner. The user decides to update.
- Update (git installs): back up the DB (existing backup service), fetch and check out the release tag, `pnpm install --frozen-lockfile`, rebuild, restart. Progress and errors are shown; a failure leaves the old version running.
- Rollback: the previous versions with their pre-update backups; picking one checks out that tag and restores its backup (migrations only go forward).
- Docker or non-git installs: notice with the exact command only.
- Write `docs/adr/0009-updates.md`: the model, how restart works without a supervisor, rejected options, and suggested changes to this plan before shipping to friends.

**Done when:** the ADR is approved; a test update from a local tag to a newer one and a rollback both work; the DB backup exists before every update; Docker shows the notice; tests; tests pass.
**Prompt:**
```
Do Step 14 of PLAN.md. Show me the ADR draft first: update flow, restart, rollback, and
what you'd change in this plan for friends installing it.
```

### [ ] Step 15 - Docs, push & v4.0.0-alpha.3
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for install (all OS and Docker), versioning and updates, CHANGELOG, version `4.0.0-alpha.3`. Commit, push `dev`, create and push tag `v4.0.0-alpha.3` on `dev`; check the workflow run, the pre-release and the `:dev` image.
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release and image exist; docs match the app.
**Prompt:**
```
Do Step 15 of PLAN.md. Only document what changed since 4.0.0-alpha.2. Then push dev,
push the tag and confirm the pre-release and image are published.
```

---

## Phase 5 - Release

### [ ] Step 16 - Responsive pass & screenshots of every module
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Run the whole e2e suite at 375/768/1440 and fix what breaks. `pnpm screenshots` covers every module, Settings, Integrations and every detail page (module settings pages left out). Seed one project fully (plates, print setup, prints, gallery images, costs) so the project detail screenshot has data. Add the new screenshots to the README.
**Done when:** E2E green in CI; screenshots exist for every module and detail page and match the app.
**Prompt:**
```
Do Step 16 of PLAN.md. List the UI issues found and fix them in this step.
```

### [ ] Step 17 - Docs, push & v4.0.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs (anything missed), CHANGELOG, version `4.0.0`. Commit on `dev`, fast-forward `main` to `dev`, push both, create and push tag `v4.0.0` on `main`. Check the run (`gh run watch`), the release (`gh release view v4.0.0`) and the `:latest` image.
**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest; the image is published; docs match the app.
**Prompt:**
```
Do Step 17 of PLAN.md. Only document what changed since 4.0.0-alpha.3. Then merge dev into
main, push, push the v4.0.0 tag and confirm the release and image are published.
```

---

## Backlog mapping
| Backlog item | Step |
|---|---|
| versioning: dev branch, stable → main, pre-releases → dev | 1 |
| spools Bambu Cloud: off by default, double tracking warning, docs | 2 |
| bar chart widget: dates and values | 3 |
| project edit page: one save, collapsible cards, Print setup link | 4 |
| folder depth and files depth per root | 5 |
| image gallery redesign | 6 |
| import/export: rename, export section, templates, instructions | 8 |
| import/export: every module importable | 9, 10 |
| log module | 11 |
| install: macOS, all OS, Docker, NAS incompatibilities | 13 |
| versioning: version in app, channels, updates, backup, rollback | 14 |
| screenshots of every module and detail page | 16 |
