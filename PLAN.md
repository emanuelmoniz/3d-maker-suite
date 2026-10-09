# 3D Maker Suite - Development Plan v1.1 (target: 1.1.0-alpha.1)
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.

Status legend: `[ ]` todo · `[x]` done

---

## Phase 1 - Bugs & quick wins

### [x] Step 1 - 3D preview colors
**Model:** Sonnet · **Effort:** Medium
**Scope:** The project 3D viewer (`ModelViewer.tsx`) shows 3MF colors: per object/part extruder → filament color from the 3MF (Bambu `project_settings` / `slice_info` filament colors, core 3MF `basematerials`/`colorgroups`). Per-triangle painted colors (Bambu `paint_color`) if feasible without blocking the UI; otherwise fall back to per-part colors. STL stays single color (accent).
**Done when:** a multicolor fixture 3MF renders with its filament colors; unit test on the color extraction in `packages/3mf`.
**Prompt:**
```
Do Step 1 of PLAN.md. Color extraction belongs in packages/3mf (pure, tested on the
fixtures), the viewer only applies it. Check how Bambu stores per-part extruder and
painted colors in the fixtures first; tell me if painted colors are too costly.
```

### [x] Step 2 - Back button on detail and edit pages
**Model:** Haiku · **Effort:** Low
**Scope:** Shared back link in the page header for every detail (show) and edit/create page, going to the logical parent route (e.g. spool detail → filament list, printer edit → printer detail). i18n label, keyboard accessible, visible on mobile.
**Done when:** every detail/edit page has it; no hard-coded strings.
**Prompt:**
```
Do Step 2 of PLAN.md. One reusable component, parent route passed explicitly per page
(no history.back()). Reuse the existing page header if there is one.
```

### [x] Step 3 - Configurable server port
**Model:** Sonnet · **Effort:** Low
**Scope:** `pnpm start --port <n>` (and `--host`) CLI flags; port/host also editable in Settings (stored in a small config file in the data dir, applied on restart, "restart required" notice). Precedence: CLI flag > env `PORT`/`HOST` > config file > default 4300. Validate range, show the current effective value and its source.
**Done when:** each source works and precedence is unit-tested in `config.test.ts`.
**Prompt:**
```
Do Step 3 of PLAN.md. Extend apps/server/src/config.ts, no new CLI dependency
(node:util parseArgs). Changing host to non-loopback must keep the password rule.
```

### [x] Step 4 - App name & branding
**Model:** Sonnet (use frontend-design skill) · **Effort:** Medium
**Scope:** Settings → Appearance: custom app name (empty = default `common:appName`), logo upload (sidebar/header), favicon upload. Applied live (document title, favicon link). Images stored like printer photos and included in backups. Reset to default.
**Done when:** name/logo/favicon persist, survive backup/restore, and fall back cleanly.
**Prompt:**
```
Do Step 4 of PLAN.md. Reuse the existing image upload/storage path and its validation
(type + size). Keep common:appName as the default; the custom name is user data, not i18n.
```

---

## Phase 2 - Tables

### [x] Step 5 - Table framework: pagination, sort, column filters  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** Server-side pagination, sorting and per-column filters for list endpoints using `apps/server/src/lib/list.ts`; `DataTable` gets a pager (page size selector), server sort, and a column filter UI (text, select, number/date range); state synced to the URL (TanStack Router search params). Migrate the Prints table as the reference implementation.
**Done when:** Prints table pages/sorts/filters server-side with 10k seeded prints; URL is shareable; tests pass.
**Prompt:**
```
Do Step 5 of PLAN.md. Extend the existing list helpers instead of adding new ones.
Filters are declared per column once and drive both the API query schema (zod) and the UI.
Show me the column-filter API before implementing.
```

### [x] Step 6 - Apply the table framework everywhere
**Model:** Sonnet · **Effort:** Medium
**Scope:** All remaining tables (printers, spools, filament profiles, maintenance, projects list view, alerts, integrations sync log, review queue, …) use pagination, sort and column filters from Step 5. Keep existing tag filters working.
**Done when:** no unpaginated table left; e2e still green.
**Prompt:**
```
Do Step 6 of PLAN.md. List every table first, then migrate them one by one. Note any
table where server-side filtering doesn't fit and why.
```

---

## Phase 3 - Printers & maintenance

### [x] Step 7 - Maintenance types for multiple models and printers
**Model:** Sonnet · **Effort:** Medium
**Scope:** Maintenance type `appliesToModel` (single string) → a list of models (picked from existing printer models, free text allowed) and/or a list of specific printers. Schedules apply to the union. Drizzle migration that converts existing data.
**Done when:** existing types keep their scope after migration; due logic tests cover both kinds.
**Prompt:**
```
Do Step 7 of PLAN.md. New migration only, data copied from appliesToModel. Back up my DB
before running pnpm dev (it applies migrations to the real DB).
```

### [x] Step 8 - Printer models catalog & machine profiles  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** New entities: PrinterModel (brand, model, image/thumbnail, default power W) and MachineProfile (name, printer model, nozzle diameter, source/link to preset). Printers reference a PrinterModel (existing free-text brand/model migrated); prints can reference a MachineProfile. Manual CRUD for both. Creating a printer from a model pre-fills power and image.
**Done when:** manual CRUD works, existing printers are migrated to models, schema tests pass.
**Prompt:**
```
Do Step 8 of PLAN.md. Keep it manual-only here; imports come in Step 11. Show me the
schema and the migration of existing printers' brand/model before writing code.
```

---

## Phase 4 - Integrations hub

### [ ] Step 9 - Integrations hub  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** One place per integration with feature toggles: cloud account, local slicer config folder, slicer executable, and what to import (printers, machine profiles, filament profiles, prints). Move scattered settings (slicer path, Studio preset path) into it with a migration. Capabilities drive the UI: import buttons only show for enabled features; nothing configured = manual add only; several integrations = one import button each. "Open in slicer" uses the default slicer, with a picker when more than one is configured.
**Done when:** existing Bambu setups keep working after migration; UI hides/shows actions by capability; tests pass.
**Prompt:**
```
Do Step 9 of PLAN.md. Capabilities come from the adapter registry (core interfaces),
the web app never checks vendor names. Show me the settings migration and the
capability model before implementing.
```

### [ ] Step 10 - Sync by type and date range
**Model:** Sonnet · **Effort:** High
**Scope:** Separate sync actions per type (printers, prints, filament/spools when the source provides them) instead of one "sync now"; manual sync takes a date range (presets + custom) for prints. Scheduled sync stays incremental. Sync log shows type and range.
**Done when:** each type syncs alone; a past date range imports without duplicates.
**Prompt:**
```
Do Step 10 of PLAN.md. Check what Bambu Cloud actually exposes for spools/filament
before adding that type; if it doesn't, say so and skip it.
```

### [ ] Step 11 - Import printers & machine profiles from Bambu Studio
**Model:** Sonnet · **Effort:** Medium
**Scope:** From the local Bambu Studio config: printer models (with thumbnails if the install ships them), user + system machine presets → PrinterModel / MachineProfile, and printers from the local config if present. Preview → confirm, dedupe, keep link to the source preset (same flow as the filament library import).
**Done when:** import preview → confirm creates models/profiles; re-import doesn't duplicate.
**Prompt:**
```
Do Step 11 of PLAN.md. Reuse the existing Bambu Studio filament library reader and
preview flow. Verify the machine preset paths/format and where printer thumbnails live first.
```

### [ ] Step 12 - OrcaSlicer integration
**Model:** Sonnet · **Effort:** Medium
**Scope:** `packages/adapters/orca`: detect OrcaSlicer config per OS, import filament + machine presets, launch OrcaSlicer via `SlicerLauncher`. Shows up in the hub as a second integration (exercises multi-import buttons and the slicer picker).
**Done when:** Orca presets import and "Open in OrcaSlicer" works on Windows; macOS/Linux paths documented.
**Prompt:**
```
Do Step 12 of PLAN.md. Orca is a Bambu Studio fork: share the preset reader instead of
copying it (extract a small shared package if adapters can't import each other).
```

---

## Phase 5 - Release

### [ ] Step 13 - E2E & responsive pass for v1.1
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Playwright: table paging/filter, back button, branding, maintenance multi-scope, printer model + machine profile CRUD, integrations hub capability toggles. Viewports 375/768/1440. Fix what breaks.
**Done when:** E2E green in CI.
**Prompt:**
```
Do Step 13 of PLAN.md. Same fresh-temp-data-dir pattern as the existing suite.
List UI issues found and fix them in this step.
```

### [ ] Step 14 - Docs & v1.1.0-alpha.1 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs updates (port config, branding, integrations hub, OrcaSlicer), CHANGELOG, version `1.1.0-alpha.1`, release workflow publishes it as a GitHub pre-release.
**Done when:** tag builds a pre-release; docs match the app.
**Prompt:**
```
Do Step 14 of PLAN.md. Only document what changed since 1.0.0. Check the release
workflow handles a pre-release tag.
```

---

## Backlog mapping
| Backlog item | Step |
|---|---|
| 3D preview colors | 1 |
| Pagination | 5, 6 |
| Back button | 2 |
| Sync by type and date | 10 |
| App name | 4 |
| Branding (logo, favicon) | 4 |
| Maintenance for multiple printers/models | 7 |
| Server port | 3 |
| Printers & profiles from Bambu app (+ manual) | 8, 11 |
| Table filters & sort | 5, 6 |
| Integrations in one place, multi-slicer | 9, 12 |
