# 3D Maker Suite - Development Plans 4.1.0, 4.1.1 and 4.2.0
Repo: `3d-maker-suite`

How to use:
- Run `/clear` before each step, set the model and effort shown, and paste the prompt.
- Steps marked **[plan mode]** start in Plan mode: review the plan, then approve it.
- Each step ends with a commit and a ticked checkbox.
- Each feature step adds its own e2e spec.
- Steps that change `packages/db/src/schema.ts`: back up the DB **before** editing it (`pnpm dev` applies new migrations to the real DB).
- Skills: `webapp-testing` for screenshots or browser checks, `frontend-design` for new visual pieces, `dataviz` for charts.

Versioning (default from now on):
- Stay on 4.x. **One plan = one release.**
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

### [ ] Step 10 - Add printer: model and brand in modals
**Model:** Sonnet · **Effort:** Medium
**Scope:** on Add printer, "Add model" opens a modal instead of leaving the page; inside it, "Add brand" opens a second modal. Saving the brand closes it and selects it in the model modal; saving the model closes it and selects it on the printer form. Keyboard and focus return work.
**Done when:** a printer can be added with a new brand and model without leaving the page; e2e for the chain; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 10 of the 4.1.1 plan in PLAN.md.
```

### [ ] Step 11 - Sync schedule time  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:**
- Frequencies are `15m | 1h | 1d | 1w | 1M` (`core/schemas/enums.ts`). Each gets its own time setting: 15 min → minute offset; hourly → minute; daily → hour:minute; weekly → weekday + hour; monthly → day (1-28) + hour. Unset → today's default.
- Migration: nullable columns on the sync policy; the job builds the croner pattern from them. Back up the DB first.
- UI in the expanded policy row, next to the frequency, only when Auto.

**Done when:** the fields and defaults are approved; a policy runs at the chosen time (unit tests for the pattern per frequency); existing policies keep running as before; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 11 of the 4.1.1 plan in PLAN.md. Show me the columns, defaults and croner patterns first.
```

### [ ] Step 12 - Docs, push & v4.1.1 release
**Model:** Haiku · **Effort:** Low
**Scope:** `pnpm screenshots` (project page, settings), docs touched by Steps 1-11, CHANGELOG, version `4.1.1` (root and `packages/*`). Commit on `dev`, fast-forward `main` to `dev`, push both, create and push tag `v4.1.1` on `main`. Check the run, the release (assets) and the `:latest` image.
**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest with installers; updating 4.1.0 (installer and git) to 4.1.1 works.
**Prompt:**
```
Do Step 12 of the 4.1.1 plan in PLAN.md. Only document what changed since 4.1.0. Then
fast-forward main to dev, push, push the v4.1.1 tag and confirm the release and image.
```

---

# Plan 4.2.0 - Server, NAS & multi-user

## Phase 6 - Users and roles

Design (fixed roles):
- Tables: `users` (username unique case-insensitive, display name, scrypt hash via `node:crypto`, role `admin | editor | viewer`, disabled, created/last login), `sessions` (sha256 of the token, user, expiry), `logs.actor`.
- Session: httpOnly, SameSite=Lax cookie, parsed/set with a few lines in `lib/session.ts` (no new dependency).
- Modes: no users = today's behaviour (loopback/host guard + `APP_PASSWORD` Basic). First run: `POST /api/auth/setup` creates the admin, allowed from loopback, with `APP_PASSWORD`, or with a one-time setup token printed to the console at boot (Docker: `docker logs`). Once an admin exists, `APP_PASSWORD` is ignored with a warning.
- Permissions: one `onRequest` hook replaces `accessGuard`. Viewer: GET/HEAD only. Editor: everything except admin prefixes (users, server-config, updates, backups, integrations, slicer zip, import, logs, branding, API docs, admin preference keys like roots, update channel, logs). Admin: everything. Its own prefix set in `lib/auth.ts` (`moduleOf()` mixes fs/updates/logs under "system").
- The last enabled admin can't be disabled, demoted or deleted; disabling a user ends their sessions; login rate limit (5 failures → 15 min, in memory); hashes never leave the server (zod `userSchema` without the hash).

### [ ] Step 1 - ADR-0012 users, sessions and roles  **[plan mode]**
**Model:** Opus · **Effort:** Medium
**Scope:** `docs/adr/0012-users-and-roles.md` (supersedes the "no login" part of ADR-0001): the design above, the role × prefix table, the exact preference keys editors may change, first-run setup, `APP_PASSWORD` migration, what a viewer sees, rejected options (custom roles, JWT, OAuth/SSO).
**Done when:** the ADR is approved; the role table is complete for every route prefix.
**Prompt:**
```
Do Step 1 of the 4.2.0 plan in PLAN.md. Show me the role × route prefix table first.
```

### [ ] Step 2 - Users, sessions and actor: schema  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** Drizzle migration for `users`, `sessions`, `logs.actor`. `lib/password.ts` (scrypt + `timingSafeEqual`), `lib/session.ts` (create, read, expire, cookie parse/set). Zod schemas in core (`userSchema`, `loginSchema`, `setupSchema`, role enum). Expired sessions pruned by the existing hourly job.
**Done when:** the schema is approved; migration applies on a copy of the real DB; unit tests for hashing and sessions; tests pass.
**Prompt:**
```
Do Step 2 of the 4.2.0 plan in PLAN.md. Show me the schema first. Back up the DB before
editing schema.ts.
```

### [ ] Step 3 - Auth and permission hooks, users API
**Model:** Opus · **Effort:** High
**Scope:** `/api/auth/{setup,login,logout,me}`, `/api/users` CRUD (admin), `PATCH /api/users/me/password`. The `onRequest` hook (auth from cookie; public: `/api/auth/*`, `/api/health`, static assets) then `can(role, url, method)`. Setup token at boot (console only, never in the logs table). `APP_PASSWORD` handling per the ADR. Login rate limit. `req.log` child with `actor`, saved by `logSink`.
**Done when:** a role-matrix test covers every prefix × role × read/write; the last admin is protected; rate limit tested; no hash in any response; tests pass.
**Prompt:**
```
Do Step 3 of the 4.2.0 plan in PLAN.md.
```

### [ ] Step 4 - Web: login, current user, Users page
**Model:** Sonnet · **Effort:** High
**Scope:** `/login` page (and first-run "Create admin" page); `api.ts` 401 → `/login?next=`; `useMe()`, `useCan()`; user menu in the shell (name, change password, sign out); Settings → Users (list, add, role, disable, reset password); a 403 shows a message.
**Done when:** login, logout, setup and user management work by keyboard and on mobile; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 4 of the 4.2.0 plan in PLAN.md.
```

### [ ] Step 5 - Role-aware UI and actor in logs
**Model:** Sonnet · **Effort:** Medium
**Scope:** Hide New / Edit / Delete / Sync / Import actions a role can't use, across every module (`useCan`); admin-only menu items (Settings sections, Logs, Integrations) hidden for others; actor column and filter on the Logs page.
**Done when:** a viewer and an editor see only what they can do (e2e per role); the actor shows on log rows; tests pass.
**Prompt:**
```
Do Step 5 of the 4.2.0 plan in PLAN.md.
```

### [ ] Step 6 - Docs, push & v4.2.0-alpha.1
**Model:** Haiku · **Effort:** Low
**Scope:** `docs/users.md` (setup, roles, LAN/Docker, `APP_PASSWORD` migration, reset a lost admin password), README, `docs/configuration.md`, CHANGELOG, version `4.2.0-alpha.1`. Commit, push `dev`, tag `v4.2.0-alpha.1` on `dev`; check the run and the pre-release.
**Done when:** `dev` and the tag are pushed; the workflow is green; the pre-release exists; docs match the app.
**Prompt:**
```
Do Step 6 of the 4.2.0 plan in PLAN.md. Only document what changed since 4.1.0. Then push
dev, push the tag and confirm the pre-release is published.
```

## Phase 7 - Network storage

Design (mounted paths): any folder the OS can see is a root - a mapped drive or `\\server\share` (SMB), OneDrive / Google Drive / Dropbox desktop folders, an `rclone mount`, a Docker CIFS volume. Slicing, Open in slicer and the file manager keep working because they stay local paths.

### [ ] Step 7 - Network roots: polling, status, watcher  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:**
- Per-root `pollMinutes` (null = watch only) in the root settings shape (`packages/core/src/schemas/preferences.ts`), with defaults for stored roots.
- Root status `online | offline`: stat with a 5 s timeout (SMB can hang). An offline root never marks projects missing; project `folderState` becomes `offline`.
- Bug: a root unreachable at boot (or that drops) never gets its watcher back. Re-attach when it comes back online; a watcher `error` closes it and marks the root offline.
- A croner job (every minute) polls due, online roots by feeding the scanner's `flush()` (`ponytail:` refreshes every folder; mtime check if too slow).
- `GET /api/projects/roots/status`, `POST /api/projects/roots/test {path}` (online, writable, latency).
- `rootOf()` compares case-insensitively for Windows paths (drive letter or `\\`), detected from the path so it works in web too.

**Done when:** the design is approved; polling finds changes on a root without events (test with watch off); offline/online flips are handled; watcher re-attaches; tests; tests pass.
**Prompt:**
```
Do Step 7 of the 4.2.0 plan in PLAN.md. Show me the settings change, the status rules and
the poll job first.
```

### [ ] Step 8 - Network roots: UI and docs
**Model:** Sonnet · **Effort:** Medium
**Scope:** Settings → Projects: per-root "Check for changes every" select, status badge, Test button. Path picker lists `/Volumes`, `/mnt`, `/media`, `/run/media/$USER` when they exist, and a hint for UNC paths (`\\server\share`, mapped drives aren't seen by services). Project page: offline banner. `docs/storage.md`: mounting per OS, cloud desktop clients, `rclone mount`, compose CIFS volume, watch vs poll; update the NAS table in `docs/install.md`.
**Done when:** a share root can be added, tested and polled from the UI; docs cover each OS and Docker; e2e; i18n:check passes; tests pass.
**Prompt:**
```
Do Step 8 of the 4.2.0 plan in PLAN.md.
```

## Phase 8 - Managed slicer

Design (Bambu Studio and OrcaSlicer, the user picks): the user installs the slicer CLI from the app; it is downloaded from the vendor's GitHub releases (we don't redistribute, AGPL respected, licence + source link shown), unpacked into `<dataDir>/slicers/<adapter>/<version>/`, version tracked, updates checked daily. Core gets a types-only `managedSlicer` descriptor (repo, asset matcher per OS/arch, exe path, unpack type, licence); the bambu and orca adapters fill it in; download/unpack live in `apps/server/src/integrations/managedSlicer.ts`, so core never imports vendor code.

### [ ] Step 9 - Managed slicer spike and ADR-0013  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** For Bambu Studio and OrcaSlicer, per OS (Windows, macOS, Linux, Docker): which release asset to use (Windows installer-only? zip?), how to unpack without new dependencies (zip via yauzl, dmg via `hdiutil`, AppImage `--appimage-extract`), whether the CLI slices headless (Docker: which libraries, xvfb?), where system profiles live in the download, Orca's `-24` on newer Bambu files and the missing `*_full` profiles. Write `docs/adr/0013-managed-slicer.md` (updates ADR-0007 option B1).
**Done when:** each point has evidence; the ADR is approved; unsupported combinations are listed.
**Prompt:**
```
Do Step 9 of the 4.2.0 plan in PLAN.md. Report each slicer × OS with evidence first.
```

### [ ] Step 10 - Managed slicer install  **[plan mode]**
**Model:** Opus · **Effort:** High
**Scope:** `managedSlicer` descriptors; release list (generalise `fetchReleases` from `updates.ts` to any repo); install job with progress (download, digest/size check, unpack, smoke test, set `slicerPath`), previous version kept until the new one passes; migration `slicerVersion`, `slicerManaged` on `integrations`; Integrations → Slicer: "Install slicer" (pick slicer + version, licence notice), installed version, Update, Remove.
**Done when:** the flow is approved; install, update and remove work on Windows and macOS (tests with fake releases + one manual run); tests pass.
**Prompt:**
```
Do Step 10 of the 4.2.0 plan in PLAN.md. Show me the install job states and the UI first.
Back up the DB before editing schema.ts.
```

### [ ] Step 11 - Managed profiles, versions and update alerts
**Model:** Opus · **Effort:** High
**Scope:** With no desktop slicer, a managed config folder `<dataDir>/slicers/<adapter>/config/` built from the download's system profiles; user preset zips unpack there and persist (today `slicer-zips` is cleared after a day); the slicer version stored with each slice result and part of the freshness check (version change → outdated → auto slice); daily check raises a `slicer_update` alert with a CTA to the integration card.
**Done when:** slicing works with only a managed slicer and imported presets; a version change marks slices outdated; the alert appears; tests pass.
**Prompt:**
```
Do Step 11 of the 4.2.0 plan in PLAN.md.
```

### [ ] Step 12 - Docker slicer image, docs, push & v4.2.0-alpha.2
**Model:** Sonnet · **Effort:** Medium
**Scope:** A `:X.Y.Z-slicer` (and `:dev-slicer`) image with the libraries the CLI needs (per Step 9); the base image stays small. `docs/slicing.md` (managed slicer, profiles, Docker), update the NAS table. CHANGELOG, version `4.2.0-alpha.2`. Commit, push `dev`, tag `v4.2.0-alpha.2` on `dev`; check the run, pre-release and both images.
**Done when:** the slicer image slices a project in `docker compose up`; tags pushed; workflow green; docs match the app.
**Prompt:**
```
Do Step 12 of the 4.2.0 plan in PLAN.md. Only document what changed since 4.2.0-alpha.1.
Then push dev, push the tag and confirm the pre-release and images are published.
```

### [ ] Step 13 - Real test: NAS, LAN accounts, managed slicer
**Model:** Sonnet · **Effort:** Medium
**Scope:** Docker on a NAS with a CIFS-mounted project root (polling, offline/online); first-run admin via the setup token; an editor and a viewer on other devices over LAN; managed slicer install + slice on Windows, macOS and the Docker slicer image. Fix anything found and note it in the CHANGELOG (alpha.3 if needed).
**Done when:** every scenario worked; fixes released.
**Prompt:**
```
Do Step 13 of the 4.2.0 plan in PLAN.md. Guide me through each scenario, then fix what we find.
```

### [ ] Step 14 - Docs, push & v4.2.0 release
**Model:** Haiku · **Effort:** Low
**Scope:** `pnpm screenshots` (login, users, integrations slicer), README, CHANGELOG, version `4.2.0`. Commit on `dev`, fast-forward `main` to `dev`, push both, tag `v4.2.0` on `main`. Check the run, the release and the images.
**Done when:** `main`, `dev` and the tag are pushed; the workflow is green; the release is the latest; images published; updating 4.1.0 (git and installer) to 4.2.0 works.
**Prompt:**
```
Do Step 14 of the 4.2.0 plan in PLAN.md. Only document what changed since the last 4.2.0
pre-release. Then fast-forward main to dev, push, push the v4.2.0 tag and confirm the release.
```

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
| sync scheduler: choose the run time | 4.1.1 · 11 |
| users module: authentication, roles, permissions | 4.2 · 1-5 |
| storage integration: SMB, cloud | 4.2 · 7, 8 |
| bundled slicer for headless servers (download from the app) | 4.2 · 9-12 |
