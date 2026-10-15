# 3D Maker Suite - Development Plan v1.3 (target: 1.3.0-alpha.1)
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.

Status legend: `[ ]` todo · `[x]` done

---

## Phase 1 - Bugs

### [x] Step 1 - Two-decimal filament grams
**Model:** Sonnet · **Effort:** Low
**Scope:** The print edit form rounds filament usage to whole grams, but the DB keeps decimals. Allow 2 decimals (`step="0.01"`, and zod/parse not rounding) on the print form and anywhere else grams or other decimal quantities are entered: spool form, adjust dialog, review table, import parsing. Show them with locale-aware number formatting.
**Done when:** 12.34 g saves and shows again as 12.34 on the print form and every other grams input; tests pass.
**Prompt:**
```
Do Step 1 of PLAN.md. Grep every number input and zod number schema for grams/weights
first and list them, then fix them all the same way.
```

### [x] Step 2 - Home page customize mode layout
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** In customize mode, the widget controls are too small and overlap the widget row above. Rework the controls: proper touch-target size (≥ 40px), no overlap at 375/768/1440, keyboard accessible, i18n labels.
**Done when:** screenshots at the 3 viewports show no overlap; the controls work with the keyboard; e2e still green.
**Prompt:**
```
Do Step 2 of PLAN.md. Screenshot the current customize mode at 375/768/1440 first,
then fix and screenshot again.
```

### [x] Step 3 - Project folders locked while the server runs  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** With the server running, a folder added under a project root can't be renamed in Windows Explorer. Likely cause: chokidar's `fs.watch` keeps a handle open on every watched folder (`projects/scanner.ts` `watch()`). Confirm the cause, then pick the fix (e.g. polling with a sensible interval on Windows, watching only the roots, or a lower depth) and weigh CPU cost against how fast changes are seen.
**Done when:** a watched folder can be renamed while the server runs, and the rename still triggers a rescan; the trade-off is noted in a `ponytail:` comment; tests pass.
**Prompt:**
```
Do Step 3 of PLAN.md. Reproduce first (script or manual steps), explain the root cause,
and show the options with their trade-offs before changing anything. No new dependency.
```

### [x] Step 4 - Print import numbering oldest-first + renumber  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Import (file and cloud): prints without a number in the file are numbered in date order, oldest first. When a month is imported, its latest print gets the highest number. Today it's the reverse.
- Spool matching runs in the same order (oldest to newest), so remaining grams and `usableOn` follow time.
- Data migration: renumber existing prints by `startedAt`, **keeping numbers that came from a file**. Find how to tell those prints apart (import raw, editedFields, …). If that can't be known, stop and ask.

**Done when:** importing a month gives ascending numbers by date; matching consumes spools in date order; the migration's before/after is shown and approved; tests cover the ordering; tests pass.
**Prompt:**
```
Do Step 4 of PLAN.md. Find where import numbering and match order are decided, and how a
file-given number can be told apart. Show me the renumber migration and a before/after
count before applying it. Back up the DB before running pnpm dev.
```

---

## Phase 2 - Sync

### [x] Step 5 - "Sync from cloud" buttons
**Model:** Sonnet · **Effort:** Low
**Scope:** Rename the Printers page "Import from cloud" to "Sync from cloud" (i18n key and label). Add the same button to the Prints and Filament pages, each running that module's sync type through the existing sync endpoint. Hidden or disabled with a hint when no integration supports the type.
**Done when:** all three pages show "Sync from cloud" and run their sync; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 5 of PLAN.md. Reuse the Printers button and its endpoint; one shared component
if the three are the same.
```

### [x] Step 6 - Sync result alerts  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- New one-shot alert kinds: `sync_success` (sync finished with new content: counts in the context) and `sync_error` (sync failed: error code, never secrets). A sync that adds nothing raises no alert. These alerts are dismissible on the Alerts page and are sent to the alert channels (ntfy/email via `messageOf`).
- "Missing match" stays the existing `sync_pending` alert. Its ntfy/email message gets a working link to the per-type review page (`/import/integration/$id/$type`), built from the server's base URL.
- Respect the per-policy `alert` toggle. Migration rebuilds `alerts` for the new kinds (like `0014`).

**Done when:** a sync with new rows raises success; a failing sync raises error; an empty sync raises nothing; the pending notification links to the review; tests in `alerts.test.ts`; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md. Show me how one-shot alerts fit next to the condition-based
evaluate.ts before implementing. Back up the DB before running the migration.
```

### [x] Step 7 - Pick the project when importing prints (check)
**Model:** Sonnet · **Effort:** Low
**Scope:** Check that the review of a print import (file and cloud) lets the user pick or change the project of each row (`import/prints.ts` `projectMatcher`, ReviewTable). It looks done already; fill any gap (e.g. cloud review, bulk "set project for selected rows" if missing).
**Done when:** both file and cloud reviews let the user set a project per row; report what was already there; tests pass.
**Prompt:**
```
Do Step 7 of PLAN.md. Verify first and tell me what is already done before changing anything.
```

---

## Phase 3 - UI & UX

### [x] Step 8 - Date and time format setting
**Model:** Sonnet · **Effort:** Medium
**Scope:** General settings get a date format (default `YYYY/MM/DD`, plus a few common ones) and a time format (default 24h, or 12h). One web helper formats every date/time in the app (tables, forms display, charts, alerts) and is built on `Intl`, so it stays locale-aware. New preference fields; native date inputs stay native.
**Done when:** changing the setting changes every displayed date/time; defaults are YYYY/MM/DD and 24h; no other date formatting is left; tests pass.
**Prompt:**
```
Do Step 8 of PLAN.md. Grep every toLocale*/Intl.DateTimeFormat/date-format call first
and route them all through one helper.
```

### [x] Step 9 - Back button = browser back
**Model:** Sonnet · **Effort:** Low
**Scope:** Every page back link goes to the previous page (`history.back()` through the router). Fall back to the current fixed route when there is no in-app history (deep link, new tab). One shared back component.
**Done when:** back returns to the page you came from (e.g. a spool opened from a print goes back to the print); a deep link still has a working back; e2e still green.
**Prompt:**
```
Do Step 9 of PLAN.md. One shared BackLink with a fallback route; list every place you replace.
```

### [x] Step 10 - Filament page default filter
**Model:** Haiku · **Effort:** Low
**Scope:** The Filament page opens filtered to status `new` + `in_use`, sorted by spool number. The user can still clear the filter, and URL search params still override the default.
**Done when:** a fresh visit shows only new and in-use spools sorted by number; clearing the filter shows all; tests pass.
**Prompt:**
```
Do Step 10 of PLAN.md.
```

### [x] Step 11 - Project page layout
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** On the project detail page: move the description below the plates section. Put the prints table and the cost table next to the preview, above the 3 existing info blocks. Stack them on mobile.
**Done when:** the new layout works at 375/768/1440; e2e still green.
**Prompt:**
```
Do Step 11 of PLAN.md. Screenshot before and after at the 3 viewports. Move the
existing sections, don't rewrite them.
```

### [ ] Step 12 - Searchable selects everywhere  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** One shared single-select combobox with typing to filter: ARIA combobox pattern, full keyboard support, mobile friendly, i18n "no results", works inside forms and native dialogs. No new dependency (`SearchPicker` is the multi-select reference). Replace all native `<select>` (~49 in 21 files), including short enum lists.
**Done when:** no native `<select>` left in `apps/web/src`; every dropdown filters as you type; keyboard and screen-reader behaviour checked; e2e updated and green.
**Prompt:**
```
Do Step 12 of PLAN.md. Show me the component API and its keyboard/ARIA behaviour first,
then replace the selects file by file. No new dependency.
```

---

## Phase 4 - Release

### [ ] Step 13 - E2E & responsive pass for v1.3
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Playwright coverage for two-decimal grams, home customize mode, import numbering order, sync buttons, sync alerts, date/time format setting, back button, filament default filter, project page layout, and searchable selects. Viewports 375/768/1440. Fix what breaks.
**Done when:** E2E green in CI.
**Prompt:**
```
Do Step 13 of PLAN.md. Same fresh-temp-data-dir pattern as the existing suite.
List UI issues found and fix them in this step.
```

### [ ] Step 14 - Docs, push & v1.3.0-alpha.1 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs updates (sync buttons and alerts, print numbering rule, date/time setting, searchable selects, Windows folder note if any), CHANGELOG, version `1.3.0-alpha.1`. Commit, push `main`, create and push tag `v1.3.0-alpha.1`. The release workflow then publishes it as a GitHub pre-release; check that the workflow run succeeds (`gh run watch`) and the pre-release exists (`gh release view`).
**Done when:** `main` and the tag are pushed; the release workflow is green; the GitHub pre-release exists; docs match the app.
**Prompt:**
```
Do Step 14 of PLAN.md. Only document what changed since 1.2.0-alpha.1. Then push main,
push the v1.3.0-alpha.1 tag and confirm the pre-release is published.
```

---

## Backlog mapping
| Backlog item | Step |
|---|---|
| prints edit form (2 decimals) | 1 |
| customize home page | 2 |
| files and folders captive from server | 3 |
| print import numbering | 4 |
| sync button in printers / prints / filaments | 5 |
| integrations alerts | 6 |
| alerts regarding matching spool (review link) | 6 |
| allow user to match project when importing prints | 7 |
| date time format in settings | 8 |
| back button behavior | 9 |
| filaments page | 10 |
| project page refactor | 11 |
| dropdowns search | 12 |
