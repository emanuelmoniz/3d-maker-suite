# ADR-0009: Updates through a small launcher, git tags and pre-update backups

- Status: Accepted
- Date: 2026-10-22

## Context
Users install with `git clone` + `pnpm start` (ADR-0001: local, no installer) or with Docker. Updating meant `git pull`, `pnpm install`, `pnpm start`, and remembering to back up first. Friends who don't use git won't do that. The app should say when a release is out and, on a git install, update itself. If an update fails, the app must keep running on the old version, and the user must be able to go back without losing data to a migration (migrations only go forward).

There is no process supervisor. The app runs in a terminal from `pnpm start`, and it can't count on pm2, systemd or a Windows service.

## Decision

### Version and channel
- The version is `version` in the root `package.json`. The server reads it once at start and returns it from `GET /api/health` and `GET /api/updates`. The app shows it in Settings → About & updates and in the sidebar footer.
- Preference `updateChannel`: `stable` (default) or `dev`.
  - **stable**: the newest GitHub release that isn't a pre-release (tags `vX.Y.Z` on `main`).
  - **dev**: the newest release of any kind (tags `vX.Y.Z-alpha.N` on `dev`, plus stable ones).
  - Only a version higher than the running one is offered (semver order, numeric pre-release parts: `alpha.10 > alpha.9`). Switching from dev to stable never offers a downgrade; you stay where you are until stable catches up.

### Checking
- A croner job checks daily at 09:00, and once a minute after start (not at once, so short-lived servers such as tests never call GitHub). Settings has a **Check now** button. A check is one unauthenticated `GET api.github.com/repos/emanuelmoniz/3d-maker-suite/releases?per_page=30`, well under the limit of 60 an hour.
- The release list stays in memory, so changing the channel shows its answer at once. A restart checks again.
- A newer release raises an event alert through `raise()` (ADR-0008):
  - kind `update_available`, module `system`, severity `success` (nothing is wrong), task `update`, entity `release:<tag>`.
  - One alert and one notification (ntfy, email) per version. A check resolves the alerts of other versions; a start resolves those for versions already running.
- A banner shows above every page while the alert is open and not snoozed. It links to Settings, and dismissing it dismisses the alert. Nothing updates on its own: the user clicks **Update**.

### Install type decides what Update does
| Install | Detected by | In Settings |
|---|---|---|
| git | `.git` exists at the repo root and the server was started by the launcher (`APP_LAUNCHER=1`) | Update button |
| docker | `APP_INSTALL=docker`, set in the Dockerfile | `docker compose pull` + `docker compose up -d` |
| other (a zip, or the server started without the launcher) | neither of the above | the git commands to run by hand |
| dev (`pnpm dev`) | `npm_lifecycle_event=dev` | the git commands to run by hand |

### Restart: a built-in launcher instead of a supervisor
- `pnpm start` runs `node scripts/start.mjs`: Node stdlib only, no workspace imports, so it works from whatever version is checked out.
- It builds the web app (as `pnpm start` always did), then runs the server as a direct child, `node --import tsx src/main.ts` in `apps/server`, with the terminal's stdio and `APP_LAUNCHER=1`. Extra arguments (`--port`) pass through.
- The server asks for a restart by exiting with code **75**. The launcher applies a pending update or rollback, if there is one, and starts the server again. Any other exit code ends the launcher with that code. Ctrl+C reaches the server through the terminal; the launcher waits for it to exit.
- Settings → Network's restart uses the same exit 75 under the launcher. Without it, the old detached self-respawn remains. Docker relies on `restart: unless-stopped`.
- The code is swapped by the launcher while no server runs because on Windows a running server locks `better_sqlite3.node` and other files under `node_modules`, so `pnpm install` can't replace them under it.

### Update flow (git install)
1. **Server**, `POST /api/updates/apply { tag }`:
   - The tag must look like `vX.Y.Z[-pre]`, be newer than the running version, and be fetchable from `origin`. No branches, no commits, no downgrades through this endpoint.
   - The working tree must be clean (`git status --porcelain --untracked-files=no`), and only one update runs at a time.
   - `git fetch origin tag <tag> --no-tags`, then a backup with the existing `createBackup()` under the `update-` prefix (automatic retention doesn't touch these).
   - Writes `.update/pending.json` at the repo root (gitignored): `{ action, ref, from (HEAD sha), fromVersion, toVersion, backup }`. Replies 202, then exits with 75.
2. **Launcher** (`scripts/update.mjs`), with the server stopped: `git checkout --detach <ref>`; a Node check (the release's `engines.node` against the running Node); `pnpm install --frozen-lockfile`; `pnpm --filter @3d-maker-suite/web build`. Output goes to the terminal. It writes `.update/result.json` and starts the server.
3. **On failure** at any launcher step it checks out `from` again, reinstalls and rebuilds, records the failed step, and starts the old version. If going back fails too, it doesn't start anything and prints the commands to run by hand.
4. **Server start** appends `result.json` to the history in `<dataDir>/updates.json` (`{ action, at, fromVersion, toVersion, fromSha, backup, ok, failedStep?, needsNode? }`) and deletes the file. Migrations run on start as always.
5. **The app** shows the phase: preparing (backup and download), then installing while the server is away. It polls `/api/health` until the server went down and came back. A new version reloads the page; the same version shows why it went back ("failed while building the app").
6. **History lives outside the database** because a rollback restores an older DB, which would otherwise wipe the record of the update it undoes. It keeps the last 5 entries and deletes the `update-*.zip` backups of older ones.

### Rollback
- Settings lists the history. A successful update whose backup still exists and whose `fromVersion` is older than the running one has **Roll back to `fromVersion`**. The confirmation says that everything changed since that update is lost.
- **Server**: stages the restore with the existing `stageRestore()` (it validates the zip and refuses a newer backup format), writes `pending.json` with `ref` = the `fromSha` that ran before and `restoreDir` = the staged folder, and exits with 75.
- **Launcher**: the same checkout, install and build. On failure it also deletes the staged restore, so the current version never starts on the old database, then goes back.
- **The old version starts**: its own `applyPendingRestore()` swaps in the backup before the DB opens. Old code and old DB match, so no migration runs backwards. Every version since v2 has it.
- Going back to a version without the updater (before 4.0.0-alpha.3) works the same way; from then on that version only offers the manual commands.

### Errors and logs
- Error codes (`dirty`, `busy`, `fetch_failed`, `git_failed`, `not_git`, `not_newer`, `bad_tag`, `invalid_backup`) and failed steps (`checkout`, `node`, `install`, `build`) are i18n keys (ADR-0004).
- Raw `git` and `pnpm` output goes to the terminal only, never to the API.

## Rejected options
- **Swap the code inside the running server.** It breaks on Windows (locked native modules), and the server would load half-new files if it imported anything lazily.
- **Keep the detached self-respawn.** It cuts the process off from its terminal (Ctrl+C no longer stops it, logs vanish), and its tsx loader path inside `node_modules/.pnpm/tsx@x.y.z` breaks when a release bumps tsx.
- **An external supervisor (pm2, systemd, a Windows service).** Another thing to install and set up per OS. Starting at login can be documented on top of `pnpm start` instead.
- **Side-by-side release folders (`releases/<tag>/`) with a switch.** Faster rollback, but it changes the install layout, multiplies `node_modules` per release and breaks `cd 3d-maker-suite && pnpm start`.
- **Download release zips instead of git.** Needs our own extract, verify and swap code; git already does it, with integrity checks.
- **Down migrations for rollback.** Drizzle doesn't generate them; the pre-update backup is simpler and exact.
- **Install updates automatically.** The user decides; a broken release must not spread on its own.
- **Update history in a DB table.** A rollback restores the DB and would erase it.
- **Roll back to the release tag instead of the commit.** The first update may start from a branch commit that has no tag; the sha is exactly what ran.
- **Live progress for each launcher step.** The server is down while they run; the terminal shows them, and the app shows the outcome.

## Consequences
- `pnpm start` is a launcher process plus a server process. Docker and `pnpm dev` don't change.
- An update is away for as long as install and build take, usually under a minute.
- Update and rollback need a clean git tree; edited files get a message, not a forced checkout.
- After the first update the clone is on a detached HEAD at a tag, so plain `git pull` no longer applies. `docs/install.md` → Updating gives the button and `git fetch --tags && git checkout vX.Y.Z`.
- Every update leaves a full backup, photos included: up to 5 of them.
- Killing the launcher process alone (not Ctrl+C, not closing the terminal) leaves the server running on Windows, as with any parent process there.
