# Hub spikes (5.0.0 Step 1)

Input for ADR-0014. Branch `spike/hub`, not merged. CI: [run 40547578858](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/40547578858) (macOS 15 arm64 + Ubuntu 24.04, logs and screenshots as artifacts; the first [run 40544921563](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/40544921563) had harness bugs, its CLI and size results stand). Local: Windows 11 Pro, Bambu Studio 02.08.02.61, OrcaSlicer 2.5.0-alpha (installed), Docker Desktop 29.9.2, Node 22.23.4 (`nodew.exe`).

| # | Spike | Result |
|---|---|---|
| 1 | Save pattern, `fs.watch` | Both slicers, all OSes: write `<file>.tmp`, rename over `<file>`. One write per save; an unchanged Ctrl+S writes nothing. |
| 2 | Process lives until the window closes | Windows: **yes** (direct, detached spawn). macOS: **no**, it lives until Quit. Linux: the spawned PID is the slicer; close not observed in CI. Single instance / `open -a` hand off and exit at once. |
| 2b | Installed slicer as worker | Detectable on all OSes (registry, `Info.plist`, `flatpak list`; AppImage = typed path). CLI slices while the GUI runs, leaves the user's config alone. |
| 3 | SSE through proxies | Caddy, nginx, Traefik, Docker, with and without compression: streams with the 15 s heartbeat and `X-Accel-Buffering: no`; reconnect resumes with no lost events. |
| 4 | Connector size | Download 24–45 MB, installed 93–126 MB (Node is 87–120 MB of it), update zip 1.4 MB. |
| 5 | Signing, warnings | SignPath: not eligible yet (reputation). Defender: no detection. SmartScreen: not reproducible on this PC. |

## 1. Save pattern and `fs.watch`
- Source (`bbs_3mf.cpp`, `store_bbs_3mf`, Bambu v02.08.02.61 l. 6352–6362, Orca v2.4.2 l. 5953–5963): remove `<file>.tmp`, write the whole 3MF to it, `boost::filesystem::rename` over `<file>`. GUI Save (`Plater::export_3mf`) and CLI `--export-3mf` call the same function.
- Windows GUI Save (hands-on, both slicers), as the poll saw it: `a.3mf.tmp` appears (0 → 12 KB → full), ~20–50 ms later `a.3mf` has the new size and **the tmp file's inode**, `.tmp` gone. A second Ctrl+S without a change writes nothing. GUI and CLI logs are identical in shape.
- Linux `strace` (Bambu CLI): `openat(model.3mf.tmp, O_WRONLY|O_CREAT|O_TRUNC)`, then `rename(model.3mf.tmp, model.3mf) = 0`. The target is never open for writing.
- What Node's recursive `fs.watch` reports (filename always set, never null):
  - Windows: `rename x.tmp`, `change x.tmp`, then `rename x`, `rename x.tmp`, `rename x`.
  - macOS (FSEvents): only `rename` events (`x.tmp`, `x`, `x`), ~45 ms after the change.
  - Linux (inotify): 6–7 `change x.tmp`, then `rename x.tmp` and 2–3 `change x` in the same ms.
- The CLI also drops `result.json` into `--outputdir` (Bambu always, Orca on Linux).
- **Consequence:** a finished file appears in one rename, so the path never holds half a 3MF. Ignore `*.tmp`, debounce the events per path (~1 s), then hash. The generic "same size and mtime" check is only needed for other writers (copying a file in Explorer or Finder writes in place).

## 2. Does the launched process live until its window closes?
`launch.mjs` spawns the slicer with a file, logs the spawned PID's exit and every 2 s the slicer processes.

| | Windows (hands-on) | macOS (CI, Bambu) | Linux (CI) |
|---|---|---|---|
| Direct spawn with a file | process = the slicer; closing the window → exit 0 (Bambu after 295 s, Orca after 146 s) | process = the slicer; **Cmd+W leaves it running** (2 processes 10 s later); `quit app` → exit 0 | AppRun `exec`s `bin/bambu-studio` / `bin/orca-slicer`, so the PID is the slicer; window close not observed (first-run dialogs, titles are the file name) |
| Second launch, single instance off (default) | a second process | a second process (two Dock icons) | a second process |
| Second launch, single instance on | exits after 0.3–0.5 s with −1; the running window asks "open as project or import geometry" | — | — |
| `open -a` | — | `open` exits after 0.3 s, the app runs under another PID | — |
| `open -W -a` | — | `open` returns when the app quits | — |

- **Windows kills a non-detached child when Node exits** (libuv's kill-on-close job object): a throwaway child spawned without `detached` was gone 1 s after its parent exited, with `detached: true` it lived. The connector must spawn slicers `detached` and keep their PIDs in its state file, or a connector restart or update closes the user's slicer with unsaved work.
- Orca on the macOS runner answered no Apple Event (timeouts, first-run dialogs): not concluded there. Bambu's behaviour is wxWidgets' on macOS, which Orca shares.
- Linux AppImages show a first-start "use system SSL certificate?" dialog unless `SSL_CERT_FILE` is set (`Http.cpp`, `X509_get_default_cert_file_env`). The connector sets it when it launches a slicer.

## 2b. Installed slicer as a slice worker
- Windows (this PC): `HKLM\…\Uninstall\Bambu Studio` → `DisplayVersion 02.08.02.61`, `DisplayIcon C:\Program Files\Bambu Studio\bambu-studio.exe`; `HKLM\SOFTWARE\WOW6432Node\…\Uninstall\OrcaSlicer` → `2.5.0` (the installed build is 2.5.0-alpha: the registry drops the pre-release tag; its profiles are 71 `.opc` files). `InstallLocation` is empty for both, so the path comes from `DisplayIcon`. `OrcaSlicer.conf` still says 2.4.2: configs aren't a version source.
- macOS: `plutil -extract CFBundleShortVersionString` → `02.08.02.61`, `2.5.0-alpha`; `CFBundleIdentifier` `com.bambulab.bambu-studio`, `com.orcaslicer.OrcaSlicer`.
- Linux: nothing on `PATH`, no `.desktop` entry for AppImages (they live wherever the user put them: a typed path; `X-AppImage-Version=02.08.02.61` is in the extracted `.desktop`). Flatpak: `flatpak list --app --columns=application,version` → `com.bambulab.BambuStudio 2.8.2.61 Public Release`, `com.orcaslicer.OrcaSlicer 2.4.2`. `flatpak run com.bambulab.BambuStudio --slice 1 …` slices (exit 0). Its sandbox sees `home;/media;/run/media`, so work files go under `$HOME`, not `/tmp`.
- **CLI slice while the GUI runs:** Windows (both, single instance off), macOS and Linux (both): exit 0, `out.3mf` + gcode. Run alone, the CLI changed nothing in `%APPDATA%\BambuStudio` or `%APPDATA%\OrcaSlicer` (logs aside).

## 3. SSE through proxies
`sse-server.mjs` (time-based ids, `Last-Event-ID` replay) in `node:22-trixie-slim`, published on 8080 and behind `caddy:2` (2.11.7), `nginx:stable` (1.30.6), `traefik:v3` (3.7.16), default configs plus compression (`docker-compose.yml`, `proxy/`). `sse-client.mjs` = `fetch` streaming, reconnect after 1 s.
- Latency, 20 s: every path delivers each event at once (50–90 ms = the 100 ms tick plus the VM clock offset, same as direct), including Caddy `encode gzip`, Caddy TLS + HTTP/2, Traefik `compress` (it gzips and still streams), nginx with and without `X-Accel-Buffering`.
- **nginx with `gzip` on `text/event-stream` and without `X-Accel-Buffering: no` delivers nothing, not even headers, in 20 s.** The header is needed.
- Idle 5.5 min, no events:

| | No heartbeat | 15 s heartbeat |
|---|---|---|
| nginx, nginx gzip | cut every 60 s (`proxy_read_timeout`) | 22 heartbeats, 0 drops |
| Direct, Caddy (all 3), Traefik (both) | cut at 300 s by the **client**: undici's `bodyTimeout` | 22 heartbeats, 0 drops |

- Restart of each proxy, then of the server, during a 90 s stream: all 8 paths drop, reconnect within 1–2 s (the first retry hits the starting proxy) and resume from `Last-Event-ID` with **no gap** in event ids.

## 4. Connector bundle
Stand-in `apps/connector` (core + 3mf, parses a 3MF, uploads it, holds the SSE stream), built the `build.mjs` way (hoisted prod deps, links out, same trims). 11 packages: zod 4.5 MB, fast-xml-parser 0.5 MB, yauzl 0.07 MB; core + 3mf sources 0.3 MB; 3 workspace links.

| Target | Node | App | Installed | Download | Update zip |
|---|---|---|---|---|---|
| Windows x64 (local) | 87 (`nodew.exe`) | 5.8 | 93 | `setup.exe` 24.1 | 1.5 |
| macOS arm64 (CI) | 108 | 6.1 | 114 | dmg (ULMO) 28.2 | 1.4 |
| macOS x64 (CI) | 110 | 6.1 | 116 | dmg 30.3 | 1.4 |
| Linux x64 (CI) | 120 | 5.6 | 126 | tar.gz 45.0 | 1.4 |

MB. The app's own are 43.6 / 167 / 136 / 79 (ADR-0011 spike). An update moves 1.4 MB instead of ~75.
- **Reused unchanged:** Node download + `SHASUMS256` check + `nodew` patch, link recording and relinking, trims, zip, Inno Setup options (per user, no admin, Run key for start at login), the ad-hoc signed `.app`, `install.sh`, `SHA256SUMS`, the launcher's version picking, relink, restart on 75, `pending.json` update and rollback with the 60 s health check (the connector's status page answers `/api/health`).
- **Needs a parameter:** product name, AppId, bundle id, the `--filter` package, which `apps/*` to keep, and the `better-sqlite3` and `apps/web/dist` steps (server only). The launcher's loader page opens the status page instead of the app.
- **Server-only, not needed:** the backup/undo staging (`update-undo/`, `applyPendingRestore`): the connector has no database, a rollback only swaps versions.

## 5. Signing and warnings
- SignPath Foundation ([terms](https://signpath.org/terms)): OSI licence (MIT ✓), actively maintained, already released in the signed form, built on CI from source, manual approval per release, MFA for every team member, a "Code signing policy" page with roles and a privacy statement, no proprietary code. **Executables need "a certain verifiable reputation"**: today 0 stars, 0 forks, 3 weeks old, 14 installer downloads, one maintainer. **Not eligible yet.** Also: our patched `nodew.exe` is a modified upstream binary; it can only be signed through a visible maintained fork of Node. Unsigned upstream binaries may sit inside a signed package, so a signed `setup.exe` with an unsigned `nodew.exe` would be allowed. Their certificate is Windows Authenticode; macOS needs Apple's Developer ID, which stays out (ADR-0011).
- Defender (real-time + tamper protection on, 4.18.26090.9): the stand-in running hidden under `nodew.exe`, reading a 735 KB 3MF, uploading it and holding the SSE stream: `MpCmdRun -Scan` on the bundle and on `nodew.exe` finds nothing, 0 detections today.
- SmartScreen (hands-on): Edge warned at download ("not commonly downloaded"), yet the saved file carried no `Zone.Identifier`, and a copy given ZoneId=3 also ran with no prompt. Most likely this exact installer already ran here (4.2.0 is installed). Not reproducible on this PC; the documented "More info → Run anyway" stays. Smart App Control is off here (`VerifiedAndReputablePolicyState = 0`); on a clean Windows 11 install with it **on**, unsigned apps are blocked with no override.
- macOS (Apple docs, no Mac here): Gatekeeper as in ADR-0011. `~/Desktop`, `~/Documents` and `~/Downloads` are TCC-protected, so watching a sync folder there asks for access once (attributed to the executable path; Node's path stays fixed across updates). Start at login is a LaunchAgent (`autostart.ts`), which macOS 13+ announces as a background item.
