# Installer spike (4.1.0 Step 9)

Input for ADR-0011 (Step 10). Code: branch `spike/installer`, `packaging/spike/` (bundle, probe, relink, nodew, launcher stand-in, Inno script, macOS and Linux packagers). Not merged.
CI evidence: [run 39885507338](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/39885507338) (all 5 jobs green). Local evidence: Windows 11 Pro, Defender real-time and cloud protection on.

## Results

| # | Point | Result |
|---|---|---|
| 1 | `nodew.exe` hidden start, Defender | **Yes** |
| 2 | Inno Setup on `windows-latest`, per-user install without admin | **Yes** |
| 3 | macOS `.app` + ad-hoc signing, Gatekeeper, arm64 + x64 | **Yes** (Gatekeeper blocks as expected; see the flow below) |
| 4 | Linux: AppImage vs `tar.gz` | Both run on clean Ubuntu 24.04 without libfuse2. **Chosen: `tar.gz`** |
| 5 | Bundle size per OS | 75–86 MB compressed, 215–264 MB installed |
| 6 | Two versions in `versions/` load their own native module and open the same DB | **Yes** |
| 7 | Cold start with tsx | 1.6–3.4 s; native type stripping is 0.4–1.2 s faster |

**Decisions:** Linux = `tar.gz`. macOS = **arm64 and x64**, both built on the arm64 runner `macos-15`.

## 1. nodew.exe
- `nodew.mjs` copies `node.exe` and sets the PE subsystem from 3 (console) to 2 (windows). The patch breaks Node's Authenticode signature (`HashMismatch`), so the script also removes the certificate table. The result is `NotSigned`, a plain unsigned file instead of a broken signed one.
- Started through `Start-Process`, the same ShellExecute path a shortcut uses:
  - `node.exe launcher.mjs` (control): a new WindowsTerminal window.
  - `nodew.exe launcher.mjs`: **no new window**. `/api/health` returns 200 and the server log fills. Writing to stdout/stderr under the windows subsystem doesn't throw.
  - Process tree: `nodew.exe → node.exe (server) → conhost.exe`. The conhost is hidden (`windowsHide`).
- The server also runs under `nodew.exe` (1.19–1.23 s to healthy), so **one binary is enough**: ship `nodew.exe` only and save 87 MB. The CI installer does this.
- Defender: `MpCmdRun -Scan -ScanType 3` finds no threats in `nodew.exe` or the bundle. `Get-MpThreatDetection` shows 0 detections after the runs. SmartScreen for the unsigned `setup.exe` wasn't tested (it needs an interactive prompt); expect "Windows protected your PC → More info → Run anyway".

## 2. Inno Setup
- Ships on `windows-latest`: `iscc` is on PATH (`C:\ProgramData\Chocolatey\bin\ISCC.exe`) and at `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`. No install step needed.
- `PrivilegesRequired=lowest`, `DefaultDirName={localappdata}\Programs\…`. Local, non-elevated shell: `User privileges: None`, `Administrative install mode: No`, root key HKCU. No UAC prompt. HKCU uninstall key yes, HKLM no; Start-menu shortcut yes. The installed app starts (health 200, server exe = the installed `nodew.exe`). Silent uninstall removes all files and the key.
- `setup.exe`: **43.6 MB** (lzma2/max, `nodew.exe` only).
- Gotchas for Step 10:
  - `iscc` follows junctions and packs their targets twice. The first CI attempt then aborted at install time ("error occurred while trying to create a file"). Compile from a **link-free** bundle.
  - The uninstaller leaves the junctions the launcher created (empty dirs, 0 files). Add `[UninstallDelete]` for `{app}\app`.

## 3. macOS
- `.app` = `Contents/MacOS/3d-maker-suite` (an `sh` script that `exec`s `Resources/node/bin/node launcher.mjs`) plus `Info.plist` (`LSUIElement`). `codesign --force --deep -s -` gives `valid on disk`, `satisfies its Designated Requirement`, `Signature=adhoc`. `open -n` starts it; health 200 on arm64, Intel and the cross-built x64.
- **The `.app` must not change after signing.** Links are restored before `codesign`, and the launcher's relink is a no-op there. `versions/` must live in `~/Library/Application Support`, not inside the `.app`.
- Gatekeeper (macOS 15.7.9 runners), quarantined copy:
  - `spctl -a -t exec`: `rejected`.
  - `syspolicy_check distribution`: "Notary Ticket Missing". It also reports an "Internal Xprotect Error", likely the tool on a headless runner; check on a real Mac in Step 15.
  - `open`: no process starts. `syspolicyd` logs "rejecting due to lack of matching active rule" and `open` waits on a prompt nobody can click.
- User flow on macOS 15: Sequoia removed the Ctrl-click → Open bypass. The flow is open once → blocked → System Settings → Privacy & Security → **Open Anyway**, or `xattr -dr com.apple.quarantine "/Applications/3D Maker Suite.app"`. One report says Open Anyway was missing on 15.1; Apple's docs still describe it. Not tried hands-on (no Mac): verify in Step 15.
- x64:
  - Native on `macos-15-intel` works.
  - Cross-packaging on the arm64 runner (`bundle.mjs --arch x64`, `pnpm install --cpu=x64`) works. The runner has Rosetta, so the x64 build is smoke-tested there.
  - `macos-15-intel` is the last Intel image (supported until about Aug 2027), so **build both arches on `macos-15`**.
  - Under Rosetta, the first start of a fresh copy takes about 24 s (translation); that doesn't happen on a real Intel Mac.
- `.dmg` (UDZO) is 136–172 MB, twice the zip (84–86 MB). Try `-format ULFO`/`ULMO` in Step 10.

## 4. Linux
- AppImage, built with the current `appimagetool` (static type2 runtime), in a clean `ubuntu:24.04` container with `fuse3` (as on Ubuntu Desktop 24.04) and **no libfuse2** (`ldconfig`: 0 found): the FUSE mount works and health is 200.
- `tar.gz` in the same container: health 200.
- **Chosen: `tar.gz`.** An AppImage is a read-only squashfs. The `versions/` layout and bundle updates (Step 13) need a writable install dir, so an AppImage would only be a bootstrap with a second layout under `~/.local/share`. A `tar.gz` extracted to `~/.local/share/3d-maker-suite/` fits directly. Add a `.desktop` file through a small install script. Sizes are similar (AppImage 70 MB, tar.gz 76–79 MB).

## 5. Bundle size (Node 22.23.4, prod deps of the server, `node-linker=hoisted`)

| Target | Node | node_modules | web dist | Installed | zip / tar.gz | Installer |
|---|---|---|---|---|---|---|
| win32-x64 | 87.2 | 117.1 | 2.8 | 214.8 | 74.9 | setup.exe 43.6 |
| darwin-arm64 | 113.1 | 126.7 | 2.8 | 250.4 | 83.7 | dmg 167 |
| darwin-x64 | 115.6 | 128.9 | 2.8 | 255.0 | 85.7 | dmg 136 |
| linux-x64 | 125.0 | 128.2 | 2.8 | 263.8 | 79.0 | AppImage 70 |

MB. Bundle = `git archive HEAD` minus dev files + built `apps/web/dist` + `pnpm install --prod --frozen-lockfile --filter "@3d-maker-suite/server..."`.

Packaging findings:
- **The pnpm default layout isn't relocatable on Windows.** It has 874 junctions with absolute targets, and a moved copy fails with `ERR_MODULE_NOT_FOUND @3d-maker-suite/db`. With `node-linker=hoisted` (lockfile-neutral) only 22 junctions remain, all for workspace packages. `inject-workspace-packages` would remove them but changes the lockfile (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`).
  - Fix used here: `bundle.mjs` writes `links.json` (relative targets) and removes the links; `relink.mjs` recreates them on start (Windows junctions need no admin). That's 22 links on Windows, 34 on POSIX (including `.bin`).
  - Unzipped elsewhere and relinked, the copy starts.
- Windows' in-box `tar.exe` crashes (0xC0000005) zipping `node_modules` (a test fixture in `@fastify/send`). Use .NET `ZipFile` or 7-Zip in CI.
- Easy trims for Step 10 (Windows numbers):
  - maps, `.d.ts` and `.md`: 37 MB
  - better-sqlite3: 26 MB, mostly `deps/` sources and the 7 prebuilds for other platforms
  - tsx + esbuild: 11.7 MB (see 7)

## 6. Two versions side by side
- Local Windows: `versions/a` and `versions/b` with the same `APP_DATA_DIR`.
  - A running maps `versions\a\…\prebuilds\win32-x64.node` (`(Get-Process).Modules`).
  - While A runs, `versions/b` can be deleted and re-extracted. A's own `node.exe` can't be deleted (access denied), so a running version only locks its own folder.
  - B then starts on the same DB (health 200, `/api/printers` 200) and maps `versions\b\…\win32-x64.node`.
- macOS (`lsof`) and Linux (`/proc/<pid>/maps`): each copy maps its own `prebuilds/<os>-<arch>.node` on the shared data dir.
- **better-sqlite3 13 ships N-API prebuilds for all 8 platforms in the package and has no install script.** The `.node` is not tied to a Node ABI, and cross-packaging needs no compiler. The file is `prebuilds/<os>-<arch>.node`, not `build/Release/better_sqlite3.node`.

## 7. Start time (ms to first 200 on `/api/health`, median of 3, fresh data dir incl. migrations)

| Machine | Native type stripping | tsx cold cache | tsx warm |
|---|---|---|---|
| Local Win 11 | 1196 | 1577 | 1384 |
| windows-latest | 2214 | 3411 | 2804 |
| macos-15 arm64 | 1387 | 1887 | 1391 |
| macos-15-intel | 2271 | 2830 | 3075 |
| x64 under Rosetta | 3657 | 4611 | 3268 |
| ubuntu-24.04 | 1440 | 2101 | 1743 |

- tsx is fine for a desktop app (≤3.4 s on slow runners).
- **Node's native type stripping already works** (Node ≥22.18; the bundle ships 22.23.4) after one change. `tsc --erasableSyntaxOnly` finds only `apps/server/src/errors.ts`, with 2 parameter properties.
- With that change the bundle can run `node src/main.ts`: 0.4–1.2 s faster, 11.7 MB smaller, and esbuild, the last per-platform binary in the prod tree, is gone.
- Proposal for Step 10: fix `errors.ts`, turn on `erasableSyntaxOnly`, and run bundles without tsx. Keep tsx for `pnpm dev`, and for `pnpm start` unless `engines.node` moves to ≥22.18.

## Recommendations for Step 10
1. Bundle with `node-linker=hoisted` plus `links.json`, recreated by the launcher (Windows) or at build time (macOS `.app`). Ship link-free to `iscc`, and add `[UninstallDelete]` for the junctions.
2. Windows: ship only the patched, unsigned `nodew.exe`, used for launcher and server. Per-user Inno Setup install in `{localappdata}\Programs`.
3. macOS: arm64 + x64 `.app`/`.dmg`, both built on `macos-15`, ad-hoc signed after relinking. `versions/` goes in Application Support. Document Open Anyway and the `xattr` fallback.
4. Linux: `tar.gz` into `~/.local/share/3d-maker-suite` plus a `.desktop` entry. No AppImage.
5. Drop tsx in bundles (native type stripping) and trim maps, d.ts, docs and foreign better-sqlite3 prebuilds. Zip with .NET/7-Zip, not Windows `tar`. Try ULFO for the `.dmg`.
