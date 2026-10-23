# ADR-0011: Installers with their own Node, versions side by side

- Status: Accepted (amends ADR-0009)
- Date: 2026-10-23

## Context
ADR-0009 updates a git install, which needs a clone, pnpm and Node on the PC. Friends who don't use git need an installer: download, double-click, done. The Update button must keep working without git, pnpm or a compiler. The installer spike (4.1.0 Step 9, `packaging/spike/NOTES.md`) tested Inno Setup, an ad-hoc signed macOS `.app`, AppImage and `tar.gz`, a Node without a console window, and two app versions on one data dir. This ADR records what we ship.

## Decision

### Targets
| OS | Installer | Built on | Install dir |
|---|---|---|---|
| Windows x64 | Inno Setup `setup.exe`, per user, no admin | `windows-latest` | `%LOCALAPPDATA%\Programs\3D Maker Suite` |
| macOS arm64, x64 | `.dmg` with an ad-hoc signed `.app` | both on `macos-15` | the `.app` (normally `/Applications`) plus `~/Library/Application Support/3d-maker-suite/install` |
| Linux x64 | `tar.gz` with `install.sh` | `ubuntu-24.04` | `$XDG_DATA_HOME/3d-maker-suite/install` (fallback `~/.local/share/...`) |

The data dir (ADR-0001) doesn't change. Code and data stay apart, so uninstalling never touches data, and Windows' roaming data dir doesn't carry 200 MB of code. Backups list what they include, so `install/` is never backed up.

### Folder layout
```
<install dir>/
  node/           Node (Windows: nodew.exe only)
  launcher.mjs
  versions/
    4.1.0/        package.json, apps/server, apps/web/dist, packages/, node_modules/, links.json
    4.1.1/
  .update/        pending.json, result.json (launcher <-> server, as in ADR-0009)
  logs/launcher.log
  logs/server.log
```
On macOS, `node/`, `launcher.mjs` and the shipped version (`app/`) sit inside `3D Maker Suite.app/Contents/Resources`, signed and never written to. `versions/`, `.update/` and `logs/` live in the writable install dir.

- **The newest version wins.** The launcher runs the highest version in `versions/`, plus on macOS the one inside the `.app`. There's no pointer file: an update adds a folder and a rollback deletes one. Installing an older installer over a newer update therefore can't start old code on a newer database. A folder only gets its final name once it's complete (`4.1.1.partial` → `4.1.1`), so the launcher never picks a half-extracted one.
- **Node is shared** by all versions and only an installer brings a new one. A release whose `engines.node` needs a newer Node is offered as a new installer, not as an update.
- **Each version has its own `node_modules`.** A running version locks only its own folder on Windows (spike §6), so the next one can be unpacked beside it.

### Bundle
`packaging/build.mjs` builds one per OS/arch in CI from the tagged commit:
- `pnpm install --prod --frozen-lockfile --filter "@3d-maker-suite/server..." --config.node-linker=hoisted`. pnpm's default layout has hundreds of absolute junctions and breaks when moved. With `hoisted`, only the workspace packages are links (22 on Windows, 34 on POSIX with `.bin`).
- The links are recorded with relative targets in `links.json`, then removed. Before a version first starts, the launcher recreates them (Windows junctions need no admin). Inno Setup follows links, so it gets a link-free bundle. On macOS the links go back before signing, because nothing may change inside a signed `.app`.
- Workspace packages stay links, not copies. Node's type stripping refuses `.ts` under `node_modules`, and a link resolves to `packages/...`.
- The server runs on Node's type stripping: `node src/main.ts`, no tsx. That starts 0.4 to 1.2 s faster and drops tsx and esbuild (12 MB, and esbuild is a per-platform binary). `erasableSyntaxOnly` in `tsconfig.base.json` keeps the code strippable. tsx stays a dev dependency for `pnpm dev`, `pnpm start` and Docker.
- The bundle drops dev files and tests, plus `*.map`, `*.d.ts` and `*.md` from `node_modules`. It also drops better-sqlite3's sources and its prebuilds for other platforms. Its N-API prebuild doesn't depend on the Node version, so building the macOS x64 bundle on arm64 needs no compiler.
- Node is the latest 22.x (at least 22.18, for type stripping) from nodejs.org, checked against `SHASUMS256.txt`. Windows ships only `nodew.exe`: `node.exe` with the PE subsystem set to GUI so no console opens. The patch breaks Node's signature, so the build removes it. `nodew.exe` runs both the launcher and the server.

### Release assets
`<tag>` is the git tag, e.g. `v4.1.0-alpha.2`.

| Asset | For |
|---|---|
| `3d-maker-suite-<tag>-windows-x64-setup.exe` | Windows installer |
| `3d-maker-suite-<tag>-macos-arm64.dmg` | Apple silicon |
| `3d-maker-suite-<tag>-macos-x64.dmg` | Intel Macs |
| `3d-maker-suite-<tag>-linux-x64.tar.gz` | Linux |
| `3d-maker-suite-<tag>-app-<os>-<arch>.zip` (4, one per target above) | the updater: one version folder, no Node |
| `3d-maker-suite-<tag>.zip` | source, as before |
| `SHA256SUMS` | all of the above, `sha256sum` format |

The updater checks an app zip against `SHA256SUMS` before unpacking it.

### Launcher
- The Start-menu shortcut, the `.app` or the `.desktop` entry runs `node launcher.mjs` (`nodew.exe` on Windows). It uses Node stdlib only.
- It picks the newest version, relinks it and runs `node src/main.ts` in that version's `apps/server`, with `APP_LAUNCHER=1`, `APP_INSTALL=bundle` and `APP_INSTALL_DIR`. With no terminal, the server's output goes to `<install dir>/logs/server.log` (appended, rotated to `server.log.1` past 5 MB) and the launcher's own messages to `launcher.log`, rewritten at each start.
- Exit 75 means restart, as in ADR-0009. It applies `.update/pending.json` first.
- It lives outside `versions/` and changes only with an installer, so it stays small. Anything that changes often belongs in the server.

### Update (bundle install)
Same steps as ADR-0009, but downloading a zip instead of using git:
1. **Server**, `POST /api/updates/apply { tag }`. The tag checks are the same as ADR-0009's. It:
   - downloads `SHA256SUMS` and `...-app-<os>-<arch>.zip` from the release and checks the hash (`fetch_failed`, `bad_checksum`)
   - unpacks it to `versions/<v>.partial` and compares its `engines.node` with the running Node; if Node is too old it deletes the folder and answers `needs_installer` (the app points to the release's installer)
   - backs up (`update-` prefix) and stages that backup as the **undo**, `<dataDir>/update-undo/`
   - writes `.update/pending.json` `{ action, from, fromVersion, toVersion, backup, undo, restoreDir }`, *then* renames `<v>.partial` to `<v>`, replies 202 and exits 75. In that order, the newest folder never runs without its pending.json.
2. **Launcher**, at every start, not only after exit 75, so a power cut halfway resumes: with a `pending.json`, the newest version must be `toVersion` and must answer `/api/health` within 60 s.
   - **OK**: it deletes the undo, `*.partial` and `*.old` leftovers, keeps the two newest folders, and writes `result.json` (ok). The server moves it into the history (`<dataDir>/updates.json`) at start and on `GET /api/updates`, because it arrives after the server is up.
   - **Not OK** (it exits, hangs, or another version is the newest): the launcher kills it, deletes `versions/<toVersion>`, moves the undo to `restore-pending/`, writes `result.json` (`failedStep: "start"`) and starts the old version. That version's `applyPendingRestore()` swaps in the undo before its DB opens, so a half-run migration never reaches it; the touched data stays in `pre-restore/`.
   - `pending.json` goes only once the outcome is written.

### Rollback
- As in ADR-0009, offered while `versions/<fromVersion>` exists (on macOS, also when it's the `.app`'s own version, which the launcher passes as `APP_SHIPPED_VERSION`).
- The server stages an undo from a fresh `undo-` backup (the zip goes once staged), stages the restore (`stageRestore()`), writes `pending.json` with `action: "rollback"` and exits 75. The launcher renames `versions/<running version>` to `<v>.old`, which makes the older version the newest, and starts it with the same 60 s check. That version's `applyPendingRestore()` swaps in the backup before the DB opens.
- OK: `<v>.old` is deleted. Not OK: it's renamed back, the staged restore is dropped and the undo staged, so the newer version starts on the data it had.
- The `.app`'s own version can't be deleted, so on macOS a rollback goes no further back than that.
- `APP_RELEASES_URL` replaces the GitHub releases URL, to try all this against local builds.

### Unsigned builds
Nothing is code-signed: that would take a Windows certificate (a few hundred euros a year) and Apple's $99 a year. The docs walk through each warning:
- **Windows SmartScreen**: "Windows protected your PC" → More info → Run anyway, once per installer.
- **macOS 15**: open once, get blocked, then System Settings → Privacy & Security → Open Anyway. The alternative is `xattr -dr com.apple.quarantine "/Applications/3D Maker Suite.app"`. Ctrl-click → Open no longer gets around it.
- **Linux**: no warning.

`SHA256SUMS` lets users check a download. The app downloads updates itself over HTTPS, and they carry no quarantine flag, so they don't warn again.

### Uninstall
- **Windows**: Apps & features. `[UninstallDelete]` also removes `versions/`, the junctions the launcher made, `.update/` and `logs/`.
- **macOS**: drag the `.app` to the Bin and delete `~/Library/Application Support/3d-maker-suite/install`.
- **Linux**: delete the install dir and `~/.local/share/applications/3d-maker-suite.desktop`.
- The data dir is never removed. The docs say where it is.

## Rejected options
- **Restoring the pre-update backup zip from the launcher.** The launcher has no unzip in Node's stdlib; the server stages the undo while it still runs.
- **A `current.json` pointer to the active version.** It's one more file to write atomically and keep in step with `versions/`. It also needs a rule for a newer `.app` or installer. "Newest wins" covers all of that with no state.
- **AppImage.** It's a read-only squashfs, so updates would need a second, writable layout anyway. Sizes are the same as a `tar.gz`.
- **Electron or Tauri.** The UI is the browser; a window shell adds 100+ MB and its own update system.
- **One executable (Node SEA, pkg).** The native better-sqlite3 module and the web assets must be on disk anyway, and SEA's ESM support is limited.
- **Shipping both `node.exe` and `nodew.exe`.** That's 87 MB more for nothing; the server runs fine under `nodew.exe`.
- **pnpm's default layout, `inject-workspace-packages`, or copying the workspace packages.** The default layout breaks when moved. `inject` changes the lockfile. Copies land under `node_modules`, where type stripping refuses `.ts`.
- **tsx in bundles.** It's slower to start, and adds 12 MB plus a per-platform esbuild.
- **`versions/` inside the `.app`.** Writing there breaks the signature.
- **A per-version launcher behind a fixed stub.** On Windows a shortcut needs a fixed Node path, and a `.cmd` or PowerShell stub flashes a console.
- **MSI or WiX, or NSIS.** MSI wants admin by default. Inno Setup is already on the runner and was proven in the spike.
- **Code signing and notarization.** It costs money every year and isn't needed for friends; we document the warnings instead.
- **A universal macOS binary.** Two Node binaries in one `.app` double the download for everyone.
- **Linux arm64 and Windows arm64 for now.** Docker covers the Raspberry Pi; add them when someone asks.
- **git-based updates for bundles.** Users don't have git or pnpm, and `node_modules` arrives already built.

## Consequences
- A release runs four build jobs before it's published. Nothing is published unless every target built and passed its install smoke test.
- Each version takes about 120 MB on disk (without Node), and two are kept.
- A new Node major means a new installer, not an in-app update.
- Users see one unsigned-app warning per installer.
- ADR-0009 gains the `bundle` install type. Git installs, `pnpm start` and Docker don't change.
- Step 10 ships the layout and a launcher that only picks, relinks, runs and restarts. Update, rollback and pruning come in Step 13; opening the browser and Stop server in Step 11; start at login in Step 12.
