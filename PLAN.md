# 3D Maker Suite - Development Plan v1
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.

Status legend: `[ ]` todo · `[x]` done

---

## Phase 0 - Foundation

### [x] Step 0 - Architecture & docs  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Domain glossary (Printer, MaintenanceType, MaintenanceTask, Spool, FilamentProfile, Print, PrintOutcome, Project, Tag, Collection, Integration, Alert). Integration interfaces: `PrintHistorySource`, `PrinterInventorySource`, `FilamentLibrarySource`, `SlicerLauncher`, `ProjectSource`, `MarketplaceLinker`. ADRs for: local-only run, SQLite, adapter pattern, i18n strategy, secrets storage, Bambu Cloud first.
**Done when:** `docs/adr/0001..000N.md` and `docs/architecture.md` exist, with a diagram in Mermaid.
**Prompt:**
```
Do Step 0 of PLAN.md. Don't write app code yet. Propose the domain model, entity relations,
integration interfaces (TypeScript signatures only, inside the docs) and the ADRs listed.
Keep each ADR under 40 lines. Ask me about anything ambiguous before writing.
```

### [x] Step 1 - Monorepo scaffold
**Model:** Sonnet · **Effort:** Medium
**Scope:** pnpm workspaces with the layout from CLAUDE.md; root package `3d-maker-suite`, workspace packages `@3d-maker-suite/*`; TS strict; Biome; Vitest; GitHub Actions (lint, typecheck, test); `.gitignore` includes `BACKLOG.md`, `data/`, `.env`; MIT license; `pnpm start` builds and runs on `http://localhost:4300`; data dir is OS-appropriate (overridable by `APP_DATA_DIR`).
**Done when:** `pnpm install && pnpm start` serves a "3D Maker Suite" hello page; CI is green.
**Prompt:**
```
Do Step 1 of PLAN.md. Follow CLAUDE.md layout and stack exactly. Server binds to 127.0.0.1
by default (configurable). Keep config minimal; explain any extra dependency in one line.
```

### [x] Step 2 - Domain model & database  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Drizzle schema + first migration for all v1 entities from Step 0, plus the settings table, the integration accounts table (encrypted secrets), and tags/collections (polymorphic tagging). zod schemas in core. Seed script with demo data (`pnpm db:seed`).
**Done when:** migrations run on a fresh DB; schema unit tests pass.
**Prompt:**
```
Do Step 2 of PLAN.md using docs/architecture.md. Design for: time-period stats queries
(index dates), multi-spool prints, print outcome + failure reason, energy per print
(estimated vs measured flag), soft delete where history matters. Show me the schema plan first.
```

### [x] Step 3 - API skeleton
**Model:** Sonnet · **Effort:** Medium
**Scope:** Fastify app structure, zod type provider, OpenAPI at `/api/docs`, error format, pagination/filter helpers, health endpoint, request logging, test harness with in-memory SQLite.
**Done when:** a sample CRUD route (settings) is tested end-to-end in Vitest.
**Prompt:**
```
Do Step 3 of PLAN.md. Create reusable helpers for list endpoints (pagination, sort,
date-range + entity filters) since stats and lists will need them everywhere.
```

### [x] Step 4 - App shell & design system
**Model:** Sonnet (use frontend-design skill) · **Effort:** Medium
**Scope:** Responsive layout (sidebar on desktop, bottom nav on mobile), routes for all modules (placeholders), light/dark/system themes via CSS variables + accent color, i18next setup (EN only, namespaces per module, lazy load), locale-aware formatters (date, number, currency, weight, duration, energy), shared components (DataTable, FilterBar, DateRangePicker, EmptyState, StatCard, ConfirmDialog, FormField), `pnpm i18n:check` script.
**Done when:** the shell looks modern on 375px / 768px / 1440px; no hard-coded strings.
**Prompt:**
```
Do Step 4 of PLAN.md. Use the frontend-design skill. Aim for a clean, modern, calm UI
that is dense enough for data. Show me 2 short style directions (described, not coded)
before implementing; I'll pick one.
```

### [x] Step 5 - Configuration module
**Model:** Sonnet · **Effort:** Low
**Scope:** Settings page + API: language (EN only, selector ready), theme, accent, currency, energy cost (€/kWh), units, default printer, project root folders, slicer executable path, alert thresholds (used later), data directory info.
**Done when:** settings persist and apply live.
**Prompt:**
```
Do Step 5 of PLAN.md. Group settings into sections (General, Appearance, Costs,
Projects, Integrations placeholder, Alerts placeholder).
```

---

## Phase 1 - Manual core (fully usable without integrations)

### [x] Step 6 - Printers
**Model:** Sonnet · **Effort:** Medium
**Scope:** CRUD; brand/model (free text, not an enum), serial number, purchase date and price, warranty end and notes, state (working / maintenance / inop / retired - configurable list), normal power (W), pinned notes/comments timeline (e.g. "X axis issue", "part ordered"), photo. Detail page shows total print hours, prints and energy with a period filter (computed from Prints).
**Done when:** CRUD + detail stats work with seed data; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md. Comments are a timeline with optional "pinned" flag and status
(open/resolved). Stats come from a core service so Stats module can reuse it later.
```

### [x] Step 7 - Maintenance
**Model:** Sonnet · **Effort:** Medium
**Scope:** Configurable maintenance types (name, description, interval by print hours and/or print count and/or days, applicable printer models). Schedules per printer, "log maintenance done" (date, notes, cost), next due calculation, overdue/upcoming list.
**Done when:** due dates update after logging prints or maintenance.
**Prompt:**
```
Do Step 7 of PLAN.md. Due logic lives in core as pure functions with unit tests
(hours, count, days, whichever comes first).
```

### [x] Step 8 - Filament & spools
**Model:** Sonnet · **Effort:** Medium
**Scope:** Filament profiles (brand, material, color name + hex, diameter, density, price per kg, nozzle/bed temps) and spools (profile, initial weight, remaining weight, empty spool weight, purchase date/price, location, status). Manual weight adjust with history.
**Done when:** CRUD done; remaining weight history is visible.
**Prompt:**
```
Do Step 8 of PLAN.md. Keep Profile vs Spool separate (many spools per profile).
Every remaining-weight change is a ledger entry (manual / print / correction).
```

### [x] Step 9 - Prints (manual) & outcome tracking
**Model:** Sonnet · **Effort:** Medium
**Scope:** Manual print entry: name, printer, project (optional), start/end/duration, one or more spools with grams used, outcome (success / failed / cancelled) + failure reason (configurable list) + notes, energy (estimated from printer W × time, or manual override). Saving deducts filament via the ledger. Source field (`manual` / integration id).
**Done when:** creating, editing or deleting a print keeps spool weights consistent.
**Prompt:**
```
Do Step 9 of PLAN.md. Editing or deleting a print must reverse/adjust its ledger entries.
Failed prints still consume filament (allow partial grams).
```

### [x] Step 10 - Tags & collections
**Model:** Sonnet · **Effort:** Low
**Scope:** Tags (name, color) usable on projects, prints, spools and printers; collections of projects (manual ordering). Tag filter in lists.
**Done when:** tags are filterable everywhere they apply.
**Prompt:**
```
Do Step 10 of PLAN.md using the polymorphic tagging from Step 2. Reusable TagPicker component.
```

---

## Phase 2 - Integrations (Bambu Cloud first)

### [x] Step 11 - Integration framework  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Adapter registry, integration accounts (encrypted credentials via a local key file), background sync jobs (croner) with status, last-run time and errors, an Integrations settings page, a dedupe strategy (external id + source), sync log.
**Done when:** a fake/mock adapter syncs prints end-to-end in tests.
**Prompt:**
```
Do Step 11 of PLAN.md. Build it so adding a vendor = one package implementing the
core interfaces + registering it. Include a mock adapter used in tests.
```

### [x] Step 12 - Bambu Cloud: login & printers  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Bambu Cloud login (email + password + email verification code / 2FA, region global/China); store the token only, never the password; refresh/expiry handling. Import bound printers (serial, model, name) → link to existing or create printers.
**Done when:** a real account can log in and printers are imported.
**Prompt:**
```
Do Step 12 of PLAN.md. The Bambu Cloud API is unofficial: first research the current
community docs (e.g. OpenBambuAPI on GitHub, recent home-assistant bambu integrations)
using web search, summarise the auth flow and endpoints, then plan. Handle rate limits
and API changes gracefully (clear error in UI, no crash).
```

### [x] Step 13 - Bambu Cloud: print history sync
**Model:** Sonnet · **Effort:** High
**Scope:** Fetch task history → Prints: title, cover image, start/end, duration, printer, status → outcome, filament per AMS slot (type, color, grams), MakerWorld design link when present. Match filament to spools (auto by type + color, else "needs review" queue). Deduct via the ledger. Incremental sync + manual "sync now".
**Done when:** history imports without duplicates; review queue works.
**Prompt:**
```
Do Step 13 of PLAN.md. Spool matching must never guess silently: auto-match only on
a unique type+color match, otherwise add it to the review queue in the UI.
```

### [x] Step 14 - Bambu Studio local filament library
**Model:** Sonnet · **Effort:** Medium
**Scope:** Detect Bambu Studio config folders per OS (Windows/macOS/Linux), read user filament presets (and optionally system presets), import as filament profiles (dedupe, keep link to the source preset).
**Done when:** import preview → confirm → profiles created.
**Prompt:**
```
Do Step 14 of PLAN.md. Verify current Bambu Studio preset paths and JSON format first;
make the path overridable in settings. Show an import preview before writing.
```

---

## Phase 3 - Projects & costs

### [x] Step 15 - 3MF parser package
**Model:** Sonnet · **Effort:** High
**Scope:** `packages/3mf`: read the zip and extract per plate: print time, filament grams/meters per slot, filament types and colors, multicolor flag, plate thumbnails, slicer and version, printer model. Works for sliced (Bambu `slice_info.config`) and unsliced 3MF (graceful partial data).
**Done when:** unit tests pass on fixture files in `packages/3mf/fixtures`.
**Prompt:**
```
Do Step 15 of PLAN.md. Pure package, no app imports, streaming-friendly, typed output.
I'll drop sample .3mf files into packages/3mf/fixtures; ask me if none are there.
```

### [x] Step 16 - Project scanner & manual projects
**Model:** Sonnet · **Effort:** High
**Scope:** Scan the configured root folders (one folder = one project, configurable depth), watch for changes (chokidar), collect files (3mf/stl/step/images/docs), parse 3MFs, extract a description from README/.md/.txt, detect marketplace URLs (MakerWorld, Printables, Thingiverse) in files or `.url` shortcuts, cover image selection. Manual project creation (folder optional). Re-scan without overwriting user edits.
**Done when:** scanning a sample tree creates correct projects; edits survive re-scan.
**Prompt:**
```
Do Step 16 of PLAN.md. Track which fields are user-edited vs scanned so re-scan only
updates scanned fields. Scanning runs as a background job with progress in the UI.
```

### [x] Step 17 - Projects UI & 3D preview
**Model:** Sonnet (use frontend-design skill) · **Effort:** Medium
**Scope:** Grid/list views, filters (tags, collections, multicolor, material), detail page (description, files, plates with print time and filament, linked prints, marketplace link), 3D viewer (3MF/STL, lazy loaded, orbit, plate select), lightweight thumbnails.
**Done when:** large models don't block the UI; mobile layout works.
**Prompt:**
```
Do Step 17 of PLAN.md. Lazy-load the 3D viewer chunk; fall back to the plate thumbnail
if the model is too large (configurable size limit).
```

### [x] Step 18 - Open in slicer & links
**Model:** Sonnet · **Effort:** Low
**Scope:** "Open in Bambu Studio" (spawn the configured slicer path with the file, via the `SlicerLauncher` interface), "Open folder", marketplace link buttons.
**Done when:** works on Windows, plus macOS/Linux paths documented.
**Prompt:**
```
Do Step 18 of PLAN.md. Only allow launching files inside configured project roots
(path traversal safe). Server-side only; the API returns success/error.
```

### [x] Step 19 - Cost engine & pricing calculator
**Model:** Sonnet · **Effort:** Medium
**Scope:** Core cost service: material (grams × spool price/kg), energy (kWh × €/kWh), printer wear (purchase price ÷ expected lifetime hours, optional), maintenance share (optional). Used in prints, projects (estimated from 3MF) and stats. Pricing calculator page: cost + labor (time × rate) + markup % + failure margin %, quantity, saveable quotes per project.
**Done when:** cost breakdowns show everywhere; unit tests on the calculations.
**Prompt:**
```
Do Step 19 of PLAN.md. All cost maths in core as pure, tested functions. Show
a breakdown (not just a total) in the UI.
```

---

## Phase 4 - Insights, alerts, polish

### [x] Step 20 - Stats module
**Model:** Sonnet · **Effort:** Medium
**Scope:** Filters: date range (presets + custom), printer, spool, filament profile, project, tag, outcome. Metrics: print count, success rate, print hours, energy (kWh and €), filament (g and €), total cost; time series + breakdowns; CSV export of the current view.
**Done when:** stats queries are fast with 10k seeded prints.
**Prompt:**
```
Do Step 20 of PLAN.md. Aggregate in SQL, not in JS. Add a seed option for 10k prints
and check query times.
```

### [x] Step 21 - Home dashboard widgets
**Model:** Sonnet · **Effort:** Medium
**Scope:** Widget registry (stat card, chart, list): this-month totals, printer states, maintenance due, low spools, recent prints, cost this month, success rate. Add/remove/reorder, saved layout, responsive grid.
**Done when:** the layout persists; widgets reuse the stats service.
**Prompt:**
```
Do Step 21 of PLAN.md. Widgets are self-registering components with a settings schema
so new widgets are easy to add.
```

### [x] Step 22 - Alerts
**Model:** Sonnet · **Effort:** Medium
**Scope:** Rules: spool below X g or %, maintenance due/overdue, warranty ending, sync errors. In-app notification center + badge; optional channels behind an interface: ntfy and email (SMTP). Daily evaluation job + on-event checks; snooze/dismiss.
**Done when:** alerts fire once (no spam) and clear when resolved.
**Prompt:**
```
Do Step 22 of PLAN.md. Channels behind a NotificationChannel interface. Dedupe so
each condition alerts once until it resolves or is snoozed.
```

### [x] Step 23 - Backup & export
**Model:** Sonnet · **Effort:** Low
**Scope:** One-click full backup (SQLite snapshot + uploaded images as zip), scheduled automatic backups with retention, restore with confirmation, CSV/JSON export per module.
**Done when:** backup → fresh install → restore gives identical data.
**Prompt:**
```
Do Step 23 of PLAN.md. Use SQLite's online backup API (safe while running). Version
the backup format for future migrations.
```

### [ ] Step 24 - E2E tests & responsive pass
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:** Playwright: settings, add printer, add spool, manual print deducts filament, project scan, stats filter, backup. Viewport checks at 375/768/1440. Fix what breaks.
**Done when:** E2E runs in CI.
**Prompt:**
```
Do Step 24 of PLAN.md. Keep tests independent with a fresh temp data dir each.
List UI issues found and fix them in this step.
```

### [ ] Step 25 - Security & performance review  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** Secrets handling, path traversal, file uploads, optional password when binding to LAN, dependency audit, bundle size, slow queries.
**Done when:** findings are fixed or documented as issues.
**Prompt:**
```
Do Step 25 of PLAN.md. Review only; list findings by severity with file references,
then fix high/medium ones after I approve.
```

### [ ] Step 26 - Docs & v1.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** README (features, screenshots, install, Bambu Cloud setup, FAQ), CONTRIBUTING (incl. "how to add an adapter", "how to add a language"), CHANGELOG, GitHub release workflow, issue templates.
**Done when:** a new user can install from the README alone.
**Prompt:**
```
Do Step 26 of PLAN.md. Keep the README scannable; put details in docs/. Leave
screenshot placeholders where I need to add images.
```
