# ADR-0014: Hub and connector: central files, device roots, slice workers

- Status: Accepted (after the Plan 5.0.0 Step 1 spikes, see Spike results)
- Date: 2026-10-26, accepted 2026-10-27

## Context
The app reads its project roots from its own disk: it scans, hashes, watches, creates folders, moves to trash and slices (ADR-0007, ADR-0013) on the machine it runs on. That works on one PC or a NAS on the LAN. A company that runs the app on a VPS or a NAS for a whole team has a problem: the modelers keep the files on their workstations or on a local NAS or file server. They save in Bambu Studio or OrcaSlicer and expect the app to pick up the change, slice it and update the costs. Uploading every file to the server by hand duplicates everything: files get out of date, or the wrong file lands in the wrong folder.

Requirements from the 2026-10-26 discussion:
- One server installer that runs anywhere (one PC, VPS, NAS, Docker) and a separate, small **connector** for each workstation that edits or prints files. The workstation doesn't run the whole app.
- People use one interface, the web app. The connector works in the background.
- One source of truth for every file.
- Works with a NAS, a file server and workstations, mixed.
- Slicing in one place, preferably on the server.
- Open source, no third-party services, simple to run.
- No paid code signing.

## Decision

### Hub
- **Hub** = the normal server with hub features switched on (Settings → Server, admin-only, off by default). The switch explains what it adds and needs users to be set up (ADR-0012), because every device belongs to a user.
- A new **Hub management** section next to Integrations, admin-only. It lists devices (name, user, OS, connector version, online/last seen, sync mode, slice worker), pairing, revoking and the hub settings (locks, versions).
- Without the switch nothing changes: single-PC and NAS installs keep working exactly as today.

### Roots have a location
Every project root gets a **location**, and the two "modes" from the discussion are the two values:

| Location | Files live | Source of truth | The hub | Devices |
|---|---|---|---|---|
| `hub` | in a folder on the hub | the hub's copy | scans, watches, slices as today | sync all of it, or selected projects |
| a device | on that device (workstation, NAS or file server running the connector) | the device's copy | indexes metadata, pulls a file only when it needs it | the owner edits; everyone else can only download |

- Roots move from the `projectRoots` path strings to a `roots` table (id, name, location, path). Projects reference `rootId` + relative path. All root file access on the hub goes through one seam per root, so a device root is "the same calls, over the connector".
- A company can mix both, e.g. a central library on the hub plus one modeler's own root.
- Hub roots are plain local folders on the hub, so scanning, watching, auto slice and the trash keep the code they have today. Only the sync with devices is new.

### Connector
- **What it is:** `apps/connector`, a small TypeScript program. It imports only `@3d-maker-suite/core` (zod schemas, so types stay single-source), `@3d-maker-suite/3mf` (to read metadata on the device) and `@3d-maker-suite/host` (node-only helpers it shares with the server: start at login, zip, secrets, the checked bundle download). It never imports the server.
- **Packaging:** the same pipeline as ADR-0011 (Inno Setup per user without admin, ad-hoc signed `.dmg`, `tar.gz` + `install.sh`), the same bundled Node, the same start-at-login and the same self-update with rollback. The connector follows the hub's version: it fetches the release that matches the hub, so the protocol always matches. `packaging/build.mjs` and `setup.iss` take the product as a parameter (name, AppId, bundle id, the `--filter` package, which `apps/*` to keep); the web app and `better-sqlite3` steps are server-only. The connector has no database, so its updates skip the backup and undo staging: a rollback only swaps versions.
- **No tray icon.** It has a small status page on `127.0.0.1` (pair, hub URL, online state, sync state, open the sync folder) and a start-menu or launcher entry that opens it. Everything else happens in the web app. The status page answers `/api/health`, so the launcher's start and update checks work unchanged.
- **Sync folder:** `<home>/3D Maker Suite` by default, outside `Desktop`, `Documents` and `Downloads`, which macOS protects with a consent prompt (TCC).
- **Pairing:** only admins pair devices. An admin creates a one-time pairing code for a user in Hub management (valid 10 minutes). The connector exchanges it for a device token. The hub stores only its sha256, like sessions (ADR-0012). The device acts as that user, and revoking it ends its access at once.
- **Channel:** the connector always connects out, so devices need no open ports and no VPN. It uses REST for requests and file transfer, and one Server-Sent Events stream (`GET /api/hub/events`) for hub → device commands. A heartbeat keeps the online state. SSE is a plain Fastify reply and `fetch` streaming on the connector, so there's no new dependency. Events wait per device in `hub_events`; the event id is its `seq`, and a reconnect's `Last-Event-ID` acks (deletes) everything up to it before the rest is replayed. While the hub is off, a device token gets 404 `hub_off`, never 401: a connector drops its token only when it is revoked.
- **Fixed operations only.** The connector carries out a closed list: list, stat, read and upload a file, write into its sync folder, move to its root's trash, create a project folder, report the installed slicers, open a file in its detected slicer, and slice (workers only). It never runs a command the hub sends. Every relative path is normalised and checked against the root on both sides: no `..`, no absolute paths, no symlinks that point out of the root.

### Hub roots: sync
- **Index:** a `hub_files` table (root, relative path, size, sha256, version, deleted, lock) and a change sequence number. A connector asks for "changes since my cursor" and stores the new cursor. Clocks are never compared across machines: only versions and hashes count.
- **Device → hub:** the connector sees a change (Node's recursive `fs.watch`), ignores `*.tmp`, and waits until a path has had no event for 1 s. Both slicers save by writing `<file>.tmp` and renaming it over `<file>`, so a 3MF is never half-written at its own path. Before hashing it still checks that the file is stable (same size and mtime over 2 s, and it opens for reading), for writers that write in place, such as a copy in Explorer or Finder. It then hashes the file and uploads it with the version it started from. The hub streams the upload to a temp file, checks the hash and renames it into place. If the base version is current, the upload becomes the new version. Otherwise the hub keeps it as a conflict copy `<name> (conflict <device> <date>).<ext>` and raises an alert.
- **Hub → device:** the connector downloads changed files to a temp file next to the target and renames it into place.
- **Delete:** a local delete becomes "move to the root's trash on the hub" (the existing trash folder), never a hard delete. **Mass delete guard:** if a device deletes more than a set number of files from one root at once (Hub management, default 20), or the root's folder is missing, the connector holds those deletes and asks on its status page, and the hub raises an alert. (Step 11 dropped the "share of a root" threshold: the missing folder covers the case it was for.) Removing the local copy of an unselected project is not a delete.
- **Sync mode per device:** *everything*, or *selected projects*. The project page gets an **Open on my workstation** button whenever the user has an online device (one **Open** button since Step 14b, see the amendment). The hub sends "open" to that device. The connector syncs the project if it isn't there yet, then opens the file in the local slicer. This replaces OneDrive-style placeholder files (rejected below).

### Device roots
- The connector watches the root, reads 3MF metadata locally with `packages/3mf`, and sends the index and metadata to the hub. The hub stores it the same way as a scan.
- The hub pulls a file only when it needs it (slicing, download, 3D view). The file goes into a temp cache with a size cap and an expiry, and is deleted after use.
- Write actions from the web app (create project folder, trash) run on the owning connector, inside its root.
- When the device is offline, its projects show the last known data with an "offline" badge. Nothing is lost, and the device catches up when it comes back.
- By default, other users can only download files in a device root. Editing someone else's files would make a machine that sleeps or leaves the office the source of truth for others. People who need shared editing use a hub root. An admin can give a user the `editOtherDevices` right (admins have it by default).

### Who sees what
- Permissions belong to **users and roles**, not to devices: whether someone sees all projects or only their own, and whether they may edit other people's projects in hub roots or only download them. Projects get an owner.
- What a device syncs follows its user's permissions. Files a user may only download sync read-only.
- Per-device settings cover only where and how: sync folder, everything or selected projects, slice worker.

#### Permission table (5.0.0 Step 8)
Per-user switches (Settings → Users):

| Switch | Default | Applies to |
|---|---|---|
| `projectsSeeAll`: see every project (otherwise only my own) | on | viewer, editor (an admin always sees every project) |
| `projectsEditOthers`: edit other people's projects (otherwise download only) | on | editor (an admin always may; a viewer never may) |
| `editOtherDevices`: edit files in another user's device root | on for admins, off for editors | admin, editor |

Per root (`roots.editBy`, Settings → Projects):

| `editBy` | Hub root: who edits | Device root: who edits besides the device's own user |
|---|---|---|
| `roles` (default) | admins and editors | admins and editors who have `editOtherDevices` |
| `admins` | admins | admins who have `editOtherDevices` |
| `users` | the picked editors and admins (`root_editors`) | the picked users, with or without `editOtherDevices` |
| `none` | nobody (view only) | nobody else |

On their own device root, the device's user can always edit: the files are on their disk anyway.

The project owner (`projects.owner_id`, set to null when the user is deleted) is:
- for projects from before Step 8, the oldest enabled admin;
- for a project in a device root, the device's user;
- for a project made with "New project", whoever made it;
- for a project the scan finds in a hub root, nobody.

A project without an owner counts as someone else's for everybody.

What a user may do with one project:
1. With no users set up, everyone may edit.
2. The project is **hidden** (404, left out of the list, search, pickers and materials) when it isn't theirs, they aren't an admin, and `projectsSeeAll` is off.
3. A viewer may only download.
4. A user may **edit** when the root lets them edit (a project without a folder skips this check) and one of these holds: the project is theirs, they are an admin, or `projectsEditOthers` is on.
5. Otherwise the user may **download**: every GET works, and every write to `/api/projects/:id/...` answers 403.

Making a project in a root, or linking one of its folders, needs the root's edit right. The hook in `lib/auth.ts` checks the `/api/projects/:id` routes once for every route file, as `can()` does for prefixes.

### Locks (setting: off · on · strict)
- Opening a file through the connector (the "Open" button) takes a lock on the hub. So does the first local change to a file that wasn't opened that way. Other devices set the file read-only, and the web app shows "Being edited by `<user>` on `<device>`".
- **Release:** when the user clicks Done editing (web app or status page), after an idle timeout (no save of the file for a set time), or when an admin force-unlocks. On Windows and Linux also when the slicer process the connector launched exits:

  | OS | Open | Process exit releases? |
  |---|---|---|
  | Windows | the slicer's program with the file, `detached`, PID kept in the connector's state file | yes: closing the window ends the process |
  | Linux | the same; an AppImage's `AppRun` `exec`s the slicer, so the PID is the slicer. `SSL_CERT_FILE` is set, or an AppImage stops at a first-start certificate dialog | yes (expected as on Windows; the window close is confirmed in Step 20) |
  | macOS | `open -a <app> <file>`, so the file joins the one running app | no: the app outlives its windows and runs until Quit |

  A launch whose process exits within 2 s handed the file to a slicer that was already running ("single instance" on, or a hand-off): that lock waits for Done editing or the idle timeout. The connector always spawns slicers `detached`: on Windows, Node closes a non-detached child when Node exits, so restarting or updating the connector would close the user's slicer with unsaved work.
- **Strict:** a device that is offline can't take a lock, so its hub-root files are read-only until it reconnects. Without strict mode, a clashing offline edit becomes a conflict copy.
- These are soft locks: anyone can still copy a file out. They prevent accidents, not deliberate bypassing.

### Versions (setting: on/off, keep N)
- When an upload is accepted, the previous content moves to `<dataDir>/versions/<rootId>/<fileId>/<version>`. That's outside the root, so scans skip it and devices never sync it. When there are more than N versions, the oldest is pruned.
- Devices see only the latest version. The web app shows a file's history and lets people download older versions. Restoring is "download it, save it again". Hub management shows the disk use.

### Slicing
- **Default: on the hub**, with its desktop or managed slicer (ADR-0007, ADR-0013). For device roots, the hub pulls the file first.
- **Slice workers** for hubs that can't slice (no Bambu build for Linux arm64, a small VPS). An admin marks a device as a slice worker and picks, per device, which slicer it uses:
  - **Installed:** a slicer the connector found, or a path the admin typed. The connector reports what it finds: on Windows the `Uninstall` registry keys (HKLM, HKLM `WOW6432Node`, HKCU; `DisplayVersion`, path from `DisplayIcon`), on macOS `/Applications/*.app` (`CFBundleShortVersionString`), on Linux `flatpak list --app` (run through `flatpak run`). AppImages can be anywhere, so they're a typed path. No download, no extra disk. The version follows the user's own updates; it's part of the slice cache key, so a change marks slices outdated.
  - **Managed:** as in ADR-0013, a portable download from the vendor's release into the connector's own data folder, with no admin rights and no change to the user's desktop slicer. The hub fixes the version, so results match the hub.

  Either way, the hub pushes its managed config folder (presets) to the worker and slicing passes them to the CLI (ADR-0007), so the user's own slicer settings are never touched. Slicing works while the user has the same slicer open. Work files go into the connector's data folder under the user's home: a Flatpak slicer can't read `/tmp`.
- A worker shows up as one more slice-capable integration ("Bambu Studio (WS-3)") in the plate → project → default slicer pickers (4.2.0 Step 13b). The slicer version stays part of the slice cache key.

### Unsigned builds
As in ADR-0011: nothing is code-signed. The docs walk through the SmartScreen and Gatekeeper warnings, which appear once per installer. Self-updates download over HTTPS without a quarantine flag, so they don't warn again. On top of that:
- `SHA256SUMS` and GitHub artifact attestations (free) let a company's IT check where a build came from and allow it by hash or path.
- SignPath Foundation (free Windows signing for open source) doesn't take the project yet: it wants a verifiable reputation for programs. We apply once the project has one. They can't sign our patched `nodew.exe` (a modified upstream binary), but a signed installer may contain it. macOS has no free notarisation.

## Rejected options
- **OS placeholder files (Windows Cloud Files API, macOS File Provider, FUSE):** three native code bases, a paid Apple account for File Provider, and years of work in Nextcloud's client. Syncing per project plus Open on my workstation covers the need.
- **The whole app on every workstation:** too heavy, and the workstation doesn't need the server, the database or the UI.
- **Mounting the NAS on the VPS over a VPN (SMB/NFS/SSHFS):** no file events, every scan pulls whole 3MFs over the internet, the company exposes its NAS, and workstation-only files aren't covered. It stays a documented setup for advanced users. The network-storage module is separate (Backlog).
- **A Syncthing sidecar:** no app code, but it's the duplication we want to avoid, its conflict files appear without the app knowing, and there's no link to locks, versions or permissions.
- **A WebDAV network drive served by the hub:** possible later for "browse without syncing". Windows' WebDAV client limits file size by default and is slow with large 3MFs.
- **A connector in Go or Tauri:** a second toolchain, types written twice instead of the zod schemas, and none of ADR-0011's installer, update and start-at-login code reused. Go would be smaller (≈10 MB against 24–45 MB to download with Node), but size isn't the constraint.
- **WebSockets:** `@fastify/websocket` would be a new dependency. One-way SSE plus REST is enough.
- **Running the vendor's slicer installer on workstations from the hub:** it needs admin rights and touches the user's desktop install. Managed portable downloads (ADR-0013) need neither.
- **Editing other users' files in device roots:** it makes an unreliable machine the source of truth for others. Use a hub root.
- **Permissions per device:** everyone sitting at a shared workstation would get its rights.
- **Users pairing their own devices:** every device that can upload files and run slice jobs is an admin decision.
- **Comparing mtimes across machines:** clocks drift. Only versions and hashes count.

## Risks and mitigations
- **A slicer or version that saves differently** (in place, several writes): the stability check plus the upload's hash still catch it.
- **Single-instance slicers** (macOS, the single-instance option): the launched process exits at once, so "process exited" can't release the lock. Done editing and the idle timeout always work.
- **Company antivirus or EDR flags an unsigned background program that uploads files:** attestations, checksums, a fixed install path and an IT page in the docs. Free signing once the project qualifies.
- **Smart App Control** (on for some clean Windows 11 installs) blocks unsigned programs with no override. The docs say so; signing is the only fix.
- **macOS asks for folder access** when the sync folder or a device root is in `Desktop`, `Documents` or `Downloads`: once per folder, tied to the bundled Node, whose path doesn't change with updates. The default sync folder avoids it.
- **Reverse proxies buffering SSE:** `X-Accel-Buffering: no`, a comment heartbeat every 15 s, and reconnecting from the cursor. The connector's `fetch` must not time out a quiet body (undici's default is 300 s); the heartbeat keeps it busy.
- **Bandwidth and disk** (large 3MFs, full copies, versions): whole-file transfer only when the hash changed, selected-projects mode, the version cap, and disk use shown in Hub management.
- **A device that's lost or stolen:** revoke it in Hub management, which ends its token at once. Local copies stay on its disk (the same as any synced folder).

## Consequences
- Plan 5.0.0: the hub switch and root locations, Hub management and pairing, the connector and its installers, device roots, sync of hub roots, locks, versions and slice workers.
- `managedSlicer` download and unpack moves out of `apps/server` into `packages/host`, which both the server and the connector use (Step 4 created it for start at login, zip, secrets and the checked bundle download). Slice workers also accept an installed slicer (Step 17).
- The release workflow builds connector installers next to the app installers. Their versions stay in sync.
- Out of scope, kept for later: printing from the web app (both locations can give the hub the sliced file), a WebDAV drive, restoring a version in place, several users on one shared workstation.

## Spike results (2026-10-27)
Scripts, logs and details: branch `spike/hub` (`spike/hub/NOTES.md`, not merged), CI [run 40547578858](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/40547578858) (macOS 15 arm64, Ubuntu 24.04). Windows 11 Pro (this PC, hands-on), Bambu Studio 02.08.02.61, OrcaSlicer 2.5.0-alpha, Node 22.23.4, Docker Desktop 29.9.2.

**1. Save pattern and `fs.watch`.** Both slicers, every OS: write `<file>.tmp`, then rename it over `<file>` (`store_bbs_3mf` in `bbs_3mf.cpp`, used by GUI Save and CLI `--export-3mf` alike; seen in the GUI on Windows, the CLI on all three, `strace` on Linux). One write per save; an unchanged Ctrl+S writes nothing. Node always reports the file name: Windows `rename`/`change`, macOS (FSEvents) only `rename` ~45 ms late, Linux (inotify) 6–7 `change` on the `.tmp` then `rename` + `change`.

**2. Process lifetime.**

| | Windows | macOS (Bambu) | Linux |
|---|---|---|---|
| Direct launch with a file | closing the window → exit 0 (both slicers) | Cmd+W leaves it running; Quit → exit 0 | the PID is the slicer (`AppRun` `exec`s it); close not observed in CI (first-run dialogs) |
| Second launch, single instance off | a second process | a second process (two Dock icons) | a second process |
| Second launch, single instance on | exits after 0.3–0.5 s; the open window asks "open as project or import geometry" | – | – |
| `open -a` / `open -W -a` | – | exits after 0.3 s / returns at Quit | – |

A non-detached child of Node died 1 s after its parent exited on Windows; a `detached` one lived. Orca didn't answer Apple Events on the macOS runner, so macOS is concluded for Bambu only.

**2b. Installed slicers.** Registry on Windows (`DisplayVersion` drops a pre-release tag: Orca 2.5.0-alpha shows `2.5.0`; `InstallLocation` is empty, `DisplayIcon` holds the path), `Info.plist` on macOS, `flatpak list` on Linux (`2.8.2.61 Public Release`; sandbox sees `home`, `/media`, `/run/media`). A CLI slice with the GUI open works on all three (exit 0, `out.3mf` + gcode) and leaves `%APPDATA%\BambuStudio` and `%APPDATA%\OrcaSlicer` unchanged.

**3. SSE.** `node:http` SSE in Docker, published directly and behind Caddy 2.11.7, nginx 1.30.6 and Traefik 3.7.16, each with default config and with compression:
- Every path delivers each event at once, compressed or not, Caddy also over TLS + HTTP/2. Only nginx with `gzip` on `text/event-stream` and no `X-Accel-Buffering: no` delivers nothing, not even headers.
- Idle 5.5 min: without a heartbeat nginx cuts every 60 s and Node's `fetch` cuts at 300 s; with the 15 s heartbeat, no drop on any path.
- Restarting the proxy, then the server: reconnect in 1–2 s and resume from `Last-Event-ID` with no lost event.

**4. Connector size.** core + 3mf + zod, fast-xml-parser, yauzl: 5.8 MB of app.

| | Download | Installed | Update zip |
|---|---|---|---|
| Windows x64 | `setup.exe` 24.1 MB | 93 MB | 1.5 MB |
| macOS arm64 / x64 | dmg 28.2 / 30.3 MB | 114 / 116 MB | 1.4 MB |
| Linux x64 | tar.gz 45.0 MB | 126 MB | 1.4 MB |

Node is 87–120 MB of it. ADR-0011's pipeline is reused with the product as a parameter (see Packaging).

**5. Signing and warnings.** SignPath Foundation ([terms](https://signpath.org/terms)) wants a verifiable reputation for executables; the project has 0 stars, is three weeks old and has 14 installer downloads: not eligible yet. Defender (real-time and tamper protection on) found nothing in the hidden connector stand-in that read, uploaded and streamed, and recorded no detection. Edge warned at download ("not commonly downloaded"); SmartScreen showed no prompt here, even with Mark of the Web, most likely because this installer had already run on this PC, so the documented "More info → Run anyway" stays. Gatekeeper is as in ADR-0011; the TCC folder prompt and the background-item notice come from Apple's docs (no Mac here).

## Amendment (2026-10-29): Open on this machine (Step 14b)

The project page has one **Open** button instead of "Open in slicer" and "Open on my workstation". It opens the slicer on the machine the user is sitting at, decided in this order:

1. **The server's machine:** `GET /api/projects/:id/devices` returns `local: true` when the request comes from one of the server's own addresses (loopback, or any of its interfaces, so `localhost`, its LAN IP or a DNS name for it all count). Then the integration slicer opens it (`target: "slicer"`), with no lock: it edits the hub root in place. The Host is still the access guard's job (DNS rebinding). An `X-Forwarded-For` that `APP_TRUST_PROXY` didn't resolve never counts, so a proxy on the same machine doesn't make every client local. The server refuses `target: "slicer"` from anywhere else (403 `not_local`), so another computer can't start a program on the server's screen.
2. **A machine with a connector:** the page asks `http://127.0.0.1:<port>/api/whoami`. `<port>` is the one the connector reports on its event stream (`X-Connector-Port`, kept in memory with the stream), else 4301. If the answer is one of the user's online devices with a slicer, that device opens it, without a device picker.
3. **No answer** (no connector, Safari, a declined local network prompt, a timeout of 1.5 s): the user's online devices with a slicer, one without asking, several in a picker.
4. No slicer anywhere: no button.

**`GET /api/whoami` is the only route of the status page another origin can read.** It answers `{ id }` (the device id) and nothing else, with CORS only for the origin of the hub URL the connector was paired with (`Access-Control-Allow-Private-Network` for Chrome's preflight). Its Host is checked like every other route, so a DNS-rebinding page gets 403. It changes nothing. The probe is a hint: the hub still checks that the device belongs to the user and is online with a slicer before it sends `open`. A connector paired by another URL than the one the browser uses (LAN IP vs a name) doesn't match the origin, so the page falls back to step 3.

**No default slicer.** The status page can drop the default ("Ask each time"); the connector reports which slicer is the default (`default` on `PUT /api/hub/device/slicers`). With several slicers and none picked, the web app asks which one in Open's dialog and sends it as `slicer` in `open`; a single slicer always opens without asking. Before, the first one found opened.

