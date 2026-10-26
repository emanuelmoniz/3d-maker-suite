# ADR-0014: Hub and connector: central files, device roots, slice workers

- Status: Proposed (Plan 5.0.0 Step 1 runs the spikes below and accepts it)
- Date: 2026-10-26

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
- **What it is:** `apps/connector`, a small TypeScript program. It imports only `@3d-maker-suite/core` (zod schemas, so types stay single-source) and `@3d-maker-suite/3mf` (to read metadata on the device). It never imports the server.
- **Packaging:** the same pipeline as ADR-0011 (Inno Setup per user without admin, ad-hoc signed `.dmg`, `tar.gz` + `install.sh`), the same bundled Node, the same start-at-login and the same self-update with rollback. The connector follows the hub's version: it fetches the release that matches the hub, so the protocol always matches.
- **No tray icon.** It has a small status page on `127.0.0.1` (pair, hub URL, online state, sync state, open the sync folder) and a start-menu or launcher entry that opens it. Everything else happens in the web app.
- **Pairing:** only admins pair devices. An admin creates a one-time pairing code for a user in Hub management (valid 10 minutes). The connector exchanges it for a device token. The hub stores only its sha256, like sessions (ADR-0012). The device acts as that user, and revoking it ends its access at once.
- **Channel:** the connector always connects out, so devices need no open ports and no VPN. It uses REST for requests and file transfer, and one Server-Sent Events stream (`GET /api/hub/events`) for hub → device commands. A heartbeat keeps the online state. SSE is a plain Fastify reply and `fetch` streaming on the connector, so there's no new dependency.
- **Fixed operations only.** The connector carries out a closed list: list, stat, read and upload a file, write into its sync folder, move to its root's trash, create a project folder, open a file in its detected slicer, and slice (workers only). It never runs a command the hub sends. Every relative path is normalised and checked against the root on both sides: no `..`, no absolute paths, no symlinks that point out of the root.

### Hub roots: sync
- **Index:** a `hub_files` table (root, relative path, size, sha256, version, deleted, lock) and a change sequence number. A connector asks for "changes since my cursor" and stores the new cursor. Clocks are never compared across machines: only versions and hashes count.
- **Device → hub:** the connector sees a change (Node's recursive `fs.watch`) and waits until the file is stable (same size and mtime for a few seconds, and it opens for reading). It then hashes the file and uploads it with the version it started from. The hub streams the upload to a temp file, checks the hash and renames it into place. If the base version is current, the upload becomes the new version. Otherwise the hub keeps it as a conflict copy `<name> (conflict <device> <date>).<ext>` and raises an alert.
- **Hub → device:** the connector downloads changed files to a temp file next to the target and renames it into place.
- **Delete:** a local delete becomes "move to the root's trash on the hub" (the existing trash folder), never a hard delete. **Mass delete guard:** if a device deletes more than a set number of files, or a set share of a root, at once, the connector pauses and asks on its status page, and the hub raises an alert. Removing the local copy of an unselected project is not a delete.
- **Sync mode per device:** *everything*, or *selected projects*. The project page gets an **Open on my workstation** button whenever the user has an online device. The hub sends "open" to that device. The connector syncs the project if it isn't there yet, then opens the file in the local slicer. This replaces OneDrive-style placeholder files (rejected below).

### Device roots
- The connector watches the root, reads 3MF metadata locally with `packages/3mf`, and sends the index and metadata to the hub. The hub stores it the same way as a scan.
- The hub pulls a file only when it needs it (slicing, download, 3D view). The file goes into a temp cache with a size cap and an expiry, and is deleted after use.
- Write actions from the web app (create project folder, trash) run on the owning connector, inside its root.
- When the device is offline, its projects show the last known data with an "offline" badge. Nothing is lost, and the device catches up when it comes back.
- Other users can only download files in a device root. Editing someone else's files would make a machine that sleeps or leaves the office the source of truth for others. People who need shared editing use a hub root.

### Who sees what
- Permissions belong to **users and roles**, not to devices: whether someone sees all projects or only their own, and whether they may edit other people's projects in hub roots or only download them. Projects get an owner.
- What a device syncs follows its user's permissions. Files a user may only download sync read-only.
- Per-device settings cover only where and how: sync folder, everything or selected projects, slice worker.

### Locks (setting: off · on · strict)
- Opening a file through the connector (the "Open" button) takes a lock on the hub. So does the first local change to a file that wasn't opened that way. Other devices set the file read-only, and the web app shows "Being edited by `<user>` on `<device>`".
- **Release:** when the slicer process the connector launched exits (where that can be observed, see the spikes), when the user clicks Done editing (web app or status page), or after an idle timeout. An admin can force-unlock.
- **Strict:** a device that is offline can't take a lock, so its hub-root files are read-only until it reconnects. Without strict mode, a clashing offline edit becomes a conflict copy.
- These are soft locks: anyone can still copy a file out. They prevent accidents, not deliberate bypassing.

### Versions (setting: on/off, keep N)
- When an upload is accepted, the previous content moves to `<dataDir>/versions/<rootId>/<fileId>/<version>`. That's outside the root, so scans skip it and devices never sync it. When there are more than N versions, the oldest is pruned.
- Devices see only the latest version. The web app shows a file's history and lets people download older versions. Restoring is "download it, save it again". Hub management shows the disk use.

### Slicing
- **Default: on the hub**, with its desktop or managed slicer (ADR-0007, ADR-0013). For device roots, the hub pulls the file first.
- **Slice workers** for hubs that can't slice (no Bambu build for Linux arm64, a small VPS). An admin marks a device as a slice worker. Its connector installs a managed slicer as in ADR-0013: a portable download from the vendor's release into the connector's own data folder, with no admin rights and no change to the user's desktop slicer. The hub fixes the slicer version and pushes its managed config folder (presets) to the worker, so results match the hub.
- A worker shows up as one more slice-capable integration ("Bambu Studio (WS-3)") in the plate → project → default slicer pickers (4.2.0 Step 13b). The slicer version stays part of the slice cache key.

### Unsigned builds
As in ADR-0011: nothing is code-signed. The docs walk through the SmartScreen and Gatekeeper warnings, which appear once per installer. Self-updates download over HTTPS without a quarantine flag, so they don't warn again. On top of that:
- `SHA256SUMS` and GitHub artifact attestations (free) let a company's IT check where a build came from and allow it by hash or path.
- Step 1 checks whether the project qualifies for free signing for open-source projects (SignPath Foundation, Windows). macOS has no free notarisation.

## Rejected options
- **OS placeholder files (Windows Cloud Files API, macOS File Provider, FUSE):** three native code bases, a paid Apple account for File Provider, and years of work in Nextcloud's client. Syncing per project plus Open on my workstation covers the need.
- **The whole app on every workstation:** too heavy, and the workstation doesn't need the server, the database or the UI.
- **Mounting the NAS on the VPS over a VPN (SMB/NFS/SSHFS):** no file events, every scan pulls whole 3MFs over the internet, the company exposes its NAS, and workstation-only files aren't covered. It stays a documented setup for advanced users. The network-storage module is separate (Backlog).
- **A Syncthing sidecar:** no app code, but it's the duplication we want to avoid, its conflict files appear without the app knowing, and there's no link to locks, versions or permissions.
- **A WebDAV network drive served by the hub:** possible later for "browse without syncing". Windows' WebDAV client limits file size by default and is slow with large 3MFs.
- **A connector in Go or Tauri:** a second toolchain, types written twice instead of the zod schemas, and none of ADR-0011's installer, update and start-at-login code reused. Go would be smaller (≈10 MB against ≈45 MB with Node), but size isn't the constraint.
- **WebSockets:** `@fastify/websocket` would be a new dependency. One-way SSE plus REST is enough.
- **Running the vendor's slicer installer on workstations from the hub:** it needs admin rights and touches the user's desktop install. Managed portable downloads (ADR-0013) need neither.
- **Editing other users' files in device roots:** it makes an unreliable machine the source of truth for others. Use a hub root.
- **Permissions per device:** everyone sitting at a shared workstation would get its rights.
- **Users pairing their own devices:** every device that can upload files and run slice jobs is an admin decision.
- **Comparing mtimes across machines:** clocks drift. Only versions and hashes count.

## Risks and mitigations
- **How slicers save** (overwrite in place vs temp + rename, several writes per save): the stability check plus the upload's hash. Step 1 records Bambu Studio's and Orca's save pattern on each OS.
- **Single-instance slicers** (macOS `open`, Bambu's single-instance option): the launched process may exit at once, so "process exited" can't release the lock. Done editing and the idle timeout always work. Step 1 checks what can be observed on each OS.
- **Company antivirus or EDR flags an unsigned background program that uploads files:** attestations, checksums, a fixed install path and an IT page in the docs. Free signing if the project qualifies.
- **Reverse proxies buffering SSE:** `X-Accel-Buffering: no`, a comment heartbeat every 15 s, and reconnecting from the cursor. Step 1 tests Caddy, nginx and Traefik.
- **Bandwidth and disk** (large 3MFs, full copies, versions): whole-file transfer only when the hash changed, selected-projects mode, the version cap, and disk use shown in Hub management.
- **A device that's lost or stolen:** revoke it in Hub management, which ends its token at once. Local copies stay on its disk (the same as any synced folder).

## Consequences
- Plan 5.0.0: the hub switch and root locations, Hub management and pairing, the connector and its installers, device roots, sync of hub roots, locks, versions and slice workers.
- `managedSlicer` download and unpack moves out of `apps/server` into a package both the server and the connector use.
- The release workflow builds connector installers next to the app installers. Their versions stay in sync.
- Out of scope, kept for later: printing from the web app (both locations can give the hub the sliced file), a WebDAV drive, restoring a version in place, several users on one shared workstation.

## Spikes for Step 1
1. Bambu Studio and OrcaSlicer save patterns on Windows, macOS and Linux, and what Node's recursive `fs.watch` reports for them.
2. Whether a slicer launched with a file keeps a process alive until its window closes, on each OS.
3. A long-lived SSE stream through Caddy, nginx and Traefik, and Docker's port mapping, with reconnects.
4. The connector bundle size with Node, and how much of ADR-0011's pipeline it reuses unchanged.
5. Whether the project qualifies for SignPath Foundation, and how SmartScreen and Gatekeeper treat the unsigned connector.
