# 3D Maker Suite - Development Plans 4.1.0, 4.1.1, 4.2.0, 5.0.0, 5.1.0 and 6.0.0
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.
- Each feature step adds its own e2e spec.
- Steps that change `packages/db/src/schema.ts`: back up the DB **before** editing it (`pnpm dev` applies new migrations to the real DB).
- Skills: `webapp-testing` for screenshots or browser checks, `frontend-design` for new visual pieces, `dataviz` for charts.

Versioning (default from now on):
- Stay on 4.x until 5.0.0 (the hub, an agreed major), then on 5.x until 6.0.0 (every printer, an agreed major), then on 6.x. **One plan = one release.**
- Minor bump (`4.Y.0`) when the plan adds features, patch bump (`4.Y.Z`) when it only fixes things. A major bump only for an explicit, agreed breaking change.
- During a plan: pre-releases `4.Y.Z-alpha.N` tagged on `dev`. Stable: fast-forward `main` to `dev`, tag `v4.Y.Z` on `main`.
- Keep the root and `packages/*` versions in sync when bumping.

Status legend: `[ ]` todo · `[x]` done

---

# Plan 4.1.0 - Desktop & polish

## Phase 1 - Fixes

### [x] Step 1 - Mobile overflow on the project page
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:**
- Bug: on phones in portrait (iPhone 16 Pro Max 440px, Pixel 9 Pro 412px) the project page overflows to the right and the bottom nav is not pinned (you have to scroll to see it).
- Root cause: a grid with no column template sizes its children to their content. The gallery thumbnail strip (`ProjectGallery.tsx:55,118`, 5+ images) and long URLs / tables in the description (`Markdown.tsx:77`) widen the column past the screen. A document wider than the viewport makes mobile browsers widen the layout viewport, so the `fixed bottom-0` nav (`AppShell.tsx:162`) slides out of view. The nav itself is fine.
- Fix once for every page: `@layer base { .grid > * { min-width: 0 } }` in `styles.css` (grids only; flex rows keep their default so icons don't squash). `[overflow-wrap:anywhere]` on the `PageHeader` h1 and the Markdown root; `pre` and tables keep their own `overflow-x-auto`. `viewport-fit=cover` in `index.html` so `env(safe-area-inset-bottom)` works.
- Check the same pattern on the alert, printer and accessory detail pages and on `CostBreakdown` (`grid-cols-[1fr_auto]`).
- e2e: move the rich project seed out of `scripts/screenshots.shot.ts` into `e2e/helpers.ts` (`png()`, `seedRichProject`: 8 gallery images, description with a 200-char URL, a table and a code block, long name); screenshots reuse it. New `e2e/mobile-detail.e2e.ts` at 412×915 and 440×956 on project, alert, printer and accessory detail: `hasHorizontalScroll` false, nothing `offScreen`, bottom nav's bottom edge = viewport height.

**Done when:** no horizontal scroll at 375/412/440 with the rich project; the nav stays pinned; the new e2e passes; screenshots still build; tests pass.
**Prompt:**
```
Do Step 1 of PLAN.md. Reproduce the overflow at 412 and 440 first, then fix it.
```

### [x] Step 2 - Footer
**Model:** Haiku · **Effort:** Low
**Scope:**
- A footer at the bottom of the main content zone: `2026 | v4.1.0 - Stable | by AZSeashell | GitHub`. "AZSeashell" links to https://azseashell.com, "GitHub" to the repo.
- Year = current year. "Pre-Release" when the version contains `-`, else "Stable". Version from `useUpdates()`.
- `REPO_URL` and `SITE_URL` constants in `packages/core`; the server's `updates.ts:33` builds its API URL from `REPO_URL`.
- i18n `common:footer.*` with `<Trans>` for the links (no string concatenation).
- `<main>` becomes `flex flex-col`, the content wrapper `flex-1`, so the footer sits at the bottom on short pages and above the mobile bottom nav.
- Remove the version from the sidebar footer (`AppShell.tsx:140-144`), the footer shows it at every size.

**Done when:** the footer shows on every page at 375/768/1440, pinned to the bottom on short pages; links open; pre-release label checked with an `-alpha` version; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 2 of PLAN.md.
```

### [x] Step 3 - Sync success alerts: call to action is the module
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `sync_success` alerts get a CTA to the synced module: prints → "View prints" (`/prints`), spools → "View spools" (`/filament`), printers → "View printers" (`/printers`), catalog types → their section in `/printers/settings` (brands, printer models, machine profiles, print profiles) or `/filament/settings` (filament brands, materials, profiles).
- One web map `apps/web/src/lib/syncTargets.ts` (type → route, hash, i18n label, keys written out in full for i18n:check), used by the alert list rows (button, like "Review" on `sync_pending`) and the alert detail page.
- Anchors: an `id` on each catalog section (`printers/Catalog.tsx`, `filament/Catalog.tsx`) and `id="integration-<id>"` + `scroll-mt` on each integration card. `sync_error` "Open integration" goes to that card.
- No schema change. Notification channel links stay `/alerts/:id`.

**Done when:** each synced type's success alert opens the right page/section; sync errors land on the right integration card; e2e on a prints sync alert; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 3 of PLAN.md.
```

### [x] Step 4 - Projects docs and the external DB decision
**Model:** Sonnet · **Effort:** Low
**Scope:**
- `docs/projects.md`: recommended folder structure; `NNN_name` prefix (project number); `000_` template folders; adoption of folderless projects by number; project depth, files depth and auto slice per root; examples with several roots (e.g. own designs `Category/Project` depth 2, downloads depth 1, an archive on a NAS share); trash folder; renaming a folder; Docker bind mounts.
- Link it from the README and from Settings → Projects: `Section` gets an optional `help` prop (small "Help" link, `common:help`) pointing to the doc on GitHub (`REPO_URL`).
- `docs/adr/0010-stay-on-sqlite.md`: external DB servers (MariaDB, Postgres, SQL Server) are not supported. Reasons: Drizzle has no SQL Server driver; all data access is synchronous better-sqlite3 (~390 calls, 21 transactions); ~25 SQLite-only SQL spots; backup, update and rollback rely on a DB file; MariaDB lacks `RETURNING`/`ON CONFLICT` in Drizzle (68 places). What would change the decision.

**Done when:** the doc covers every point with examples; the help link works; the ADR exists; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 4 of PLAN.md. Check the scanner code for every rule you document.
```

## Phase 2 - Projects & integrations

### [x] Step 5 - Project folder: create, link, missing  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Today a project with no folder can't get one later (the field is hidden on edit). A folder deleted or renamed on disk is never noticed: the project keeps stale files (404 on open), and a renamed folder becomes a twin project. `scanner.addFolder()` accepts folders outside every root, which later fail with 403.
- Server (`routes/projects.ts`):
  - `POST /api/projects/:id/folder {root}`: create `NNN_name` with `newProjectFolder()` / `folderName()`; `{path}`: link an existing folder, must pass `insideRoots()` (`outside_roots`) and not belong to another project (`folder_in_use`). Both rescan the project; a created folder is removed if the update fails.
  - `DELETE /api/projects/:id/folder`: unlink (`folderPath = null`, file list cleared, files on disk untouched).
  - Project detail gets `folderState: "ok" | "missing" | null` (Step 7 of 4.2.0 adds `"offline"`).
  - `addFolder()` requires the folder to be inside a root. Decide whether the projects import keeps allowing outside folders (recommended: no, `docs/import.md` already says inside a root).
- Web: a "Project folder" collapsible card on the edit page: no folder → Create (root combobox when there are several) or Link (PathPicker); linked → path + Unlink (ConfirmDialog). On the project page, a banner when the folder is missing: Recreate / Link another / Unlink.

**Done when:** the endpoints and states are approved; create, link, unlink and the missing banner work; outside-root links are refused; tests in `projects.test.ts`; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 5 of PLAN.md. Show me the endpoints, the folderState rules and the UI states first.
```

### [x] Step 6 - Integrations page redesign 1: card frame
**Model:** Sonnet (use frontend-design skill) · **Effort:** Medium
**Scope:** UI only, no functionality change.
- Two small components on native elements: `Switch` (`<input type="checkbox" role="switch">`) and `Menu` (`<details>`, keyboard accessible).
- Card header: name, kind, status pill, Enabled switch, ⋯ menu with Test connection, Sign in again and Delete. Messages collapse to "N messages" when more than one.
- Card body: three `Collapsible`s, **Sync** (open), **Slicer** (local only) and **Log** (closed).
- Split `IntegrationsPage.tsx` (743 lines) into `IntegrationCard.tsx` and `PolicyRow.tsx` in the same folder.

**Done when:** every action still works from the new header/menu; keyboard and screen reader ok; 375/1440 screenshots; e2e selectors updated; tests pass.
**Prompt:**
```
Do Step 6 of PLAN.md.
```

### [x] Step 7 - Integrations page redesign 2: sync rows  **[plan mode]**
**Model:** Opus (use frontend-design skill) · **Effort:** High
**Scope:** UI, plus one change agreed during the step: data types lose **Off** (manual is the base, Auto is a switch; migration 0064 turns off data types into manual, off spools untracked; new cloud spools start manual and untracked). Actions keep Off | On.
- Sync types grouped: **Devices & prints** and **Catalog** (actions like slice / open in slicer in their own small group).
- A compact row per type: name, **Auto / Manual** badge, last sync, Sync now, **Manual import** (yellow, with "⚠ N to review", when a run left rows). An expandable part per row: a **Sync** section (Auto switch, frequency only when Auto, alert checkboxes), the history range (prints), track usage (prints/spools). The double-tracking warning sits under Devices & prints.
- Mobile: each row is two lines (name + last sync + Sync now / mode), expands in place, no sideways scroll.

```
┌ Bambu Studio · Local · ● Connected ───────── [◉ Enabled] [⋯] ┐
│ ▾ Sync                                                        │
│   Devices & prints                                            │
│   Prints   [Off|Manual|Auto]  5 min ago  [Sync now] 3 ▸       │
│     └ Every [6 h ▾] Alerts ☑Error ☑Review ☐Success ☑Track     │
│       History from [date] to [date]  ⚠ double tracking         │
│   Catalog                                                     │
│   Brands   [Off|Manual|Auto]  2 h ago    [Sync now]   ▸       │
│ ▸ Slicer (program, config folder, default slicer)             │
│ ▸ Log                                                         │
└───────────────────────────────────────────────────────────────┘
```

**Done when:** the mock is approved; every policy setting is still editable; no sideways scroll at 375/412; e2e (policy specs updated); 375/768/1440 screenshots; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 7 of PLAN.md. Show me a desktop and a mobile mock of a Bambu Cloud and a Bambu
Studio card first.
```

### [x] Step 7b - Manual import for cloud printers  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** printers become a reviewed type, so the Printers row gets **Manual import** like prints and spools.
- `printers` in `REVIEWED_TYPES`; a `printerRows` builder in `integrations/sourceRows.ts` from the adapter's `listPrinters()`.
- The printers import keeps `integrationId` / `externalId`, and links a hand-added printer with the same serial instead of creating a twin (what the direct sync in `integrations/sync.ts` does today). The direct printers path in the sync goes away; a run takes the rows that need no decision, like the other reviewed types.
- Start after the import/review work in progress is committed (it changes `sourceRows.ts` and `import/review.ts`).

**Done when:** Manual import on Printers opens the review with the cloud's printers; a sync still creates and links printers as before; server tests for twin linking and re-sync; e2e for the row; tests pass.
**Prompt:**
```
Do Step 7b of PLAN.md.
```

### [x] Step 8 - Docs, push & v4.1.0-alpha.1
**Model:** Haiku · **Effort:** Low
**Scope:** README/docs for Steps 1-7, CHANGELOG, version `4.1.0-alpha.1` (root and `packages/*`). Refresh `pnpm screenshots` (project page and integrations changed). Commit, push `dev`, create and push tag `v4.1.0-alpha.1` on `dev`; check the run and the pre-release.
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 8 of PLAN.md. Only document what changed since 4.0.0. Then push dev, push the tag
and confirm the pre-release is published.
```

## Phase 3 - Installer, launcher & autostart

Design (native, unsigned installers):
- The installer holds **Node 22, `launcher.mjs` and a base app version**. Windows: Inno Setup, per user, no admin (`%LOCALAPPDATA%\Programs\3D Maker Suite`). macOS: `.app` in a `.dmg`, ad-hoc signed (`codesign -s -`, Apple Silicon refuses fully unsigned code). Linux: AppImage, or `tar.gz` + `install.sh` if libfuse2 is a problem.
- In-app updates go to `<appDir>/versions/<v>/` side by side with a `current.json` pointer. The installed app is never written to (no Windows file locks, no read-only .app/AppImage problems).
- The server keeps running through `tsx`, like git and Docker installs (one code path). Compile only if cold start > ~3 s.
- No console window: on Windows a copy of `node.exe` with the PE subsystem patched to GUI (`nodew.exe`). Rejected: VBScript (deprecated), `conhost --headless` (undocumented), hidden PowerShell (flashes).
- Unsigned warnings, documented with screenshots: Windows SmartScreen → More info → Run anyway; macOS 15+ → System Settings → Privacy & Security → Open Anyway (`xattr -dr com.apple.quarantine` as fallback). Signing can be added to CI later with no other change.

### [x] Step 9 - Installer spike  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Prove the risky parts before building, in a throwaway branch or `packaging/spike/`:
- `nodew.exe` (patched subsystem): spawns the server with `windowsHide`, stdio to a log file, no window; how Windows Defender reacts.
- Inno Setup available on `windows-latest` (`iscc`), per-user install without admin.
- macOS: a `.app` running a shell script that `exec`s bundled node; ad-hoc signing; Gatekeeper flow on macOS 15; arm64 runner, and whether an x64 build is possible (Intel runner or cross-packaging).
- Linux: AppImage vs `tar.gz` (libfuse2 on recent Ubuntu).
- Bundle size per OS (prod `node_modules` + web dist + Node).
- A second app version in `versions/` loads its own `better_sqlite3.node` and opens the DB.
- Cold start time with `tsx`.

**Done when:** each point has a yes/no with evidence in the summary; the chosen Linux format and macOS arches are decided; nothing merged to `dev` except notes.
**Prompt:**
```
Do Step 9 of PLAN.md. Report each spike point with evidence and your recommendation.
```

### [x] Step 10 - ADR-0011 and installer builds in CI  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Read `packaging/spike/NOTES.md` (Step 9 findings and recommendations) first; spike code is on branch `spike/installer` (delete it once this step lands).
- `docs/adr/0011-bundle-installs.md` (amends ADR-0009): folder layout, `current.json`, launcher, update and rollback flow, unsigned warnings, rejected options.
- `packaging/`: Inno Setup script (tasks: desktop icon, start at login), macOS `.app` template + `.dmg` (arm64 + x64, both built on `macos-15`), Linux `tar.gz` + `.desktop` entry (no AppImage).
- Release workflow: a matrix job per OS/arch that builds the web, `pnpm install --prod --frozen-lockfile` (`node-linker=hoisted`, links recorded in `links.json` and recreated at start), drops dev files, adds Node (Windows: patched `nodew.exe` only), and publishes the installer, an app-only zip `3d-maker-suite-<tag>-app-<os>-<arch>.zip` and `SHA256SUMS`.
- GitHub Actions: bump `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `pnpm/action-setup` (and any `docker/*` action with the same warning) to their Node 24 majors in `ci.yml` and `release.yml`, to clear the "Node.js 20 is deprecated" warning. Check each action's release notes for breaking changes.

**Done when:** the ADR is approved; a test pre-release has installers, app zips and checksums for every target; each installer installs and starts the app (launcher can still be the plain start script here, plus the relink); release and CI runs show no Node 20 deprecation warning.
**Prompt:**
```
Do Step 10 of PLAN.md. Show me the ADR draft and the release asset list first.
```

### [x] Step 11 - Launcher and Stop server
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `packaging/launcher.mjs` (Node stdlib only): read host/port from the saved config; if `/api/health` answers, open the browser and exit (single instance); else start the server hidden with `APP_INSTALL=bundle`, stdio to `<install dir>/logs/server.log` (rotated by size, ADR-0011), wait for health, open the browser; handle exit 75 like `scripts/start.mjs`.
- `POST /api/server-config/stop` and a **Stop server** button in Settings → Server (ConfirmDialog), since there is no console to close.
- Desktop/Start-menu shortcuts, the macOS `.app` and the Linux entry run the launcher.

**Done when:** double-click starts the app with no window and opens the browser; a second double-click only opens the browser; Stop works; logs land in the file; tests pass.
**Prompt:**
```
Do Step 11 of PLAN.md.
```

### [x] Step 12 - Start at login
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `apps/server/src/lib/autostart.ts` (get/set, no admin): Windows HKCU `Software\Microsoft\Windows\CurrentVersion\Run` via `reg.exe`; macOS `~/Library/LaunchAgents/*.plist` with `RunAtLoad`; Linux `~/.config/autostart/*.desktop`.
- `GET/PUT /api/server-config/autostart`, shown only when the launch command is known (`APP_LAUNCH_CMD`, set by the launcher and by `scripts/start.mjs` for git installs, which then start with a console window - documented).
- "Start at login" toggle in Settings → Server; the Windows installer checkbox writes the same entry.
- `docs/install.md` "Start at login": point at the toggle, keep the manual setup for Docker/advanced.

**Done when:** the toggle adds/removes the entry on each OS (unit tests with a fake runner; manual check on Windows and macOS); the app starts at login; tests pass.
**Prompt:**
```
Do Step 12 of PLAN.md.
```

### [x] Step 13 - Bundle updates and rollback  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- `installType()` returns `bundle` when `APP_INSTALL=bundle`.
- Update: download the app zip for this OS/arch, check its sha256 against `SHA256SUMS`, unzip (yauzl) into `<appDir>/versions/<v>/`, `createBackup(db, dataDir, "update")`, write `.update/pending.json` into `<appDir>`, exit 75.
- The launcher starts the new version (newest folder wins, no pointer: ADR-0011); if health fails within 60 s or it exits during boot, it goes back to the old folder and restores the pre-update state (existing staged restore).
- Rollback from Settings works the same way (previous version + its backup). Keep two versions, delete older ones.
- A release that needs a newer Node major: no in-app update, an alert says to run the new installer.
- Progress and errors in the existing update dialog.

**Done when:** the flow is approved; a local update between two built bundles and a rollback both work (tests with fake downloads + one manual run); a bad checksum is refused; a failing boot rolls back by itself; tests pass.
**Prompt:**
```
Do Step 13 of PLAN.md. Show me the update and rollback sequence (files, pointer, backup,
failure cases) first.
```

### [x] Step 14 - Docs, push & v4.1.0-alpha.2
**Model:** Haiku · **Effort:** Low
**Scope:** `docs/install.md`: installers per OS first, the unsigned warnings with screenshots, where data and logs live, Start at login, Stop; git install and Docker stay as they are. `docs/configuration.md`, CHANGELOG, version `4.1.0-alpha.2`. Commit, push `dev`, create and push tag `v4.1.0-alpha.2` on `dev`; check the run, the pre-release assets and the `:dev` image.
**Done when:** `dev` and the tag are pushed; the workflow is green; installers, app zips and checksums are on the pre-release; docs match the app.
**Prompt:**
```
Do Step 14 of PLAN.md. Only document what changed since 4.1.0-alpha.1. Then push dev,
push the tag and confirm the pre-release assets are published.
```

### [x] Step 15 - Real install test: alpha.2 → alpha.3 and back
**Model:** Sonnet · **Effort:** Medium
**Scope:** Tag `v4.1.0-alpha.3` on `dev` with a trivial, visible change. On a clean Windows machine (macOS and Linux are deferred: no machine available, repeat the same steps later and add their results next to the Windows ones): download and install alpha.2 (note every warning screen), double-click → browser opens, no window; enable Start at login, reboot, app is up; Check now → Update to alpha.3 → version, `update-` backup, history ok; add a row → Roll back to alpha.2 → row gone, version alpha.2; Stop server. Fix anything found and note it in the CHANGELOG. Screenshots, saved in `test-runs/4.1.0-alpha.2/<os>/` (not in `docs/images`): each warning screen as the installer shows it (SmartScreen, macOS "Open Anyway"), the browser after the first start, Settings → Server with Start at login on and the Stop button, the update banner and the Update progress, the update history with the rollback button, and the list after rollback. Write the test results in `test-runs/4.1.0-alpha.2/README.md`: machine, OS version, each step pass/fail, and any warning text that differs from `docs/install.md`.
**Done when:** install, autostart, update, rollback and stop worked on Windows (macOS and Linux deferred); the screenshots and the results file are committed; fixes are released in alpha.3 (or alpha.4, repeating the test).
**Prompt:**
```
Do Step 15 of PLAN.md. Guide me through the test on each machine, then fix what we find.
```

### [x] Step 16 - Docs, push & v4.1.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** `pnpm screenshots`, README (installers first in "Install"), CHANGELOG, version `4.1.0`. Commit on `dev`, fast-forward `main` to `dev`, push both, create and push tag `v4.1.0` on `main`. Check the run, the release (assets) and the `:latest` image.
**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest with installers; the image is published; updating 4.0.0 (git) and 4.1.0-alpha.3 (installer) to 4.1.0 works.
**Prompt:**
```
Do Step 16 of PLAN.md. Only document what changed since the last 4.1.0 pre-release. Then
fast-forward main to dev, push, push the v4.1.0 tag and confirm the release and image.
```

---

# Plan 4.1.1 - Fixes & polish

Patch release: fixes and small improvements from the 4.1.0 test run, before 4.2.0.

## Phase 4 - Server, launcher & bugs

### [x] Step 1 - Lint noise and autostart 404
**Model:** Haiku · **Effort:** Low
**Scope:**
- Tailwind canonical classes: `lg:min-h-[28rem]` → `lg:min-h-112` (`ProjectDetailPage.tsx`), `size-[18px]` → `size-4.5` (3× in `AppShell.tsx`), and any other `suggestCanonicalClasses` hit.
- `GET /api/server-config/autostart` is only registered when the launch command is known (`routes/serverConfig.ts:48`), but the web always calls it → `404` warn in the dev log. The web asks only when the server says Start at login is supported (or the route answers `supported: false`); no 404 in the log.

**Done when:** no canonical-class warnings; `pnpm dev` without a launch command logs no autostart 404; tests pass.
**Prompt:**
```
Do Step 1 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 2 - Settings → Server layout
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- **Restart** and **Stop** become page-header actions on the right, like the buttons on other pages.
- "Restart and open in new tab" → "Restart server".
- Network section: a clear hint that host/port changes apply only after a restart (or stop and start again).
- "Start at login" moves to the General section.
- Data dir shown as plain text, not a disabled input; the "read-only" hint goes.

**Done when:** the layout matches other pages at 375/1440; every action still works; e2e selectors updated; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 2 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 3 - Restart without a new tab
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Today `ServerSection.tsx:61-82` pre-opens a blank tab on click (to dodge the popup blocker) and points it at the new host/port once `/api/health` answers.
- Replace with a "Server restarting…" modal in the same tab that polls health, then reloads. If host or port changed, poll the new address and redirect the same tab there.
- Timeout: error message in the modal with the new URL as a link.

**Done when:** restart with the same port reloads in place; restart after a port change lands on the new port in the same tab; no new tab is opened; e2e for the modal; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 3 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 4 - Launcher: browser only when the user starts it
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Start at login must not open the browser: a `--background` arg for `packaging/launcher.mjs`, written by `lib/autostart.ts` (Windows Run value, macOS plist, Linux `.desktop`) and by `packaging/setup.iss` `[Registry]`. Entries written by 4.1.0 lack the flag: rewrite the entry at boot when autostart is on.
- The installer's "Start 3D Maker Suite" option (`setup.iss` `[Run]`) runs the launcher but no browser opened. Find why (suspects: the first start recreating the `links.json` links takes longer than `waitHealthy(url, 60_000)` in `launcher.mjs`, or the post-install process gets killed) and fix it.
- Loader: when started from the installer or a shortcut, open the browser at once on a static "Starting 3D Maker Suite…" page (file next to the launcher) that polls `/api/health` and redirects to the app.

**Done when:** after a reboot with Start at login on, the server runs and no browser opens; the installer option and the shortcut open the loader, then the app; launcher unit tests for the flag; manual check on Windows; tests pass.
**Prompt:**
```
Do Step 4 of the 4.1.1 plan in PLAN.md. Find why the installer's start option opened no
browser before changing anything.
```

### [x] Step 5 - Update available alert: call to action
**Model:** Haiku · **Effort:** Low
**Scope:** the update available alert gets an "Open updates" call to action to the update section in Settings (anchor), on the alert detail page (list rows keep only their own actions, Step 9).
**Done when:** the button opens Settings at the update section; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 5 of the 4.1.1 plan in PLAN.md.
```

## Phase 5 - Pages

### [x] Step 6 - Project page: hide empty cards
**Model:** Sonnet (use webapp-testing skill) · **Effort:** Medium
**Scope:**
- No folder → no **Files** card.
- No prints → no **Prints** card.
- No 3D file (including the folder fallback) but prints exist → no 3D preview zone; the prints cost card moves to the left column.

**Done when:** each combination renders without empty cards at 375/1440; e2e per layout; screenshots refreshed if the README project page changed; tests pass.
**Prompt:**
```
Do Step 6 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 7 - Mobile header branding
**Model:** Haiku · **Effort:** Low
**Scope:** below `md`, the logo and `common:appName` in a header at the top of the content that scrolls away with it (not fixed).
**Done when:** shows at 375/412, hidden on desktop; no horizontal scroll; tests pass.
**Prompt:**
```
Do Step 7 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 8 - Delete client
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `DELETE /api/clients/:id` like orders and quotes. `409 client_in_use` when an order references the client. Quotes don't block: the FK (`set null`) clears their client.
- Delete in the client page/list with ConfirmDialog; disabled with the reason when orders exist.

**Done when:** a client with no orders is deleted and its quotes keep existing without a client; one with orders is refused; server tests; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 8 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 9 - Alerts list: only the alert's own actions
**Model:** Haiku · **Effort:** Low
**Scope:** rows in "Needs your attention" keep only mark read / dismiss. Every other button ("Review" included) and the navigation calls to action (e.g. "View filament profiles", added to the rows in 4.1 Step 3 via `syncTargets.ts`) live only on the alert detail page.
**Done when:** list rows show only read/dismiss; the detail page still has every call to action; e2e updated; tests pass.
**Prompt:**
```
Do Step 9 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 10 - Add printer: model and brand in modals
**Model:** Sonnet · **Effort:** Medium
**Scope:** on Add printer, "Add model" opens a modal instead of leaving the page; inside it, "Add brand" opens a second modal. Saving the brand closes it and selects it in the model modal; saving the model closes it and selects it on the printer form. Keyboard and focus return work.
**Done when:** a printer can be added with a new brand and model without leaving the page; e2e for the chain; i18n:check passes; tests pass.
**Follow-up (done):** the new row is now selected after save, and the same "+ Add …" picker and modal (`PickerWithAdd`, `AddDialog`) are used everywhere: model → brand, machine and print profile → model, printer → print profile, print → machine profile and spool, spool → filament profile, filament profile → brand and material (replaces the inline add), order and quote → client.
**Prompt:**
```
Do Step 10 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 11 - Sync options: what to sync, how to sync  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** two options per sync type in the policy row, for every reviewed type except prints (printers, spools, the 7 slicer types). Back up the DB first.
- **What to sync:** `All` | `Only already imported`. The latter updates rows you have and takes a new row only when its brand exists locally (models, machine/print/filament profiles, printers, spools); brands, filament brands and materials themselves: existing only. Out-of-scope new rows are ignored quietly (not pending, no alert). First import = review, filter the brand column, select all filtered.
- **How to sync:** `Overwrite with source` | `Keep my edits` | `Let me review the changes`.
  - Keep my edits, per field: the values last imported are stored per row (new `import_snapshots` table); a field that differs locally from them stays, others update. No snapshot yet → only blanks are filled.
  - Let me review: a source change (source ≠ snapshot, not ≠ local) waits → `pending` → the existing `sync_pending` alert. Skipping it in the review marks those source values as seen. No snapshot yet → the source is the baseline, no alert.
- Defaults: All + Keep my edits for the slicer types, All + Let me review for printers and spools (replaces their `handsOff`). Prints stay insert-only. Spool weight is never overwritten while usage is tracked.
- Manual reviews follow the options too (out-of-scope rows pre-skipped, Merge defaults to the type's choice). Hints in the UI, a section in `docs/import.md`.

**Done when:** a printer models sync with Only imported takes a new Bambu model but no Prusa one; Keep my edits keeps an edited field and updates another; Let me review raises one alert per source change, not per run; migration runs on an existing DB; server and core tests; e2e for the options; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 11 of the 4.1.1 plan in PLAN.md.
```

### [x] Step 12 - Sync schedule time  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Frequencies are `15m | 1h | 1d | 1w | 1M` (`core/schemas/enums.ts`). Each gets its own time setting: 15 min → minute offset; hourly → minute; daily → hour:minute; weekly → weekday + hour; monthly → day (1-28) + hour. Unset → today's default.
- Migration: nullable columns on the sync policy; the job builds the croner pattern from them. Back up the DB first.
- UI in the expanded policy row, next to the frequency, only when Auto.

**Done when:** the fields and defaults are approved; a policy runs at the chosen time (unit tests for the pattern per frequency); existing policies keep running as before; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 12 of the 4.1.1 plan in PLAN.md. Show me the columns, defaults and croner patterns first.
```

### [x] Step 13 - Docs, push & v4.1.1 release
**Model:** Haiku · **Effort:** Low
**Scope:** `pnpm screenshots` (project page, settings), docs touched by Steps 1-12, CHANGELOG, version `4.1.1` (root and `packages/*`). Commit on `dev`, fast-forward `main` to `dev`, push both, create and push tag `v4.1.1` on `main`. Check the run, the release (assets) and the `:latest` image.
**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest with installers; updating 4.1.0 (installer and git) to 4.1.1 works.
**Prompt:**
```
Do Step 13 of the 4.1.1 plan in PLAN.md. Only document what changed since 4.1.0. Then
fast-forward main to dev, push, push the v4.1.1 tag and confirm the release and image.
```

---

# Plan 4.2.0 - Server, NAS & multi-user

## Phase 6 - Users and roles

Design (fixed roles):
- Tables: `users` (email unique, display name, scrypt hash via `node:crypto`, role `admin | editor | viewer`, disabled, created/last login), `sessions` (sha256 of the token, user, expiry), `user_settings` (per-user display preferences), `logs.actor`.
- Session: httpOnly, SameSite=Lax cookie, parsed/set with a few lines in `lib/session.ts` (no new dependency).
- Modes: no users = today's behaviour (loopback/host guard + `APP_PASSWORD` Basic). First run: `POST /api/auth/setup` creates the admin, allowed from loopback, with `APP_PASSWORD`, or with a one-time setup token printed to the console at boot (Docker: `docker logs`). Once an admin exists, `APP_PASSWORD` is ignored with a warning.
- Permissions: see the role × prefix table and preference keys in ADR-0012 (default-deny, display prefs per user, editors may sync integrations, alert channels admin-only).
- The last enabled admin can't be disabled, demoted or deleted; disabling a user ends their sessions; login rate limit (5 failures → 15 min, in memory); hashes never leave the server (zod `userSchema` without the hash).

### [x] Step 1 - ADR-0012 users, sessions and roles  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** `docs/adr/0012-users-and-roles.md` (supersedes the "no login" part of ADR-0001): the design above, the role × prefix table, the exact preference keys editors may change, first-run setup, `APP_PASSWORD` migration, what a viewer sees, rejected options (custom roles, JWT, OAuth/SSO).
**Done when:** the ADR is approved; the role table is complete for every route prefix.
**Prompt:**
```
Do Step 1 of the 4.2.0 plan in PLAN.md. Show me the role × route prefix table first.
```

### [x] Step 2 - Users, sessions and actor: schema  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Drizzle migration for `users`, `sessions`, `user_settings`, `logs.actor`. `lib/password.ts` (scrypt + `timingSafeEqual`), `lib/session.ts` (create, read, expire, cookie parse/set). Zod schemas in core (`userSchema`, `loginSchema`, `setupSchema`, role enum). Expired sessions pruned by the existing hourly job.
**Done when:** the schema is approved; migration applies on a copy of the real DB; unit tests for hashing and sessions; tests pass.
**Prompt:**
```
Do Step 2 of the 4.2.0 plan in PLAN.md. Show me the schema first. Back up the DB before
editing schema.ts.
```

### [x] Step 3 - Auth and permission hooks, users API
**Model:** Opus · **Effort:** High
**Scope:** `/api/auth/{setup,login,logout,me}`, `/api/users` CRUD (admin), own name and password via `PATCH /api/auth/me` (ADR-0012). The `onRequest` hook (auth from cookie; public: `/api/auth/setup`, `/api/auth/login`, `/api/health`, static assets) then `can(role, url, method)`. Setup token at boot (console only, never in the logs table). `APP_PASSWORD` handling per the ADR. Login rate limit. `req.log` child with `actor`, saved by `logSink`.
**Done when:** a role-matrix test covers every prefix × role × read/write; the last admin is protected; rate limit tested; no hash in any response; tests pass.
**Prompt:**
```
Do Step 3 of the 4.2.0 plan in PLAN.md.
```

### [x] Step 4 - Web: login, current user, Users page
**Model:** Sonnet · **Effort:** High
**Scope:** `/login` page (and first-run "Create admin" page); `api.ts` 401 → `/login?next=`; `useMe()`, `useCan()`; user menu in the shell (name, change password, sign out); Settings → Users (list, add, role, disable, reset password); a 403 shows a message.
**Done when:** login, logout, setup and user management work by keyboard and on mobile; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 4 of the 4.2.0 plan in PLAN.md.
```

### [x] Step 5 - Role-aware UI and actor in logs
**Model:** Sonnet · **Effort:** Medium
**Scope:** Hide New / Edit / Delete / Sync / Import actions a role can't use, across every module (`useCan`); admin-only menu items (Settings sections, Logs, Integrations) hidden for others; actor column and filter on the Logs page.
**Done when:** a viewer and an editor see only what they can do (e2e per role); the actor shows on log rows; tests pass.
**Prompt:**
```
Do Step 5 of the 4.2.0 plan in PLAN.md.
```

### [x] Step 6 - Docs, push & v4.2.0-alpha.1
**Model:** Haiku · **Effort:** Low
**Scope:** `docs/users.md` (setup, roles, LAN/Docker, `APP_PASSWORD` migration, reset a lost admin password), README, `docs/configuration.md`, CHANGELOG, version `4.2.0-alpha.1`. Commit, push `dev`, tag `v4.2.0-alpha.1` on `dev`; check the run and the pre-release.
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 6 of the 4.2.0 plan in PLAN.md. Only document what changed since 4.1.0. Then push
dev, push the tag and confirm the pre-release is published.
```

## Phase 7 - Roles: settings, alerts, integrations

Design (refines ADR-0012):
- Settings: Appearance keeps the per-user theme and accent; a new admin-only **Branding** section holds the global app name, logo and favicon. Server (incl. header restart/stop, uptime, start at login), Backup, Logs and About & updates are admin-only: hidden for others and their queries never run.
- Alerts: every user gets every alert. Read/unread, snooze and dismiss are per user (`alert_states`: alert, user, readAt, snoozedUntil, dismissedAt); no-users mode keeps today's columns. Channel sending (`notifiedAt`) and resolving stay global. Viewers may `PATCH /api/alerts/:id`; call-to-action buttons (sync, review) are for editors with the matching permission, and admins.
- Integrations: two flags per integration × type on `sync_policies`, default off: `editorSync` ("Allow editor to sync") and `editorReview` ("Allow editor to review and import"). An editor sees the Integrations page with only the tasks a flag allows (Sync now / Review), never config, credentials or policies. The server checks the flag per route; everything else under `/api/integrations` and `/api/import` stays admin-only.

### [x] Step 7 - Fixes: role banner on every page, project prints table
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Bug: "Your role doesn't allow that" shows on every page for editors and viewers. The banner fires on any 403, including background GETs for admin-only prefixes. Fire `FORBIDDEN_EVENT` only for writes (non-GET) in `api.ts`; give admin-only queries (server config, updates, backups, logs, alert channels, users) `enabled: canAdmin` so they never run for editors and viewers.
- Project page prints table: reuse the Prints page table (same columns minus Project, same filters, same page size and pagination), filtered server-side by the project.

**Done when:** an editor and a viewer browse every page with no banner and no 403 in the network tab; a blocked write still shows it; the project prints table matches the Prints page and pages through a project with many prints; e2e; tests pass.
**Prompt:**
```
Do Step 7 of the 4.2.0 plan in PLAN.md. List every query that 403s for a viewer first.
```

### [x] Step 8 - Admin-only settings and global Branding
**Model:** Sonnet · **Effort:** Medium
**Scope:** Settings: move app name, logo and favicon out of Appearance into an admin-only **Branding** section with a hint that it applies to everyone; Server, Backup, Logs, About & updates and the header server actions hidden for non-admins (`useCan("admin")`). Server already rejects these writes; add the missing cases to the role-matrix test. Stop/restart: drop the inline "server stopped" hint that wraps the header buttons; show a shell banner instead, like the update-available one, saying the server is stopped or restarting. Re-run `pnpm screenshots` if the settings screenshot changes.
**Done when:** a viewer and an editor see only General (display keys), Appearance (theme, accent) and Account; an admin sees Branding separately; stopping the server keeps the header buttons in place and shows the banner; e2e per role; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 8 of the 4.2.0 plan in PLAN.md.
```

### [x] Step 9 - Alerts per user  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Migration `alert_states` (alert id, user id, readAt, snoozedUntil, dismissedAt; cascade on both). `GET /api/alerts` (list, history, detail, unread count) merges the caller's state; `PATCH /api/alerts/:id` writes the caller's row; no-users mode keeps the `alerts` columns. Snooze re-arm and channel sending stay global. Auth table: viewer may `PATCH /api/alerts/:id` (read, unread, snooze, dismiss), nothing else under `/alerts`. UI: viewers get those actions; CTAs follow Step 10's rules (until then: admin and editor). Update ADR-0012, All alerts for all users that need user actions, (mantenance, import and review for integrations, and spool missing fields (price and open date)), should be marked as read and resolved when one admin or editor resolve them (exemple: mantenance task on printer x is executed and log done by editor, the corresponding alert of viewer and admin should leave "needs atencion" section and be marked as read and resolved).
**Done when:** the schema is approved; migration applies on a copy of the real DB; marking read as one user leaves it unread for the others (test); a viewer can read/snooze/dismiss but not trigger a CTA; tests pass.
**Prompt:**
```
Do Step 9 of the 4.2.0 plan in PLAN.md. Show me the schema and the merge rules first. Back up
the DB before editing schema.ts.
```

### [x] Step 10 - Editor sync and review permissions  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Migration: `editorSync`, `editorReview` booleans on `sync_policies` (default false). Admin toggles them in `PolicyRow` per task. Server: editor `POST /api/integrations/:id/sync` only for types with `editorSync` (a sync of "all" runs only the allowed types); `POST /api/import/integration/:id/:type` and the matching apply only with `editorReview`; checked in one helper next to `can()`. `GET /api/integrations` for an editor returns only what the task rows need (no config). Web: Integrations nav and page visible to an editor with at least one flag, showing only Sync now / Review per allowed task; alert CTAs (`SyncTargetLink`, sync/review buttons) shown only when the role and flag allow. Update ADR-0012 (table row and the editor flags).
**Done when:** the design is approved; the role-matrix test covers both flags on and off per type; an editor can sync/review only allowed tasks from the page and from an alert, and never sees config; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 10 of the 4.2.0 plan in PLAN.md. Show me the permission checks and the editor's
Integrations page first. Back up the DB before editing schema.ts.
```

### [x] Step 11 - Docs, push & v4.2.0-alpha.2
**Model:** Haiku · **Effort:** Low
**Scope:** `docs/users.md` (what each role sees in Settings, per-user alerts, editor integration permissions), CHANGELOG, version `4.2.0-alpha.2` (root and `packages/*`). Commit, push `dev`, tag `v4.2.0-alpha.2` on `dev`; check the run and the pre-release.
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 11 of the 4.2.0 plan in PLAN.md. Only document what changed since 4.2.0-alpha.1. Then
push dev, push the tag and confirm the pre-release is published.
```

## Phase 8 - Managed slicer

Design (Bambu Studio and OrcaSlicer, the user picks): the user installs the slicer CLI from the app; it is downloaded from the vendor's GitHub releases (we don't redistribute, AGPL respected, licence + source link shown), unpacked into `<dataDir>/slicers/<adapter>/<version>/`, version tracked, updates checked daily. Core gets a types-only `managedSlicer` descriptor (repo, asset matcher per OS/arch, exe path, unpack type, licence); the bambu and orca adapters fill it in; download/unpack live in `apps/server/src/integrations/managedSlicer.ts`, so core never imports vendor code.

### [x] Step 12 - Managed slicer spike and ADR-0013  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** For Bambu Studio and OrcaSlicer, per OS (Windows, macOS, Linux, Docker): which release asset to use (Windows installer-only? zip?), how to unpack without new dependencies (zip via yauzl, dmg via `hdiutil`, AppImage `--appimage-extract`), whether the CLI slices headless (Docker: which libraries, xvfb?), where system profiles live in the download, Orca's `-24` on newer Bambu files and the missing `*_full` profiles. Write `docs/adr/0013-managed-slicer.md` (updates ADR-0007 option B1).
**Done when:** each point has evidence; the ADR is approved; unsupported combinations are listed.
**Prompt:**
```
Do Step 12 of the 4.2.0 plan in PLAN.md. Report each slicer × OS with evidence first.
```

### [x] Step 13 - Managed slicer install  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** A third integration kind `server`: **Bambu Studio (server)** and **OrcaSlicer (server)**, added with Add integration, one card each. `managedSlicer` descriptors; release list (generalise `fetchReleases` from `updates.ts` to any repo); install job with progress (download, digest check, unpack, smoke test, set `slicerPath`/`slicerConfigDir`), previous version kept until the new one passes; `<dataDir>/slicers/<integrationId>/config/system` points at the download's profiles, so Bambu (server) imports with the usual sync options; Orca (server) has no readable profiles (`.opc`) and its card explains the zip import; Orca's CLI arguments and error reading (local Orca slices too); migration `slicerVersion` on `integrations` (no `slicerManaged`: the kind says it); card: Install (version, pre-releases, licence + source), installed version, Update, Remove.
**Done when:** the flow is approved; install, update and remove work on Windows and macOS (tests with fake releases + one manual run); tests pass.
**Prompt:**
```
Do Step 13 of the 4.2.0 plan in PLAN.md. Show me the install job states and the UI first.
Back up the DB before editing schema.ts.
```

### [x] Step 13b - Slicer per project and plate  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Pick the slicer integration that slices: per plate, else per project (project edit page → print setup), else the default slicer from Integrations (local, server or cloud-linked). Stored on projects and plates (migration), used by the slice queue and part of the slice cache key; the plate and project pickers list only slice-capable integrations; a removed or switched-off choice falls back to the default.
**Done when:** the flow is approved; plate → project → default resolves in the queue and the UI; tests pass.
**Prompt:**
```
Do Step 13b of the 4.2.0 plan in PLAN.md. Show me the pickers and the fallback rules first.
Back up the DB before editing schema.ts.
```

### [x] Step 14 - Managed profiles, versions and update alerts
**Model:** Opus · **Effort:** High
**Scope:** With no desktop slicer, the managed config folder `<dataDir>/slicers/<integrationId>/config/` (its `system/` already points at the download's profiles, Step 13); user preset zips unpack there and persist (today `slicer-zips` is cleared after a day); the slicer version stored with each slice result and part of the freshness check (version change → outdated → auto slice); daily check raises a `slicer_update` alert with a CTA to the integration card. Presets across slicers (from Step 13b): a plate's print / filament / machine profiles are one slicer library's presets (`<library>:<preset>`), so picking a slicer of another library (Bambu Studio ↔ OrcaSlicer) fails with `no_preset`; the plate and project slicer pickers say which slicers fit the plate's profiles (or warn on the plate before slicing).
**Done when:** slicing works with only a managed slicer and imported presets; a version change marks slices outdated; the alert appears; switching a plate to another library's slicer is flagged before slicing; tests pass.
**Prompt:**
```
Do Step 14 of the 4.2.0 plan in PLAN.md.
```

### [x] Step 15 - Docker slicer image, docs, push & v4.2.0-alpha.3
**Model:** Sonnet · **Effort:** Medium
**Scope:** A `:X.Y.Z-slicer` (and `:dev-slicer`) image with the libraries the CLI needs (per Step 12); the base image stays small. `docs/slicing.md` (managed slicer, profiles, Docker), update the NAS table. CHANGELOG, version `4.2.0-alpha.3`. Commit, push `dev`, tag `v4.2.0-alpha.3` on `dev`; check the run, pre-release and both images.
**Done when:** the slicer image slices a project in `docker compose up`; tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 15 of the 4.2.0 plan in PLAN.md. Only document what changed since 4.2.0-alpha.2.
Then push dev, push the tag and confirm the pre-release and images are published.
```

### [x] Step 16 - Real test: NAS, LAN accounts, managed slicer
**Model:** Sonnet · **Effort:** Medium
**Scope:** Docker on a NAS with a CIFS-mounted project root (polling, offline/online); first-run admin via the setup token; an editor and a viewer on other devices over LAN (an editor with and without each integration permission; per-user alert state); managed slicer install + slice on Windows, macOS and the Docker slicer image. Fix anything found and note it in the CHANGELOG (alpha.4 if needed).
**Done when:** every scenario worked; fixes released.
**Prompt:**
```
Do Step 16 of the 4.2.0 plan in PLAN.md. Guide me through each scenario, then fix what we find.
```

### [x] Step 17 - Docs, push & v4.2.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** `pnpm screenshots` (login, users, integrations slicer), README, CHANGELOG, version `4.2.0`. Commit on `dev`, fast-forward `main` to `dev`, push both, tag `v4.2.0` on `main`. Check the run, the release and the images.
**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest; images published; updating 4.1.0 (git and installer) to 4.2.0 works.
**Prompt:**
```
Do Step 17 of the 4.2.0 plan in PLAN.md. Only document what changed since the last 4.2.0
pre-release. Then fast-forward main to dev, push, push the v4.2.0 tag and confirm the release.
```

---

# Plan 5.0.0 - Hub

Major release, agreed on 2026-10-26. Starts after the 4.2.0 release. Connector steps add tests that run a real connector against a test hub.

Design: ADR-0014. A **hub** is the normal server with hub features switched on. Each workstation, NAS or file server runs a small **connector**. Every project root has a **location**:
- `hub`: files live on the hub, and devices sync them.
- a device: files live on that device, and the hub indexes them and pulls a file when it needs it.

People work in the web app only. Slicing happens on the hub, or on a designated slice worker when the hub can't slice.

## Phase 9 - Foundations

Design:
- Hub switch: Settings → Server, admin-only, off by default, needs users (ADR-0012). With it off, nothing changes.
- `roots` table (id, name, location `hub` | device id, path). Projects reference `rootId` + relative path. All root file access on the hub goes through one per-root seam.
- `devices` (id, name, user, OS, connector version, last seen, sha256 of the token, sync mode, sync folder, slice worker) and `pairing_codes` (sha256, user, expiry, used).
- Channel: the connector connects out. REST for requests and files, one SSE stream `GET /api/hub/events` for hub → device commands, and a heartbeat. No new dependency.

### [x] Step 1 - Hub spikes and ADR-0014  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** The five spikes listed in `docs/adr/0014-hub-and-connector.md`:
- slicer save patterns and what `fs.watch` reports, on each OS
- whether the launched slicer process lives until its window closes
- SSE through Caddy, nginx, Traefik and Docker
- the connector bundle size with Node, and how much of ADR-0011 it reuses
- SignPath Foundation eligibility and the unsigned connector warnings

Record the evidence in the ADR, adjust the decisions it changes, and set the status to Accepted.
**Done when:** every spike has evidence; the ADR is approved; the lock-release strategy for each OS is fixed.
**Prompt:**
```
Do Step 1 of the 5.0.0 plan in PLAN.md. Report each spike with evidence before changing the ADR.
```

### [x] Step 2 - Hub switch and root locations: schema  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Migration: `roots` table filled from `projectRoots` (location `hub`). Projects get `rootId` + relative path, and the old absolute paths are converted. `hub.enabled` setting.
- The per-root file access seam on the server (local only for now). The scanner, watcher, trash, create folder and slicer use it.
- Settings → Server: the hub switch, with a short explanation of what it adds and a hint when no users exist.
- The roots picker and API move to `roots`. i18n `settings:hub.*`.

No visible change with the switch off.
**Done when:** existing installs migrate with no lost project links (test with a copy of a real DB); the switch shows and saves; tests pass.
**Prompt:**
```
Do Step 2 of the 5.0.0 plan in PLAN.md. Show me the migration and the seam's interface first.
Back up the DB before editing schema.ts.
```

### [x] Step 3 - Hub management and device pairing
**Model:** Opus · **Effort:** Medium
**Scope:**
- A Hub management nav section next to Integrations, admin-only, visible when the hub is on.
- Device list: name, user, OS, connector version, online or last seen.
- Only admins pair devices: an admin creates a pairing code for a user (valid 10 minutes, one-time, shown once). `POST /api/hub/pair` exchanges it for a device token (only its sha256 is stored). Rename, revoke (ends access at once).
- Device auth in `lib/auth.ts` next to sessions, with routes in the role × prefix table (ADR-0012).

**Done when:** pair, rename and revoke work through the API and the UI; a revoked token gets 401; tests pass.
**Prompt:**
```
Do Step 3 of the 5.0.0 plan in PLAN.md.
Back up the DB before editing schema.ts.
```

### [x] Step 4 - Connector skeleton and installers  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- `apps/connector` (TypeScript, imports only `core` and `3mf`).
- A status page on `127.0.0.1`: hub URL, pairing code, online state, open the sync folder. It uses i18n from its own `locales/en`.
- The SSE stream plus heartbeat, with reconnects from a cursor.
- Installers from the ADR-0011 pipeline (Inno Setup, `.dmg`, `tar.gz`), start at login, and self-update to the hub's version with rollback.
- Release workflow: connector assets and `SHA256SUMS`, plus GitHub artifact attestations for every asset.
- `apps/connector` joins the version-sync rule (root, `packages/*`, `apps/connector`) in CLAUDE.md and the bump script.

**Done when:** a connector installed on Windows, macOS and Linux pairs with a hub and shows online in Hub management; it updates to a newer test release; the workflow builds all installers; tests pass.
**Prompt:**
```
Do Step 4 of the 5.0.0 plan in PLAN.md. Show me the connector's folder layout and the event protocol first.
```

### [x] Step 5 - Docs, push & v5.0.0-alpha.1
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/hub.md`: what the hub is, the switch, pairing, the connector install and its unsigned warnings, and a page for company IT (checksums, attestations, install paths).
- CHANGELOG, version `5.0.0-alpha.1`.
- Commit, push `dev`, tag `v5.0.0-alpha.1` on `dev`. Check the run, the pre-release and the images.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 5 of the 5.0.0 plan in PLAN.md. Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 10 - Device roots

Design:
- A root can live on a device. The connector watches it, reads 3MF metadata locally with `packages/3mf`, and sends the index and metadata to the hub.
- The hub pulls a file only for slicing, download or the 3D view. Pulled files go to a temp cache with a size cap and an expiry.
- Writes from the web app (create folder, trash) run on the owning connector.
- Offline device: last known data plus an "offline" badge.
- Other users can only download.

### [x] Step 6 - Device roots: index and metadata  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Add root gets a location picker: hub, or an online device. The folder browser goes through the connector.
- The connector watches the root, waits for stable files, sends changes and 3MF metadata, and resends after reconnecting.
- The hub stores them like a scan (same tables and the same project page).
- An offline badge on roots and projects.

**Done when:** a device root's projects appear, update after a save in the slicer, and show offline when the connector stops; tests pass.
**Prompt:**
```
Do Step 6 of the 5.0.0 plan in PLAN.md. Show me the index messages and the offline rules first.
```

### [x] Step 7 - Pull on demand, slice on the hub, remote writes
**Model:** Opus · **Effort:** High
**Scope:**
- Hub → device "upload `<path>`" over SSE. The connector streams the file to the hub, which checks the hash.
- Temp cache (size cap, expiry, cleanup job). The slice queue, download and 3D view use it, and auto slice works for device roots.
- Create project folder and trash run on the connector, inside its root.
- Path checks on both sides (no `..`, no absolute paths, no symlinks out of the root).

**Done when:** a device-root file is sliced on the hub, downloaded and shown in 3D; create folder and trash work remotely; path-escape tests fail as expected; tests pass.
**Prompt:**
```
Do Step 7 of the 5.0.0 plan in PLAN.md.
```

### [x] Step 7b - Device thumbnails in the scan
**Model:** Opus · **Effort:** Medium
**Scope:**
- The connector sends each 3MF's plate thumbnails with the folder scan (only when the folder's digest changed), with a size cap per image and per folder, like the cover.
- The hub stores them under `<dataDir>/thumbnails` and serves plate previews (`/file?entry=`) from there for device roots, so a project page never pulls a whole 3MF just for its previews.
- A chosen cover from a device folder comes the same way (today it keeps the stored thumbnail).
- Offline device: the stored previews still show.

**Done when:** a device project's page shows its plate previews without any `fs.upload`; a save updates them; offline they still show; tests pass.
**Prompt:**
```
Do Step 7b of the 5.0.0 plan in PLAN.md.
```

### [x] Step 7c - Gallery on device projects
**Model:** Opus · **Effort:** Medium
**Scope:**
- Today a device project can't save gallery picks (PATCH returns 403), and `/files/image` reads only hub folders.
- Picked gallery images come with the folder scan, like the picked cover: the device's roots list carries each folder's picks, a new pick marks the folder stale and asks the device to sync, and the hub stores them under `<dataDir>/thumbnails` and serves `/files/image` from there (offline too).
- The picker's other images are pulled on demand (`fs.upload`, images only, online device only); offline, the picker shows only what is stored.
- Picked images count against the folder's size cap (Step 7d); over the cap, the picks that don't fit are left out and the page says so.

**Done when:** gallery picks on a device project save, show, survive a save on the device, and still show offline; tests pass.
**Prompt:**
```
Do Step 7c of the 5.0.0 plan in PLAN.md.
```

### [x] Step 7d - Device folder size setting
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- A preference `deviceFolderMaxMb` (default 32) in Settings → Projects, with a hint: how much one device folder's scan may send (docs, cover, plate previews, gallery picks).
- The hub's `PUT /api/hub/device/roots/:id/folders` enforces it per request (the route's static `bodyLimit` becomes the upper bound of the setting), answering 413 over it.
- The connector reads it from `GET /api/hub/device/roots` (like `maxFiles`) and fills the folder in order: scan and docs, cover, gallery picks, then plate previews until the budget is used. The fixed `DEVICE_PREVIEWS_MAX` goes; the per-image caps stay.
- A changed value makes the devices resync (`roots.changed`), so folders that were cut off are sent again.

**Done when:** the setting shows in Settings → Projects, a lower value leaves out previews over it, a folder over the hub's limit gets 413, and a change resends; `pnpm i18n:check` and tests pass.
**Prompt:**
```
Do Step 7d of the 5.0.0 plan in PLAN.md.
```

### [x] Step 8 - Project owner and visibility  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Projects get an owner (migration: the admin for existing ones; the creator, or the device's user for device roots).
- Per-user permissions: see all projects or only their own; edit or only download other people's projects in hub roots.
- Device roots are always download-only for everyone but the owner.
- API, project list, search and the 3D view respect it.

**Done when:** the flow is approved; each combination is covered by tests; the UI hides what a user can't do; tests pass.
**Prompt:**
```
Do Step 8 of the 5.0.0 plan in PLAN.md. Show me the permission table first.
Back up the DB before editing schema.ts.
```

### [x] Step 8b - Connector updates: outdated alert, update now, restart and stop
**Model:** Opus · **Effort:** Medium
**Scope:**
- The connector reports a failed update to the hub: the download failed, or the launcher rolled back the new version.
- Hub management marks a device whose connector version isn't the hub's ("Outdated", or "Update failed" with the reason). An alert (hub module, admins) is raised when a device stays outdated or its update fails, and clears once it matches.
- **Update now** per device (admin): a new `connector.update` event. The connector retries the download at once, including a version that rolled back before. Offline device: the button is disabled.
- Connector status page: **Restart** and **Stop** buttons (POST, same Host and Origin checks as Pair). Restart exits with the launcher's restart code; Stop ends the connector until it is started again from the start menu or launcher, or at the next login. Stop asks for confirmation, since the device goes offline for the hub.

**Done when:**
- An outdated connector shows in Hub management and raises the alert.
- Update now updates it, tested against a local build with `APP_DOWNLOAD_URL`.
- Restart and Stop work from the status page.
- Tests pass.

**Prompt:**
```
Do Step 8b of the 5.0.0 plan in PLAN.md.
```

### [x] Step 8c - Project permissions: leaks and owner change
**Model:** Opus · **Effort:** Medium
**Scope:**
- Prints, orders, quotes, stats and tags don't show the name or link of a project the user can't see (`visibleProjects`, `projectAccess`). The rows stay; the project shows as hidden ("Other project"), and stats still count it.
- The project trash lists only files from roots the user may edit (`mayEditRoot`). Restoring or emptying the trash checks the same rule on the server.
- Change owner on the project page: admins only, from a list of users. Not offered for projects in device roots, because the device's user owns those. Uses the existing project update route.

**Done when:** a user who sees only their own projects finds no other project's name in prints, orders, quotes, stats, tags or the trash (covered by tests); an admin can change a project's owner in the UI; tests pass.
**Prompt:**
```
Do Step 8c of the 5.0.0 plan in PLAN.md.
```

### [x] Step 9 - Docs, push & v5.0.0-alpha.2
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/hub.md`: device roots, what offline means, plate previews and gallery on device projects, the device folder size setting, permissions, connector updates (outdated alert, Update now) and the status page's Restart and Stop.
- CHANGELOG, version `5.0.0-alpha.2`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 9 of the 5.0.0 plan in PLAN.md. Only document what changed since 5.0.0-alpha.1.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 11 - Hub roots: sync

Design:
- `hub_files` (root, path, size, sha256, version, deleted, lock) plus a change sequence number. Connectors pull "changes since cursor" and upload with their base version.
- Base version current → new version. Otherwise → conflict copy `<name> (conflict <device> <date>).<ext>` plus an alert.
- A local delete moves the file to the root's trash on the hub. Mass delete guard.
- Sync mode per device: everything, or selected projects, plus **Open on my workstation**.
- Clocks are never compared across machines.

### [x] Step 10 - Hub file index and transfer API  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Migration `hub_files`. The index is kept current by the existing scanner and watcher, so files edited on the hub itself count too.
- `GET changes?since=`, download, upload: stream to temp, check sha256 and base version, rename into place, or keep a conflict copy.
- Delete → trash. A conflict alert with a CTA to the project.

**Done when:** the flow is approved; concurrent uploads of the same base give exactly one version and one conflict copy (test); tests pass.
**Prompt:**
```
Do Step 10 of the 5.0.0 plan in PLAN.md. Show me the change feed and the upload rules first.
Back up the DB before editing schema.ts.
```

### [x] Step 11 - Connector sync engine  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- One folder per root under the device's sync folder.
- First sync, then pull changes and push local changes after the stability check.
- Downloads to a temp file plus rename. Read-only files for projects the user may only download.
- State in a JSON file: per file, the last synced version and hash.
- Mass delete guard (threshold in Hub management): it pauses, asks on the status page, and raises an alert.
- Sync state on the status page and in Hub management.

**Done when:** two connectors and the hub stay in sync through edits, renames, deletes and a conflict; a mass delete pauses; a killed connector resumes without re-downloading everything; tests pass.
**Prompt:**
```
Do Step 11 of the 5.0.0 plan in PLAN.md. Show me the sync loop and its state file first.
```

### [x] Step 12 - Selected projects and Open on my workstation
**Model:** Opus · **Effort:** Medium
**Scope:**
- Device sync mode: everything or selected projects (Hub management and the status page). Removing an unselected project's local copy is not a delete.
- An **Open on my workstation** button on the project page and file rows, when the user has an online device. The hub sends "open". The connector syncs the project if it isn't there yet, then opens the file in its detected slicer, through the adapter's slicer launcher as the server does today.

**Done when:** with selected projects, Open downloads the project and opens the slicer; the save syncs back and auto slice runs on the hub; tests pass.
**Prompt:**
```
Do Step 12 of the 5.0.0 plan in PLAN.md.
```

### [x] Step 12b - Connector folders: only shared folders are browsable  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Today the hub's folder browser (`fs.list`) can list the device's whole filesystem. The connector status page gets a **Folders** section: add (typed path, checked to exist) and remove the local folders the hub may use. Stored as real paths in `state.json` (`folders`). A folder inside another one is refused (already covered).
- Upgrade: a connector with no `folders` yet seeds them from its current device roots on the first roots fetch, so nothing breaks.
- `fs.list` is confined: no path → the folders as starting points (instead of drives, `/` and home); any other path must resolve (`realpath`) inside a folder (reuse `below()` from `packages/host/src/rootPath.ts`), else EACCES → hub 403 `path_denied`. `POST /api/roots` checks through `fs.list`, so a root outside the folders is refused.
- A device root outside the folders isn't watched or served: the connector reports it, and the hub shows a "Not shared on the device" badge (like offline: last known data, projects never marked missing).
- Removing a folder is refused while a hub root inside it has projects (`GET /api/hub/device/roots` gains a `projects` count; with no roots list fetched yet, removal waits for the hub). The hub already refuses removing a root with projects (409 `root_in_use`).
- Windows paths compare case-insensitively. The sync folder (hub roots) is not affected.
- i18n `connector:folders.*`, `projects:roots.*`.

**Done when:** the hub can't list or add anything outside the device's folders (path-escape and symlink tests); an upgraded connector keeps its roots; a folder holding a used root can't be removed; tests pass.
**Prompt:**
```
Do Step 12b of the 5.0.0 plan in PLAN.md. Show me the folder rules and the upgrade seeding first.
```

### [x] Step 13 - Docs, push & v5.0.0-alpha.3
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/hub.md`: hub roots, sync modes, conflicts, trash, the mass delete guard, connector folders.
- CHANGELOG, version `5.0.0-alpha.3`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 13 of the 5.0.0 plan in PLAN.md. Only document what changed since 5.0.0-alpha.2.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 12 - Locks and versions

Design:
- Locks: off · on · strict (Hub management). Opening through the connector, or the first local change, takes a lock, and other devices set the file read-only.
- Release: the slicer process exits (where Step 1 found this observable), Done editing, an idle timeout, or an admin force-unlock.
- Strict: an offline device can't lock, so it's read-only.
- Versions: on/off and keep N. The previous content goes to `<dataDir>/versions/<rootId>/<fileId>/<version>`, outside the root.

### [x] Step 14 - Check-out locks  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Lock fields on `hub_files`, with lock and unlock routes.
- The connector takes a lock on Open and on the first change, sets the file read-only on other devices, and releases it as Step 1 decided.
- A Done editing button in the web app and on the status page; idle timeout (setting); admin force-unlock.
- Strict mode for offline devices.
- "Being edited by `<user>` on `<device>`" on the project page.

**Done when:** the flow is approved; a second device can't save a locked file; release works through each path; strict mode makes an offline device read-only; tests pass.
**Prompt:**
```
Do Step 14 of the 5.0.0 plan in PLAN.md. Show me the lock states and release paths per OS first.
Back up the DB before editing schema.ts.
```

### [x] Step 14b - One Open button: this machine's slicer  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- The project page and the file rows get **one** Open button instead of "Open in slicer" and "Open on my workstation". It opens the slicer on the machine the user is sitting at:
  1. **The server's own machine** (a loopback socket and a loopback Host, as the login page's "on this PC" test in `routes/auth.ts`): `target: "slicer"`, the slicer from Settings → Integrations, as today.
  2. **A machine with a connector:** the page probes the local connector (`http://127.0.0.1:<port>`, the port from the connector's launcher entry). The connector answers a new `GET /api/whoami` with its device id only, with CORS limited to the hub's own origin (it knows its hub URL) and checked against the Host header as today. If the id is one of the user's online devices with a slicer, `target: "device"` for that device.
  3. **Probe failed** (no connector, blocked by the browser, Safari or a Local Network prompt): fall back to the user's online devices with a slicer. One device is used without asking; several keep today's device dropdown.
  4. No slicer anywhere: the button is hidden, as now.
- ADR-0014 gets an amendment (the only readable endpoint of the connector's page, why it is safe: id only, hub origin only, no state-changing route; the probe is a hint, the hub still checks that the device belongs to the user). `docs/hub.md` and the i18n keys follow (`projects:detail.open*`).
- Opening on the server's machine takes no hub lock (it edits the hub root in place); the project page shows the lock holder as now, and the docs say locks are soft.
- Device-root projects are unchanged: no Open button, view and download only.
- Probe result cached for the page session; a failed probe never blocks the page or shows an error.
- give connector option to not select default slicer. if a connector does not have a a default slicer, ask user what is the slicer that should open.

**Done when:** on the server's machine the button launches the integration slicer; on a workstation with a connector it launches that device's slicer without a dropdown, even with two devices paired; with the connector stopped or the probe blocked it falls back to the online device(s); another origin can't read `/api/whoami`; tests pass.
**Prompt:**
```
Do Step 14b of the 5.0.0 plan in PLAN.md. Show me the three-way decision and the connector endpoint first.
```

### [x] Step 15 - File versions
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Settings on/off and keep N (Hub management). On an accepted upload, the previous content moves to the versions folder. Prune past N, and when N is lowered.
- A file history on the project page (version, user, device, date, size) with Download.
- Disk use in Hub management. Backups list whether they include versions.

**Done when:** N uploads keep N versions; older ones download intact; lowering N prunes; tests pass.
**Prompt:**
```
Do Step 15 of the 5.0.0 plan in PLAN.md.
```

### [x] Step 16 - Docs, push & v5.0.0-alpha.4
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/hub.md`: locks and their limits (soft locks), versions and disk use.
- CHANGELOG, version `5.0.0-alpha.4`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 16 of the 5.0.0 plan in PLAN.md. Only document what changed since 5.0.0-alpha.3.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 13 - Slice workers

Design:
- An admin marks a device as a slice worker and picks its slicer (ADR-0014): one **installed** on the device (detected, or a typed path), or a **managed** one (ADR-0013) that the connector downloads into its own data folder, with no admin rights.
- For a managed slicer the hub fixes the version. Either way it pushes its managed config folder (presets), and slicing never touches the user's own slicer settings.
- The worker is one more slice-capable integration in the plate → project → default pickers (4.2.0 Step 13b).
- Jobs go out over SSE. The worker pulls the file (or uses its local copy if the hash matches), slices, and uploads the result.

### [x] Step 17 - Slicer on a device: installed or managed  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- The connector reports its installed slicers (ADR-0014): Windows `Uninstall` registry keys (path from `DisplayIcon`), macOS `/Applications/*.app` `Info.plist`, Linux `flatpak list --app` (run through `flatpak run`); AppImages and anything else are a typed path checked with `--help`. Shown per device in Hub management with name, path and version.
- Move the `managedSlicer` download, digest check, unpack and smoke test from `apps/server` into a shared package. The server and the connector both use it.
- A "slice worker" switch per device in Hub management. A **worker** integration ("Bambu Studio (worker)") picks a worker device and, on its card, its slicer: an installed one (found, or a typed path checked with `--help`), or a managed one.
- Managed: install, update and remove on the worker, driven from the hub, with progress shown on the worker integration's card.
- Presets stay on the hub (the worker integration's zip import, system and user). Step 18's job carries the 3MF, plus the flattened presets only when one is picked, so nothing is synced to the worker. Work files stay in the connector's data folder under the home folder (a Flatpak slicer can't read `/tmp`).

**Done when:** the flow is approved; a Windows worker uses its installed Bambu Studio and a macOS worker installs the hub's managed slicer version, both with the hub's presets; detection finds the installed slicers on Windows, macOS and a Linux Flatpak; the server's own managed slicer still works; tests pass.
**Prompt:**
```
Do Step 17 of the 5.0.0 plan in PLAN.md. Show me the detection results, the shared package's API and the install states first.
```

### [x] Step 18 - Slice jobs on workers
**Model:** Opus · **Effort:** High
**Scope:**
- Workers appear as slice-capable integrations ("Bambu Studio (WS-3)").
- The slice queue sends jobs to the picked worker: the file is pulled or reused by hash, the result uploaded, the same cache key including the slicer version.
- Job timeout. When the worker is offline, the job waits and shows why, with an option to fall back to the hub's slicer.
- The connector status page shows when the device is a slice worker.
- Make the "indexes a device root" test in `apps/connector/src/hub.test.ts` reliable under a full parallel run (it timed out once in Step 17).

**Done when:** an arm64 Docker hub with no slicer slices through a worker; results match a hub slice of the same file and version; tests pass.
**Prompt:**
```
Do Step 18 of the 5.0.0 plan in PLAN.md.
```

### [x] Step 19 - Docs, push & v5.0.0-alpha.5
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/slicing.md` and `docs/hub.md`: slice workers, when to use them, matching presets.
- CHANGELOG, version `5.0.0-alpha.5`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 19 of the 5.0.0 plan in PLAN.md. Only document what changed since 5.0.0-alpha.4.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 14 - Release

### [x] Step 20 - Real test: VPS, NAS and three workstations
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- A hub on a VPS behind Caddy (HTTPS), plus a hub on a NAS (Docker).
- Connectors on Windows, macOS and Linux, plus one on a NAS used as a device root.
- Pairing and revoking; hub root sync in both modes; Open on my workstation; a conflict; the mass delete guard; locks (on and strict) with a device going offline; versions.
- A device root offline and back; a root outside the connector's folders is refused; removing a folder in use is refused.
- A slice worker for an arm64 hub; antivirus and SmartScreen behaviour on Windows.

Fix anything found and note it in the CHANGELOG (alpha.6 if needed).
**Done when:** every scenario worked; fixes released.
**Prompt:**
```
Do Step 20 of the 5.0.0 plan in PLAN.md. Guide me through each scenario, then fix what we find.
```

### [x] Step 21 - Docs, push & v5.0.0 release
**Model:** Haiku · **Effort:** Low
**Scope:**
- `pnpm screenshots` (Hub management, the project page with the lock and Open button, file history), README (hub section), CHANGELOG, version `5.0.0`.
- Commit on `dev`, fast-forward `main` to `dev`, push both, tag `v5.0.0` on `main`. Check the run, the release, the images and the connector installers.

**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest; images and connector installers are published; updating 4.2.0 (git and installer) to 5.0.0 works, with the hub off.
**Prompt:**
```
Do Step 21 of the 5.0.0 plan in PLAN.md. Only document what changed since the last 5.0.0 pre-release.
Then fast-forward main to dev, push, push the v5.0.0 tag and confirm the release.
```

## Out of scope for 5.0.0 (later plans)
- Printing from the web app: both root locations can give the hub the sliced file.
- A WebDAV drive served by the hub, for browsing without syncing.
- Restoring a version in place.
- Several users on one shared workstation.
- The network storage module (SMB and cloud mounts on the hub).

---

# Plan 5.1.0 - Roles, permissions, alerts & shared presets

Minor release, starts after the 5.0.0 release. Design: ADR-0016, which supersedes ADR-0012's fixed roles, and ADR-0017 for shared slicer presets.

## Phase 15 - Fixes & settings

### [ ] Step 1 - Accent selector shows the picked color
**Model:** Sonnet · **Effort:** Low
**Scope:** The Appearance accent Combobox reads `useTheme()` (like `ThemeToggle`), not the preferences query that `setTheme` never updates. Check every other reader of `prefs.accent`.
**Done when:** picking an accent updates the selector at once and after a reload; e2e; tests pass.
**Prompt:**
```
Do Step 1 of the 5.1.0 plan in PLAN.md.
```

### [ ] Step 2 - Settings → Projects, organized
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Split the one `Section` in `ConfigPages.tsx` into cards: **Project folders** (roots list and add form, moved to its own file), **Scanning & limits** (scan max files, viewer and upload size), **Hub devices** (device folder size, only with the hub on), **Trash**.
- Same fields and behaviour; clearer labels and hints; mobile and keyboard checked. Use `frontend-design`.

**Done when:** every field still saves; the layout is reviewed on mobile and desktop; screenshots are updated if one shows this page; `pnpm i18n:check` and tests pass.
**Prompt:**
```
Do Step 2 of the 5.1.0 plan in PLAN.md. Use frontend-design. Show me the card layout first.
```

## Phase 16 - Roles and permissions

Design:
- `roles` table (id, name, built-in, disabled, permissions, project rights, alert kinds). Seeded **Admin** (all permissions; can't be edited, disabled or deleted), **Editor** and **Viewer** with exactly today's rights. `users.role` → `roleId`.
- A fixed **permission catalog**, mapped from today's role × prefix table: per module none · read · write (printers, maintenance, filament, projects, prints, costs: quotes, orders and clients; stats), plus integrations sync, integrations review, integrations manage, hub manage, settings (server, backup, logs, branding, alerts), users & roles manage. Project rights: see all, edit others', edit other devices.
- **Per-user overrides:** every permission and project right is tri-state (same as role · allow · deny), edited only by users with users & roles manage. Users can't change their own permissions. Effective rights are read per request, so no session reset is needed.
- No escalation: a manager can't grant what they don't have, can't change their own role or rights, and can't touch the Admin role or its users.
- A disabled role: its users can't sign in and their sessions end. A role with users can't be deleted (409 `role_in_use`). The last enabled Admin user stays protected.
- `roots.editBy = roles` means "users with projects write". The per-policy editor flags stay as an extra gate for non-admins with the sync or review permission. Device tokens act with their user's rights. No-users mode is unchanged.

### [ ] Step 3 - ADR-0016 roles, permissions and alert delivery  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** `docs/adr/0016-roles-permissions-alerts.md`: the designs of Phases 16 and 17, the permission catalog mapped from every prefix in `lib/auth.ts`, the alert kind catalog with each kind's permission, the migration, the escalation rules, rejected options. ADR-0012 marked partly superseded.
**Done when:** the ADR is approved; every route prefix and alert kind maps to a permission.
**Prompt:**
```
Do Step 3 of the 5.1.0 plan in PLAN.md. Show me the permission catalog mapped from today's table first.
```

### [ ] Step 4 - Roles and permissions: schema and server  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Migration: `roles` seeded, `users.roleId`, user overrides (null = same as role), project rights moved to role defaults plus user overrides.
- `can()`, `mayTask`, `mayEditRoot` and `projectAccess` use effective rights. `/api/roles` CRUD; `/api/users` takes overrides; `/api/auth/me` returns effective permissions.
- Escalation and last-admin rules on the server.

**Done when:** the role-matrix test proves the seeded roles behave exactly as before; overrides and escalation rules are covered; the migration applies on a copy of the real DB; tests pass.
**Prompt:**
```
Do Step 4 of the 5.1.0 plan in PLAN.md. Show me the schema and the migration first.
Back up the DB before editing schema.ts.
```

### [ ] Step 5 - Users and roles pages
**Model:** Opus · **Effort:** Medium
**Scope:**
- Settings → Users becomes a table: name (link to the edit page), email, role, state; row actions reset password, disable, delete.
- User edit page: name, email, role, disabled, permission overrides (same as role · allow · deny) and project rights, each showing its effective value.
- Settings → Roles: a table (name → edit page, users count, disable, delete) and a role edit page (permissions, project rights; default alerts once Phase 17 lands). New role.
- `useCan(permission)` replaces `useCan("write" | "admin")` across the app. Use `frontend-design` for the tables and edit pages.

**Done when:** a custom role and a user override change what that user sees (e2e); keyboard and mobile work; `pnpm i18n:check` and tests pass.
**Prompt:**
```
Do Step 5 of the 5.1.0 plan in PLAN.md. Use frontend-design.
```

### [ ] Step 6 - Docs, push & v5.1.0-alpha.1
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/users.md`: roles, permissions, overrides, the upgrade from fixed roles.
- CHANGELOG, version `5.1.0-alpha.1`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 6 of the 5.1.0 plan in PLAN.md. Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 17 - Alerts per role and user

Design:
- Alerts are still raised once per condition, and resolving stays shared: an alert that needs action (spool review, maintenance due, missing price…) resolves for everyone when its condition clears. Info alerts are read and dismissed per user.
- Which kinds a user gets: the role's default kinds, overridden per kind by the user (in app · notify). A user never gets a kind whose permission they lack, nor an alert about a project they can't see.
- The global on/off switches (`spoolNoPriceAlert`, `spoolNoOpenDateAlert`) move into the role defaults, migrated as they are. Thresholds (`lowSpoolGrams`, maintenance lead) stay global, because alert rows are shared. The per-spool, per-maintenance-type and per-policy switches stay.
- Delivery per user: the mail server and the ntfy server stay global (admin). Each user turns on email (to their account email) and/or sets their own ntfy topic and token (encrypted, never returned). Sent once per user (`alert_states.notifiedAt`); a user's snooze holds delivery; disabled users get nothing.
- No-users mode: the Admin role's kinds and today's global destinations apply.

### [ ] Step 7 - Who gets which alert  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- The kind catalog with a permission per kind (ADR-0016). Role default kinds and user overrides, migrated from the global switches.
- `GET /api/alerts`, history, detail and the unread badge filter by subscription, permission and project visibility.
- Settings → Alerts keeps the thresholds and the servers, and warns when no enabled user gets an action kind (e.g. maintenance due).
- Tests per kind: shared resolve for action kinds, per-user dismiss for info kinds.

**Done when:** a viewer without filament access gets no spool alerts; a hidden project's alert never shows; resolving an alert clears it for everyone; tests pass.
**Prompt:**
```
Do Step 7 of the 5.1.0 plan in PLAN.md. Show me the kind catalog and the filter rules first.
Back up the DB before editing schema.ts.
```

### [ ] Step 8 - Delivery per user: email and ntfy  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Global mail and ntfy servers (admin). Per user: email on/off, ntfy topic and token, a test button.
- Sending per user and kind with `alert_states.notifiedAt`, re-armed after a snooze. Secrets never logged or returned.
- Migration: today's email recipient and ntfy topic become the oldest enabled admin's delivery, so nothing stops.

**Done when:** two users with different kinds receive only their own; a failed send retries without duplicates; the migration keeps today's notifications; tests pass.
**Prompt:**
```
Do Step 8 of the 5.1.0 plan in PLAN.md. Show me the send loop and the migration first.
Back up the DB before editing schema.ts.
```

### [ ] Step 9 - My alerts on the user page
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- A **My account** page from the user menu: name, password, my alerts (in app · notify per kind I can get, with "same as role" to reset), my delivery. No permissions here.
- The admin's user edit page and the role page show the same alert list for that user or role.

**Done when:** a user changes their own alerts and delivery, and an admin changes another user's; e2e; `pnpm i18n:check` and tests pass.
**Prompt:**
```
Do Step 9 of the 5.1.0 plan in PLAN.md.
```

### [ ] Step 10 - Docs, push & v5.1.0-alpha.2
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/alerts.md` (who gets what, delivery per user, thresholds) and `docs/users.md`.
- CHANGELOG, version `5.1.0-alpha.2`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 10 of the 5.1.0 plan in PLAN.md. Only document what changed since 5.1.0-alpha.1.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 18 - Shared slicer presets

The hub keeps one slicer preset library that the hub slicer, slice workers and workstations' desktop slicers all use. Today user presets reach the hub only through the slicer zip, which replaces `config/user` wholesale.

Design (confirmed in Step 11):
- **Why:** a saved 3MF already holds its resolved settings, so slicing "as saved" needs no presets. Presets matter when the app overrides the print, filament or printer (Print setup, filament prices and densities from `slicerPresetLibrary.read`) and for the same results on every worker.
- **Hub only.** A single-PC install already slices with its desktop slicer folder.
- **Library:** per slicer library (`bambu:`, `orca:`) and kind (machine, process, filament), with a version, sha256, and who saved it, from which device and when. Recommended: a hidden system root of kind `presets` (`<library>/<kind>/<name>.json`) reusing the hub file sync: versions, base-version uploads, change cursor, conflict copies, alerts, trash. Fallback: a small `slicer_presets` table. The managed slicer's `config/user/<x>` becomes a junction to the library, like `config/system`. The slicer zip merges into the library instead of replacing it. Workers get the library through Step 17 of 5.0.0.
- **Two opt-in switches per device:** *Share my presets* (desktop → hub) and *Install hub presets* (hub → desktop).
- **Conflicts:** same content (sha) is never a conflict and is never re-sent. A stale base with other content becomes `<name> (conflict <device>)`, with the `name` inside the json renamed too, plus a Sync conflict alert.
- **Bambu Cloud and OrcaCloud rules** (the desktop folder is `user/<account id>/` when signed in, `user/default/` when signed out; each preset has a `.json` and, for Bambu, a `.info`):
  - New preset: `.info` with an empty `setting_id`, `sync_info = create`, the folder's `user_id`. Studio then uploads it.
  - Changed preset: keep `setting_id`, set `sync_info = update`, bump `updated_time`. Otherwise the older cloud copy wins at login.
  - Write only while that slicer is closed (it reads presets at startup only; reuse the slicer-exit detection from check-out locks). Queue until then.
  - Deletes never reach desktops, because the cloud brings them back. A hub delete removes the preset from the hub and workers and tells the user to delete it in the slicer. A desktop delete only shows "removed on <device>".
  - The connector remembers the sha of every file it wrote (echo suppression), so a preset that also arrives through Bambu Cloud on the same account doesn't loop.
  - Back up the desktop user folder to a zip before the first write. Reject invalid json (e.g. `"nil"` values) with an alert.
  - A preset whose `inherits` parent this slicer lacks is skipped on that device, with an alert.

### [ ] Step 11 - Preset spike and ADR-0017  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- On real installs (Bambu Studio signed in and signed out; Orca 2.4 signed out and on OrcaCloud), confirm the `.info` rules, startup-only reading, delete resurrection and the same-account echo.
- Decide the storage: hidden hub root or `slicer_presets` table. Decide who may share and delete presets (a 5.1 permission) and the preset alert kinds (Phase 17 catalog).
- `docs/adr/0017-shared-slicer-presets.md`: design, findings, rejected options (writing into desktop folders without `.info` handling; reading Bambu Cloud's undocumented preset API).

**Done when:** the ADR is approved; every rule above is confirmed or corrected from a real install.
**Prompt:**
```
Do Step 11 of the 5.1.0 plan in PLAN.md. Guide me through each test install, then show me the storage choice first.
```

### [ ] Step 12 - Hub preset library
**Model:** Opus · **Effort:** High
**Scope:**
- Storage per ADR-0017, zod schemas in `packages/core/src/schemas`, API, and a **Slicer presets** page in Hub management: per library and kind, versions, who saved, conflicts, download, delete.
- Slicer zip import merges into the library. The managed slicer's `config/user` points at the library; workers get it.
- Preset changes mark affected slices outdated (the cache key already holds the preset sha).

**Done when:** a zip import from two PCs keeps both sets; a hub delete disappears from a worker; e2e; `pnpm i18n:check` and tests pass.
**Prompt:**
```
Do Step 12 of the 5.1.0 plan in PLAN.md. Use frontend-design for the page.
Back up the DB before editing schema.ts.
```

### [ ] Step 13 - Share my presets (desktop → hub)
**Model:** Opus · **Effort:** High
**Scope:**
- Device switch *Share my presets* in Hub management. The connector watches its slicers' user preset folders (the account the slicer last used) and uploads changes with their base version.
- json validation, conflict copies with the inner name renamed, Sync conflict alert. A desktop delete only shows "removed on <device>".

**Done when:** a preset saved in Bambu Studio on one workstation shows on the hub within a minute; two edits of the same preset give a conflict copy and an alert; tests pass.
**Prompt:**
```
Do Step 13 of the 5.1.0 plan in PLAN.md.
```

### [ ] Step 14 - Install hub presets (hub → desktop)  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Device switch *Install hub presets*. Writes queue until the slicer is closed. `.info` rules for Bambu; backup zip before the first write; echo suppression; no delete propagation; skip and alert on a missing `inherits` parent.
- The device page shows the target folder, the queue and the last backup.

**Done when:** a hub preset appears in a closed Bambu Studio after its next start, signed in and signed out; it survives a Bambu Cloud sync; two workstations on the same account don't loop; tests for the `.info` writer and echo suppression pass.
**Prompt:**
```
Do Step 14 of the 5.1.0 plan in PLAN.md. Show me the .info writer and the write queue first.
```

### [ ] Step 15 - Docs, push & v5.1.0-alpha.3
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/slicing.md` and `docs/hub.md`: how presets flow, the two switches, the Bambu Cloud and OrcaCloud caveats, and a tip for farms (one Bambu account, or cloud sync off on farm PCs).
- CHANGELOG, version `5.1.0-alpha.3`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 15 of the 5.1.0 plan in PLAN.md. Only document what changed since 5.1.0-alpha.2.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 19 - Release

### [ ] Step 16 - Real test: roles, alerts, delivery and presets
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- Upgrade a copy of a real 5.0.0 DB.
- A custom role; a user override; a user manager who isn't an admin (escalation refused); a disabled role.
- Each alert kind reaching the right users in the app, by email and by ntfy; no-users mode.
- Presets with three workstations, two of them on the same Bambu account: share, install, conflict, delete, a worker slicing with a shared preset.

Fix anything found and note it in the CHANGELOG (alpha.4 if needed).
**Done when:** every scenario worked; fixes released.
**Prompt:**
```
Do Step 16 of the 5.1.0 plan in PLAN.md. Guide me through each scenario, then fix what we find.
```

### [ ] Step 17 - Docs, push & v5.1.0 release
**Model:** Haiku · **Effort:** Low
**Scope:**
- `pnpm screenshots` (Users, Roles, My account, Slicer presets), README, CHANGELOG, version `5.1.0`.
- Commit on `dev`, fast-forward `main` to `dev`, push both, tag `v5.1.0` on `main`. Check the run, the release and the images.

**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; updating 5.0.0 to 5.1.0 keeps every user's rights and alerts.
**Prompt:**
```
Do Step 17 of the 5.1.0 plan in PLAN.md. Only document what changed since the last 5.1.0 pre-release.
Then fast-forward main to dev, push, push the v5.1.0 tag and confirm the release.
```

## Out of scope for 5.1.0 (later plans)
- Per-user thresholds: alert rows are shared.
- Other delivery channels (push, webhooks) and per-user mail servers.
- Quiet hours and digests.
- Reading presets straight from Bambu Cloud (undocumented API); editing preset values on the hub; a downloadable preset bundle for devices without a connector.

---

# Plan 6.0.0 - Every printer

Major release, agreed on 2026-10-27. Starts after the 5.1.0 release. Adapter steps add tests against recorded payloads (fixtures), never a live printer in CI.

Design: ADR-0015. Prints are recorded automatically from the most used printer systems, the dashboard shows live status, and spool usage follows:
- a new `PrinterStatusSource` capability and one **job tracker** in core turn status snapshots into prints;
- grams come from the printer, the job file's header, the project plate's slice, or the review queue;
- the spool comes from the printer, the **loaded spool per slot**, or the review queue;
- a hub reaches LAN printers through the connector (ADR-0014).

Wave 1: Moonraker, Bambu LAN, PrusaLink, OctoPrint, plus Spoolman two-way.

## Phase 20 - Foundations

Design:
- Snapshot: state, job file, progress, ETA, layer, temperatures, slots (material, colour, RFID or spool id). In memory only, pushed over SSE.
- New alert kinds join the kind catalog (5.1.0, ADR-0016) with their permission.
- The job tracker emits an `ExternalPrint`; the existing upsert, dedupe and review do the rest. History sources backfill.
- Review policy `never` · `unmatched` · `always`: global → integration → printer, most specific wins.
- No printer control.

### [ ] Step 1 - Printer spikes and ADR-0015  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** The five spikes listed in `docs/adr/0015-multi-brand-print-tracking.md`:
- real payloads from Moonraker, PrusaLink, Bambu LAN (and what needs Developer mode) and OctoPrint, saved as fixtures
- slicer totals in job file headers (OrcaSlicer, PrusaSlicer, Bambu Studio)
- the dedupe tolerance between Bambu Cloud and Bambu LAN
- discovery (mDNS, SSDP): in 6.0.0 or later
- a connector relaying a LAN printer to a VPS hub

Record the evidence in the ADR, adjust the decisions it changes, and set the status to Accepted.
**Done when:** every spike has evidence and fixtures are committed; the ADR is approved.
**Prompt:**
```
Do Step 1 of the 6.0.0 plan in PLAN.md. Report each spike with evidence before changing the ADR.
```

### [ ] Step 2 - Printer status capability and job tracker  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- `PrinterStatusSource` in `packages/core/src/integrations`, the snapshot zod schema, a `printerStatus` capability, `docs/architecture.md`.
- The job tracker in core: pure, state in and prints out. Covers a print first seen half-way (recorded and flagged for review), a restart during a print, cancel and failure.
- Matching sources of one printer by serial, and deduping prints by start time within the Step 1 tolerance.
- The mock adapter gets a status source for dev and e2e.

**Done when:** the tracker turns every fixture sequence into the expected prints; tests pass.
**Prompt:**
```
Do Step 2 of the 6.0.0 plan in PLAN.md. Show me the snapshot schema and the tracker's states first.
```

### [ ] Step 3 - Live status on the dashboard
**Model:** Opus · **Effort:** Medium
**Scope:**
- Server: a runner per enabled status source (poll faster while printing, slower when idle), the in-memory store, the tracker wired to the existing print import.
- `GET /api/printers/status/events` (SSE, permissions per ADR-0012) and a snapshot endpoint.
- Web: a printer card on the dashboard and printer page: state, progress, ETA, temperatures, slots, offline. i18n `printers:status.*`, keyboard and screen reader friendly, both themes.

**Done when:** the mock printer's prints show live and land as prints when they end; e2e spec passes.
**Prompt:**
```
Do Step 3 of the 6.0.0 plan in PLAN.md. Use frontend-design for the printer card.
```

### [ ] Step 4 - Grams from the job file and the project plate
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- When the printer doesn't report grams: read the slicer totals from the job file's header (G-code or 3MF, the formats from Step 1), else use the slice result of the project plate the print matched, else leave the slot for review.
- The print shows where its grams came from.

**Done when:** each fallback has a test with a real header; tests pass.
**Prompt:**
```
Do Step 4 of the 6.0.0 plan in PLAN.md.
```

### [ ] Step 5 - Loaded spool per printer slot  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Migration: the spool loaded in each printer slot (or toolhead).
- Printer page: set, change and clear the loaded spool per slot; the spool page shows where it is loaded.
- New prints charge the loaded spool when the printer can't say which spool it used. RFID and Spoolman come first.

**Done when:** a print on a printer with a loaded spool charges it without review; tests and e2e pass.
**Prompt:**
```
Do Step 5 of the 6.0.0 plan in PLAN.md. Back up the DB before editing schema.ts.
```

### [ ] Step 6 - Review policy  **[plan mode]**
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `never` · `unmatched` · `always`: a global setting, an override per integration and per printer (migration).
- `always` sends every new print to the review queue even when the spool matched; `never` leaves unmatched slots unassigned and raises no review alert.
- Settings UI in Integrations (global and per integration) and on the printer page. i18n.

**Done when:** each level overrides the one above it in tests; e2e passes.
**Prompt:**
```
Do Step 6 of the 6.0.0 plan in PLAN.md. Back up the DB before editing schema.ts.
```

### [ ] Step 7 - Docs, push & v6.0.0-alpha.1
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- `docs/printers.md`: live status, how prints are recorded, grams and spools, the review policy.
- CHANGELOG, version `6.0.0-alpha.1`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 7 of the 6.0.0 plan in PLAN.md. Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 21 - Adapters

Each adapter: a `local` package in `packages/adapters/<id>`, config and secrets schemas, status (and history where it exists), the recorded fixtures as tests, i18n names, a setup page in the docs. Added by host or IP.

### [ ] Step 8 - Moonraker
**Model:** Opus · **Effort:** Medium
**Scope:** Status; history backfill (`server/history`); grams from Moonraker's metadata; the Spoolman active spool when Moonraker has one; API key optional.
**Done when:** fixtures from Step 1 import as the expected prints; tests pass.
**Prompt:**
```
Do Step 8 of the 6.0.0 plan in PLAN.md.
```

### [x] Step 9 - Bambu LAN
**Model:** Opus · **Effort:** High
**Scope:** MQTT over TLS with the access code (new dependency `mqtt`, see ADR-0015); status from the push reports; AMS RFID → spool; matched by serial with a Bambu Cloud integration of the same printer, which then only gives history. Setup docs say what to switch on (LAN mode, Developer mode).
**Done when:** a cloud + LAN printer records each print once; tests pass.
**Prompt:**
```
Do Step 9 of the 6.0.0 plan in PLAN.md.
```

### [ ] Step 10 - PrusaLink
**Model:** Sonnet · **Effort:** Medium
**Scope:** Status and job over the local API (digest auth); grams from the job file's header.
**Done when:** fixtures import as the expected prints; tests pass.
**Prompt:**
```
Do Step 10 of the 6.0.0 plan in PLAN.md.
```

### [ ] Step 11 - OctoPrint
**Model:** Sonnet · **Effort:** Medium
**Scope:** Status and job (API key); grams from the job file's header or OctoPrint's analysis.
**Done when:** fixtures import as the expected prints; tests pass.
**Prompt:**
```
Do Step 11 of the 6.0.0 plan in PLAN.md.
```

### [ ] Step 12 - Spoolman two-way  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- A Spoolman integration: import spools (the usual review and merge), read the active spool, write usage back after each print.
- Each write carries an idempotency key (print id + slot); retries and re-imports never charge twice. A print that came from Moonraker's own Spoolman link isn't written back.

**Done when:** a print charges the Spoolman spool exactly once across retries and restarts; tests pass.
**Prompt:**
```
Do Step 12 of the 6.0.0 plan in PLAN.md. Show me how double charging is prevented first.
```

### [ ] Step 13 - Docs, push & v6.0.0-alpha.2
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- A setup page per adapter and Spoolman; the README support matrix (printer, what it provides).
- CHANGELOG, version `6.0.0-alpha.2`.
- Commit, push `dev`, tag on `dev`. Check the run and the pre-release.

**Done when:** tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 13 of the 6.0.0 plan in PLAN.md. Only document what changed since 6.0.0-alpha.1.
Then push dev, push the tag and confirm the pre-release is published.
```

## Phase 22 - Hub

### [ ] Step 14 - Connector printer bridge  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- A new fixed connector operation: relay status and history for the printer hosts the hub assigns to that device. It never sends commands to a printer.
- Hub management: assign a printer integration to a device; the status runner reads it through the connector.
- Offline device: the printer shows offline; history backfills when it's back.

**Done when:** a VPS hub shows live status and records prints of a LAN printer through a connector; tests run a real connector against a test hub.
**Prompt:**
```
Do Step 14 of the 6.0.0 plan in PLAN.md.
```

## Phase 23 - Release

### [ ] Step 15 - Real test: one printer per adapter
**Model:** Sonnet · **Effort:** Medium
**Scope:**
- A Klipper printer, a Bambu printer (LAN, and LAN + cloud), a Prusa printer, an OctoPrint printer, Spoolman.
- A full print, a cancelled and a failed print, the app restarted during a print, each review policy, loaded spools, a hub with a connector bridge.

Fix anything found and note it in the CHANGELOG (alpha.3 if needed).
**Done when:** every scenario worked; fixes released.
**Prompt:**
```
Do Step 15 of the 6.0.0 plan in PLAN.md. Guide me through each scenario, then fix what we find.
```

### [ ] Step 16 - Docs, push & v6.0.0 release
**Model:** Haiku · **Effort:** Low
**Scope:**
- `pnpm screenshots` (dashboard with live printer cards, printer page with loaded spools), README, CHANGELOG, version `6.0.0`.
- Commit on `dev`, fast-forward `main` to `dev`, push both, tag `v6.0.0` on `main`. Check the run, the release and the images.

**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest; updating 5.x to 6.0.0 works.
**Prompt:**
```
Do Step 16 of the 6.0.0 plan in PLAN.md. Only document what changed since the last 6.0.0 pre-release.
Then fast-forward main to dev, push, push the v6.0.0 tag and confirm the release.
```

## Out of scope for 6.0.0 (later plans)
- Wave 2 adapters: Creality stock websocket, Elegoo SDCP (6.x).
- Anycubic, FlashForge, Duet, a Home Assistant bridge.
- Printer control (pause, stop, start) and printing from the web app.
- Camera snapshots and timelapses.
- Capturing slicer uploads for printers with no network.
- Telemetry history.

---

## Backlog mapping
| Backlog item | Plan · Step |
|---|---|
| mobile: project page overflows right, bottom menu not pinned | 4.1 · 1 |
| footer: year, version + channel, AZSeashell, GitHub | 4.1 · 2 |
| success alerts: call to action is the module | 4.1 · 3 |
| documentation: project folder structure, several roots | 4.1 · 4 |
| db connection: external DB servers | 4.1 · 4 (dropped, ADR-0010) |
| project folder: add a folder to a project that has none | 4.1 · 5 |
| integrations page: clearer design, same functionality | 4.1 · 6, 7 |
| launcher, auto run, complete installer | 4.1 · 9-15 |
| tailwind canonical classes, autostart 404 in dev log | 4.1.1 · 1 |
| settings server: restart/stop on top, labels, network hint, start at login in General, data dir as text | 4.1.1 · 2 |
| restart: "restarting" modal, redirect to new port | 4.1.1 · 3 |
| browser opens on login autostart; installer start opens no browser; starting loader | 4.1.1 · 4 |
| update available alert: call to action | 4.1.1 · 5 |
| project page: hide empty files / prints / 3D cards | 4.1.1 · 6 |
| mobile branding header | 4.1.1 · 7 |
| delete client | 4.1.1 · 8 |
| alerts list: only the alert's own actions | 4.1.1 · 9 |
| add printer: model and brand in modals | 4.1.1 · 10 |
| integrations: what to sync, how to sync | 4.1.1 · 11 |
| sync scheduler: choose the run time | 4.1.1 · 12 |
| users module: authentication, roles, permissions | 4.2 · 1-5 |
| role banner always shown for editor and viewer | 4.2 · 7 |
| settings: global branding admin-only; server, backup, logs, about admin-only | 4.2 · 8 |
| alerts per user; viewer read/snooze/dismiss, editor call-to-actions | 4.2 · 9 |
| integrations: allow editor to sync / review and import, per task | 4.2 · 10 |
| storage integration: SMB, cloud | Backlog · Ideas / modules (Network storage) |
| bundled slicer for headless servers (download from the app) | 4.2 · 12-15 |
| hub: server installer anywhere, hub features switched on in Settings | 5.0 · 2 |
| hub: Hub management section next to Integrations | 5.0 · 3 |
| hub: small client connector with its own installer | 5.0 · 4 |
| hub: files scattered on workstations, NAS, file server (indexed, sliced on the hub) | 5.0 · 6, 7 |
| hub: others see all projects, edit, download only, or only their own | 5.0 · 8 |
| hub: central file server, a folder on each workstation, delete goes to the server's trash | 5.0 · 10, 11 |
| hub: full local copy or files on demand | 5.0 · 11, 12 (per project, not placeholder files; ADR-0014) |
| hub: prevent editing a file being edited on another client (setting) | 5.0 · 14 |
| hub: version history, download older versions (setting, keep N) | 5.0 · 15 |
| hub: slice on the clients when the server can't | 5.0 · 17, 18 |
| hub: print from the app | later |
| connector: several roots; hub sees and adds only those; no removing a root in use | 5.0 · 12b |
| accent color selector keeps showing teal | 5.1 · 1 |
| projects settings more organized | 5.1 · 2 |
| quote: preselect the project's print setup | already works (dropped) |
| roles section: table, edit page, permissions, project rights, preset alerts | 5.1 · 3-5, 7 |
| users section as a table, user edit page, per-user permissions and project rights over the role | 5.1 · 3-5 |
| alerts move to roles and users, no global switch per kind; shared resolve for action alerts | 5.1 · 7 (thresholds stay global) |
| alerts delivered per user (email, ntfy) | 5.1 · 8 |
| users edit their own alerts | 5.1 · 9 |
| shared slicer presets: workstations → hub → workers and desktops, one source of truth | 5.1 · 11-15 |
| live status: progress, temps, AMS state, auto print-event capture | 6.0 · 2, 3 (camera snapshot later) |
| Spoolman: sync spools two-way | 6.0 · 12 |
| other systems: Klipper/Moonraker, Prusa, OctoPrint, Bambu LAN | 6.0 · 8-11 (Creality stock, Elegoo SDCP in 6.x) |
| automatic prints and spool usage without Bambu Cloud | 6.0 · 2-6, 14 |
