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

### [x] Step 9 - Integrations hub  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** One place per integration with feature toggles: cloud account, local slicer config folder, slicer executable, and what to import (printers, machine profiles, filament profiles, prints). Move scattered settings (slicer path, Studio preset path) into it with a migration. Capabilities drive the UI: import buttons only show for enabled features; nothing configured = manual add only; several integrations = one import button each. "Open in slicer" uses the default slicer, with a picker when more than one is configured.
**Done when:** existing Bambu setups keep working after migration; UI hides/shows actions by capability; tests pass.
**Prompt:**
```
Do Step 9 of PLAN.md. Capabilities come from the adapter registry (core interfaces),
the web app never checks vendor names. Show me the settings migration and the
capability model before implementing.
```

### [x] Step 10 - Sync by type and date range
**Model:** Sonnet · **Effort:** High
**Scope:** Separate sync actions per type (printers, prints, filament/spools when the source provides them) instead of one "sync now"; manual sync takes a date range (presets + custom) for prints. Scheduled sync stays incremental. Sync log shows type and range. Add option to define frequency 15m, 1h, 1d, 1w, 1M or sugest diferent approach.
**Done when:** each type syncs alone; a past date range imports without duplicates.
**Prompt:**
```
Do Step 10 of PLAN.md. Check what Bambu Cloud actually exposes for spools/filament
before adding that type; if it doesn't, say so and skip it.
```

Goal of Steps 11-16: two kinds of source. **Cloud** (account) brings the user's own printers, spools, prints and/or presets - works on a NAS/server deploy. **Local** (slicer config folder) also brings catalog data (brands, models, machine/filament profiles, materials) - only on a PC that has the slicer. Without either, everything is still added by hand. Each data type has its own sync policy (off / manual / auto + frequency).

### [x] Step 11 - Filament brands & materials
**Model:** Sonnet · **Effort:** Medium
**Scope:** Filament profiles pick brand and material from tables instead of free text. New `filament_brands` (name unique NOCASE, url, logo; separate from printer `brands`) and `filament_materials` (name unique NOCASE, e.g. PLA/PETG, optional default temps + density). Migration fills both from the existing distinct `filament_profiles.brand` / `material` values, then swaps the columns for `brandId` / `materialId`. Filament form: selects with inline "add"; filament list: filter + sort by brand and material; CRUD pages next to printer brands. Library and spool import resolve brand/material by name (find-or-create, like `modelIdFor`).
**Done when:** existing filament keeps its brand and material after migration; import creates or reuses them; tests pass.
**Prompt:**
```
Do Step 11 of PLAN.md. Back up the DB before running the migration (dev server applies it).
Show me the migration SQL before applying it.
```

### [ ] Step 12 - Cloud and local sources  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Adapters declare `kind: cloud | local`; the hub groups integrations under "Cloud" and "Local". `kind` only says where data comes from (account vs folder), not which types: each adapter declares the types it really provides. Type list grows to `printers, prints, spools, brands, printerModels, machineProfiles, filamentBrands, filamentProfiles` plus the `openInSlicer` action. Split Bambu into **Bambu Cloud** (printers, prints, spools) and **Bambu Studio** (filament profiles, open in slicer, catalog types from Step 14); migration splits each existing row in two without losing token, folders or history. Verify whether Bambu Studio keeps spools or print history locally; if not, leave those types out instead of faking them. "Open in slicer" is a feature of the local integration the user can switch on/off; the button shows only when it's on and a slicer program is configured and exists on the server. A local source whose folder isn't found on the server (NAS) shows "Not available on this server"; the config dir can still point at a mounted folder.
**Done when:** an existing Bambu setup keeps working after the split; a cloud-only deploy shows no local actions; tests pass.
**Prompt:**
```
Do Step 12 of PLAN.md. Core stays brand-agnostic, web never checks vendor names.
Show me the split migration and the new type/kind model before implementing.
```

### [ ] Step 13 - Sync policy per type  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** New table, one row per integration + type: `mode` (off | manual | auto), `frequency` (15m, 1h, 1d, 1w, 1M), `lastRunAt`, `cursor`. Replaces `sync_frequency`, `last_prints_sync_at` and `disabled_features` (migration carries current values over; `off` = disabled feature). Scheduler keeps its 15m tick and runs each auto type whose frequency has elapsed. Prints stay incremental; manual runs still take a date range. Types that need a preview (spools, profiles, catalog) in auto mode import only new/unambiguous rows; the rest waits for manual preview → confirm, with a pending count in the hub. Hub: per integration a table Type | Mode | Frequency | Last sync | Sync/Import now. Defaults: prints 1h, printers + spools 1d, catalog 1w.
**Done when:** each type follows its own mode and frequency; existing settings carried over; sync log shows per-type runs; tests pass.
**Prompt:**
```
Do Step 13 of PLAN.md. Show me the policy table, the migration of existing
frequency/disabled features, and how auto handles preview-only types before implementing.
```

### [ ] Step 14 - Import catalog & machine profiles from local slicer
**Model:** Sonnet · **Effort:** Medium
**Scope:** From the local Bambu Studio config and system DB: vendors → brands, machine models → PrinterModel (thumbnails if the install ships them), user + system machine presets → MachineProfile (`source_preset`), filament vendors → filament brands, filament types → materials, printers from the local config if present. Manual = preview → confirm (same flow as the filament library import); auto (weekly default) matches on the source key.
**Preset versioning** (machine + filament profiles, incl. the existing filament library import): changed preset + unused row → update in place. Changed preset + row used by a print, spool or printer → mark the row `archived` and add a new row with the latest version, so prints keep the preset they were made with. `source_preset` is unique only among non-archived rows. Archived rows are hidden from pickers/lists by default but still shown on records that use them. Presets missing from the source are never deleted. Brands, models and materials always update in place.
**Done when:** preview → confirm creates the catalog; re-import doesn't duplicate; changed unused preset updates in place; changed used preset archives the old row and adds the new one.
**Prompt:**
```
Do Step 14 of PLAN.md. Reuse the Bambu Studio filament library reader and preview flow.
Verify machine preset paths/format, the system vendor index, and thumbnail location first.
List which tables reference machine/filament profiles before writing the archive rule.
```

### [ ] Step 15 - OrcaSlicer integration (local)
**Model:** Sonnet · **Effort:** Medium
**Scope:** `packages/adapters/orca`: a `local` source. Detect OrcaSlicer config per OS, import filament + machine presets and the same catalog types as Bambu Studio, launch OrcaSlicer via `SlicerLauncher`. Orca 2.4+ keeps cloud-synced user presets under `user/<uuid>/` as well as `user/default/`: read both. Shows up in the hub as a second local integration (exercises multi-import buttons and the slicer picker).
**Done when:** Orca presets import and "Open in OrcaSlicer" works on Windows; macOS/Linux paths documented.
**Prompt:**
```
Do Step 15 of PLAN.md. Orca is a Bambu Studio fork: share the preset reader instead of
copying it (extract a small shared package if adapters can't import each other).
```

### [ ] Step 16 - Orca Cloud integration
**Model:** Sonnet · **Effort:** Medium
**Scope:** `packages/adapters/orca-cloud`: a `cloud` source. Orca Cloud (OrcaSlicer 2.4+) only syncs the user's own printer, filament and process presets - no devices, spools or prints. So it declares `machineProfiles`, `filamentProfiles` and the `printerModels` / `brands` / `filamentBrands` derived from them. Read-only access (`sync:read`) via OAuth 2.0 Device Authorization Grant (RFC 8628): `POST https://api.orcaslicer.com/oauth/device/code` → user enters the code in Orca Cloud settings → poll `POST /oauth/token` → `GET /api/v1/external/sync/pull?cursor=` returns `upserts` / `deletes` / `next_cursor`. Access token 24h; refresh token 90d and rotates on every use (reusing an old one after ~60s revokes the pairing), so store it atomically. Login page gets a "device code" flow (show code + link, poll). Cursor lives in the Step 13 policy row; reuse Step 14 preset versioning and the Step 15 shared preset parser. Remote deletes archive or are skipped, never hard-delete. API details come from a third-party integration (Bambuddy), not official docs.
**Blocker:** each app needs its own `client_id` registered with the Orca Cloud team (no public sign-up). Get one before starting, or skip this step.
**Done when:** pairing works; presets pull incrementally incl. deletes; the refresh token survives a restart.
**Prompt:**
```
Do Step 16 of PLAN.md. First confirm we have an Orca Cloud client_id and re-check the
external sync API (source code / Orca docs); if no client_id, stop and tell me.
```

---

## Phase 5 - Release

### [ ] Step 17 - E2E & responsive pass for v1.1
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Playwright: table paging/filter, back button, branding, maintenance multi-scope, printer model + machine profile CRUD, filament brand + material selects, preset archiving, integrations hub cloud/local grouping and per-type sync policy table. Viewports 375/768/1440. Fix what breaks.
**Done when:** E2E green in CI.
**Prompt:**
```
Do Step 17 of PLAN.md. Same fresh-temp-data-dir pattern as the existing suite.
List UI issues found and fix them in this step.
```

### [ ] Step 18 - Docs & v1.1.0-alpha.1 release
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs updates (port config, branding, integrations hub, NAS vs local deploy, OrcaSlicer, Orca Cloud pairing), CHANGELOG, version `1.1.0-alpha.1`, release workflow publishes it as a GitHub pre-release.
**Done when:** tag builds a pre-release; docs match the app.
**Prompt:**
```
Do Step 18 of PLAN.md. Only document what changed since 1.0.0. Check the release
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
| Printers & profiles from Bambu app (+ manual) | 8, 14 |
| Table filters & sort | 5, 6 |
| Integrations in one place, multi-slicer | 9, 15 |
| Filament brands table (+ materials) | 11 |
| Integrations: cloud vs local | 12, 14, 15, 16 |
| Select what syncs auto vs manual | 13 |
