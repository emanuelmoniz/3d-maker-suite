# ADR-0024: The connector on ARM, in Docker and on a NAS

- Status: Accepted (2026-11-20, after the Plan 6.3.0 Step 1 spikes, see Spike results). Amends ADR-0014 (packaging, pairing without a screen, a code's lifetime) and ADR-0009 (the connector's Docker row), see their 2026-11-20 amendments.
- Date: 2026-11-20

## Context
The connector (ADR-0014) is packaged for desktops only: Windows, macOS, and Linux x64 with an application menu and an autostart `.desktop` file. Its pair page answers on `127.0.0.1:4301` only, and there is no ARM build and no image. So a NAS, a Raspberry Pi or a headless server can't be paired, although a NAS is the natural place to keep a team's project files and to reach the printers on its network.

Plan 6.3.0 brings the connector there without changing its protocol: pairing, the closed list of operations, the device token, "one hub per machine" and "follows the hub's version" stay as ADR-0014 has them. This ADR decides packaging, pairing without a screen, updates, file owners, printers and folders in a container, which install fits where, and how ARM is built. Some points were decided with the user before the spikes (marked), the rest after them.

## Decision

### Where each install fits (decided with the user)
| Machine | Install |
|---|---|
| NAS (Synology, QNAP, Asustor), any server with Docker, private servers included | the connector image: isolated, runs as a chosen user, sees only its mounts, listens on nothing outside the container |
| Raspberry Pi or Linux server without Docker | the Linux archive with `install.sh --headless` (a systemd user service) |
| Windows Server x64, with or without a desktop (Server Core) | the Windows installer for all users (`/ALLUSERS`, and `/HEADLESS` when silent): a scheduled task at boot, as the installing administrator (S4U), or as a named account with its password for network shares (6.3.0 Steps 3b and 5b) |
| Desktop (Windows, macOS, Linux with a desktop) | the installer, as today |

NAS systems don't let users add services, so they use the image. A connector in Docker joins a hub that runs elsewhere, or in another container; it is never a hub.

### Pairing with no local browser (decided with the user)
- The hub URL and the one-time code come from environment variables, or flags for the archive: `CONNECTOR_HUB_URL` / `--hub-url`, `CONNECTOR_PAIRING_CODE` / `--pairing-code`, optional `CONNECTOR_NAME` / `--name` (default: the host name). There is no other pairing path.
- The first start pairs. The device token stays in the data folder (`state.json`, encrypted with `secret.key` beside it), so a restart and an image update keep the pairing and the code is ignored from then on (S2 cases 2 and 3).
- **A refused code (agreed with the user after S2):** the connector stays up, unpaired. It logs one plain line ("the pairing code is wrong, used or expired: make a new one in Hub management and set it in `CONNECTOR_PAIRING_CODE`"), and keeps a hash of the refused code in its data folder so it never sends that code again, across restarts too. A new code in the variable is tried at the next start. It doesn't exit: `restart: unless-stopped` restarts whatever the exit code, and the resulting loop locked pairing out for 15 minutes for every device behind that address, valid codes included (S2 case 7). The hub answers the same 401 for a wrong, used and expired code, so the message names all three.
- **A revoked connector** forgets its token as today. The used code still in its variable is one it was refused or paired with, so it isn't sent again (S2 case 6 sent it at every start).
- **A code for a NAS, server or container lasts 24 hours (agreed with the user).** Setting up a container (copying lines into a NAS's web UI, pulling the image) can take longer than the 10 minutes of a desktop code. The admin picks the kind when making the code (Plan 6.3.0 Step 7). An unused code shows in Hub management with **Withdraw**, since it now outlives the admin's visit. Desktop codes keep 10 minutes.
- **Change user** on a headless connector is done by an admin on the hub, with no code: the code proves someone is at the machine, which a machine with no screen can't do. The connector reports that it is headless (archive `--headless`, or Docker).

### The local page
- In the image and in a headless install the status page stays on loopback for `/api/health` (the container's `HEALTHCHECK`, the launcher's checks). The compose example publishes no port, so nothing is reachable from the network. Desktops keep the page as it is.
- The two actions only the local page has get a hub path for every connector (a missing sync folder's **Delete on the hub too** and **Restore them**): new fixed operations, amended into ADR-0014 by Plan 6.3.0 Step 2.

### Updates
- A bundle install, headless included, keeps updating itself to the hub's version, including `linux-arm64` (the asset is already named by `process.arch`).
- A container can't replace its own image (same rule as the app, ADR-0009). With `APP_INSTALL=docker`, set by the image, the connector doesn't download a bundle (S3: no attempt) and doesn't register a start at login. It sends its install kind with its version, so the hub's **Outdated** shows the command (`docker compose pull` and `docker compose up -d`) instead of waiting for an update that never comes. Without that, a Docker connector and a bundle one that hasn't updated yet look the same to the hub (S3).

### File owner: `PUID` and `PGID` (decided with the user)
- The app image and the connector image share one start script. As root, it gives `/data` to that user, changing only the entries whose owner or group differs (10,003 entries in 54 ms on the first start, 0 in 19 ms on the next, S4). It never touches mounted project folders. Then it drops to that user with `setpriv --reuid --regid --clear-groups` (util-linux, already in `node:22-trixie-slim`; no new dependency) and starts the program.
- Without the variables it stays root, so existing installs keep working after the update.
- **The images start the program with `node`, not `pnpm`.** The app image's `pnpm --filter … start` goes through corepack, which downloads pnpm again into the new user's home and then fails on `node_modules` (permission denied), or at the download when offline (S4). Started directly it runs as any user, offline too.
- **The connector image is built from the connector's archive contents** (the pruned tree `packaging/build.mjs` makes, 133 MB installed) on `node:22-trixie-slim`, not from the source tree (630 MB in the spike).

### Printers from a container
- Every adapter's traffic goes out from the connector (MQTT over TLS, FTPS, HTTP, WebSocket), so a typed address works in every network mode (S5). Only Bambu LAN's discovery listens for something sent to it: the printer's announce on UDP 2021 and 1990.

  | Mode | Broadcast | Multicast | Typed address |
  |---|---|---|---|
  | bridge | no | no | yes |
  | bridge, UDP 2021 and 1990 published | yes | no | yes |
  | host | yes | yes | yes |
  | macvlan | yes | yes | yes |

- **The compose example uses host networking (agreed with the user).** Discovery works whichever of broadcast or multicast the printer uses. There are no ports to publish or keep free, and it doesn't depend on Docker's port forwarder. The connector's page binds the host's loopback, so it is still not reachable from the network. NAS container apps offer host networking as a switch. A commented bridge variant is kept for those who type printer addresses.
- A connector in host networking on the same machine as a hub refuses to start, as on a desktop (S2 case 8): one hub per machine. A NAS that runs the hub doesn't need a connector to reach its own network.
- Where discovery hears nothing, the printer setup says so in plain words and asks for the address (Plan 6.3.0 Step 6). Which destination a real Bambu printer uses is checked there on the user's A1.
- Which adapters work in which mode, per adapter, is recorded here by Plan 6.3.0 Step 6.

### Folders on shares
- A folder on the machine's own disk sends change events into the container, bind mount or volume, including new subfolders and bursts (S6). That is a NAS's usual case: its own shared folders are local disks, and SMB clients write through the NAS's samba.
- A share the connector's machine mounts from elsewhere (SMB, NFS) sends events only for changes made through that mount. Changes made on the server or by another computer send none, though a listing sees them at once. The scheduled rescan (`roots.rescan`, hourly by default) covers them. The machine page says when a root lives on such a share and is only rescanned (Plan 6.3.0 Step 5).
- **A share that drops and comes back** leaves the watcher silent, with no error (S6). The connector, and the hub's scanner for its own roots, watch a root again when it is back after being missing, at the rescan that finds it (Plan 6.3.0 Step 5).
- **A share mounted on the host after the container started** is invisible with Docker's default bind propagation. The compose example mounts shares with `bind-propagation: rslave`, which sees it, and sees it go (S6).

### Headless Linux install
- `install.sh --headless` installs the same files as today and a systemd **user** service (`~/.config/systemd/user/3d-maker-suite-connector.service`) running `launcher.mjs --background --headless`. The spike used `Restart=always`, because `on-failure` didn't restart a connector killed by a signal: the launcher reported that as exit 0 (S7). Step 3 amends this, see the amendment at the end. `systemctl --user stop` stops it.
- It runs at boot without a login only with linger. The installer runs `loginctl enable-linger` and, when that is refused, prints the `sudo` line to run once. Without linger the service stops when the user's last session ends (S7). A system service would need sudo to install and isn't used.
- Under a headless install the connector doesn't write the desktop autostart file. Today it does, and the launcher sets `APP_LAUNCH_CMD`, so on a Pi with a desktop it would start twice (S7).
- `install.sh --uninstall` removes it again (Plan 6.3.0 Step 7c).

### ARM builds (decided with the user)
- The `linux-arm64` archives of the connector **and the app** are built on a native ARM runner (`ubuntu-24.04-arm`): the same build times and sizes as x64, and the app starts on the `linux-arm64` `better-sqlite3` prebuild (S1).
- The app and connector images are multi-arch: each architecture is built on its own native runner and merged into one tag with `docker buildx imagetools create`, so `docker pull` picks the right one. Not QEMU: the app image took 8.4 times as long under it (S1). The ARM pairing test runs on the native runner too, so no test needs QEMU. The `-slicer` image stays x64 only (see No slicing on ARM).

### No slicing on ARM (agreed with the user after S1)
- An ARM machine doesn't slice in 6.3.0: no managed slicer install, no slice worker. **This server** under **Where** is greyed out for both slicers on an ARM server, with the reason. The server refuses the install with a clear error. The slice worker switch is greyed out on an ARM machine. Slicing goes to the hub or a slice worker on x64 or a Mac.
- Today nothing checks the architecture before an install (`packages/host/src/slicerInstall.ts`): on ARM it would download an x64 AppImage and fail.
- The `-slicer` image stays x64 only and says so in its description.
- OrcaSlicer could slice on ARM (S1), and the user chose to leave it out for a simpler plan; see Rejected options.

### Names
- Image `ghcr.io/emanuelmoniz/3d-maker-suite-connector`, tags as the app's: `X.Y.Z` and `latest` for stable releases, `X.Y.Z-alpha.N` and `dev` for pre-releases.
- Compose example `docker-compose.connector.yml`, next to `docker-compose.yml`.

## Rejected options
- **Exit on a refused code.** In Docker it is a restart loop that locks pairing out for the whole address (S2).
- **A status page reachable from the LAN for pairing.** It needs a login of its own on a machine with no screen; environment variables do the job and leave nothing listening (decided with the user).
- **Self-update inside the container.** The next `docker compose pull` would bring the old version back, and the image would need write access to its own program.
- **QEMU builds.** 8.4 times slower in the spike, and emulated `pnpm install` is a known source of flaky builds; native ARM runners are free for public repositories.
- **Bridge networking with published UDP ports as the default.** It hears broadcasts only, needs 2021 and 1990 free on the host, and depends on Docker's userland proxy.
- **A system service for the headless install.** It needs sudo to install; a user service with linger needs it at most once, for linger.
- **A polling watcher for shares.** The rescan already reads the folders that changed; polling would read every folder every few seconds on the slowest disks.
- **OrcaSlicer on ARM in 6.3.0** (left out by the user after the spike, for a simpler plan). It works:
  - Orca has published a Linux aarch64 AppImage since 2.4.0, and 2.5.1 sliced a fixture on the ARM runner as the `PUID` user, with the app's own CLI flags (S1). Bambu Studio publishes x64 only.
  - It would need Orca's `aarch64` asset in the managed install, a multi-arch `-slicer` image, a per-slicer rule for ARM slice workers, and a test on a small board: speed and the 10-minute slice limit on a Pi or an ARM NAS are unmeasured.
  - It can come in a later plan on this evidence.

## Risks and mitigations
- **A 24-hour code sits in a compose file.** It is single-use, works only for pairing, can be withdrawn while unused, and is ignored once the device is paired.
- **Host networking gives the container the host's network stack.** The connector listens only on loopback, and the image runs as the `PUID` user.
- **`rslave` and NAS UIs.** Some NAS container UIs can't set bind propagation; there, a share mounted later needs the container restarted. The wiki says so, and the machine page reports a missing root.
- **Not tested on NAS hardware or a real printer.** Everything here ran on GitHub's runners with a simulated printer. Plan 6.3.0 Step 6 tests the A1, and Step 9 a real NAS or server.

## Consequences
- Plan 6.3.0 Steps 2 to 7 follow this ADR. Step 2: headless start, refused codes, install kind; Step 3: ARM archives, `--headless`; Step 4: images, `PUID`/`PGID`, the start command, slicers greyed out on ARM; Step 5: re-watching a returning root, `rslave`; Step 6: per adapter, the A1; Step 7: the pairing choice, 24-hour codes, **Withdraw**.
- The README support matrix gains Linux ARM64 and Docker for the connector, and Linux ARM64 for the app; slicing stays on x64 and macOS.
- The release workflow gains native ARM runners and a multi-arch merge for the app and connector images; the `-slicer` image stays x64.

## Spike results (2026-11-20)
Scripts, logs and details: branch `spike/connector` (`spike/connector/NOTES.md`, not merged). GitHub runners `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` (arm64), Docker 28.0.4, Node 22, app and connector 6.2.0. Runs 44814580829 (all), 44816519547 (S6 again), 44817797801 (slice). The printer is simulated (agreed with the user).

**S1. ARM64.**

| | x64 | arm64 (native) |
|---|---|---|
| app / connector archive build | 18 s / 7 s | 18 s / 7 s |
| app `.tar.gz` / update `.zip` | 62.0 / 23.7 MB | 61.8 / 23.7 MB |
| connector `.tar.gz` / update `.zip` | 47.9 / 4.6 MB | 47.7 / 4.6 MB |
| app archive healthy after start | 1.6 s | 2.1 s |
| `pair-test.mjs` (pair, rename, revoke) | passed | passed |
| app image, native build | 44 s, 1.34 GB, healthy | 50 s, 1.32 GB, healthy |
| `-slicer` image, native build | 60–83 s, 1.93 GB | 74 s, 1.91 GB |
| OrcaSlicer 2.5.1 CLI slice as `PUID` | exit 0, 84,922 bytes | exit 0, 84,900 bytes |

The app image for arm64 under QEMU on x64: 421 s. Two native connector images merged with `imagetools create`: one tag, a pull on amd64 picks amd64; the arm64 one under QEMU paired in 21.3 s (amd64: 1.4 s).

**S2. Pairing from environment variables** (container in bridge, hub at the gateway). First start: online in 1.4 s, healthy. `docker restart` and a container recreated on the same volume: online, same device, code not sent. Wrong and expired code: `invalidCode` (the same 401), container up. Revoked and restarted: the used code sent again. Exit on refusal under `unless-stopped`: 11 restarts in 120 s, 5 × `invalidCode` then 6 × `tooManyAttempts`; a valid code from that address then got 429; sign-in from it 200. Host networking beside a hub: exit 1, "a hub is running on this machine".

**S3. Updates in Docker.** Hub 6.3.99, connector 6.2.0 with `APP_INSTALL=docker`: listed `outdated: true`, `updateFailed: null`; 0 download attempts; nothing on the local page.

**S4. `PUID` / `PGID`.** `setpriv` in the base image (util-linux 2.41.5). A root `/data` with 10,000 files: 10,003 entries in 54 ms, then 0 in 19 ms; process `Uid 1001`, `Gid 1001`, no groups. A file in a bind mount: `runner:runner` with `PUID`, `root:root` without. The app image's `pnpm` start as 1001: corepack downloads pnpm, then `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR` (permission denied); offline it fails at the download; `tsx` directly: healthy, offline too.

**S5. Printers** (a network namespace on a bridge as the LAN; the A1's announce by every path, mosquitto with TLS, HTTP and a WebSocket). See the table under Printers from a container.

**S6. Folders.** Local folder (bind or volume): events in 2–84 ms, new subfolders, 50 of 50 files right after `mkdir`. SMB and NFS mounted on the host: events for changes through the mount (3–37 ms), none for changes on the server, which a listing sees at once. A share dropped and remounted: the watcher reported every file at the drop, then nothing, no error. A share mounted after the container started: 0 entries in a default container, all of them with `rslave`.

**S7. Headless install** (both arches). User service up in 1.1 s; pairing from `Environment=`: online. `Restart=on-failure`, connector killed with `-9`: stays down, unit inactive; `Restart=always`: back; `systemctl --user stop` stops it. `disable-linger`: it stops. A system unit: up, still paired. The connector also wrote the desktop autostart file under systemd.


## Amendment (2026-11-20): Linux ARM64 archive and headless install (6.3.0 Step 3)
- **`Restart=on-failure`, not `always`.** Step 3 makes the launcher exit with 128 plus the signal's number when its program dies from a signal (it was 0), so `on-failure` restarts a kill, which was the only reason for `always` (S7). `always` would also restart the connector after **Stop connector** (exit 0), so a stop asked for on the hub would undo itself within seconds. A SIGTERM that follows the launcher's own SIGTERM (`systemctl stop`) is a clean stop, exit 0. `RestartSec=5`, so a crash loop is slow and systemd's start limit never trips.
- **`install.sh --headless`** takes `--hub-url`, `--pairing-code` and `--name` (or `CONNECTOR_HUB_URL`, `CONNECTOR_PAIRING_CODE`, `CONNECTOR_NAME`) and writes them as `Environment=` lines, quoted for systemd, in a unit only its user can read. Run again without them, it keeps the lines it has. It writes no `.desktop` file, runs `loginctl enable-linger` and prints the `sudo` line when that is refused, then enables and restarts the service. The app's archive refuses `--headless`: the app has no headless install, Docker is its route.
- **Tests on both architectures** (`connector.yml`, `scripts/headless-test.mjs`, on `ubuntu-24.04` and `ubuntu-24.04-arm`): pairing from the service's `Environment=`; SIGKILL of the program and then of the launcher (the same device comes back); **Stop connector** and `systemctl --user stop` stay stopped; and an update: the hub restarts on a higher version, and the connector downloads that version's `linux-<arch>` zip from a local stand-in for the release folder (`APP_DOWNLOAD_URL`) and follows it.

## Amendment (2026-11-21): Windows Server headless install (6.3.0 Step 3b)
On Windows the connector starts at sign-in and pairs on its page in a browser, so a Windows Server with nobody signed in, or Server Core, had no setup. Docker isn't a route there: the image is Linux.

**Spike S8** (a workflow_dispatch test build on GitHub's Windows Server 2022 and 2025 runners, the same results on both). Each start was made by the Task Scheduler or the service manager in session 0, with nobody signed in as its account. A real reboot can't run on a hosted runner; the real test in Step 9 does one.

| | Task, installing admin, S4U | Task, named account + password | WinSW 2.12 service | NSSM 2.24 service |
|---|---|---|---|---|
| Starts, pairs | yes, 1 s | never ran: the account lacks the batch logon right (0x80070569), which Windows doesn't grant | yes | yes |
| Exit 75 (self-update) | yes, inside the launcher | – | yes | yes |
| Program or launcher killed | **not restarted**: "restart on failure" doesn't react to an exit code | – | back in 5–8 s | back in 0.5–2.5 s |
| **Stop connector** (exit 0) | stays down | – | **stuck "Running" with no process**: as a non-admin WinSW can't report the stop | stays down |
| Its own stop | nothing left running | – | nothing left | nothing left |
| Data folder, files | the account's `%APPDATA%` | – | the account's, owned by it | the same |
| Password, dependency | none, none | password, none | password, a .NET exe | password, an exe unmaintained since 2014–2017 |

The task's default priority 7 runs it BelowNormal, and its default limit of 72 hours would end it. A second run with the launcher restarting its program: a killed program was back after 5 s in the same task instance; exit 75, **Stop connector** (result 0) and the task's stop worked; with priority 5 it runs Normal; a killed launcher stayed down.

**Decision (with the user):** the **scheduled task, as the installing administrator, S4U**, and **a headless launcher starts its own program again after a crash**. No new dependency, no stored password.
- **The launcher** (`packaging/launcher.mjs`), when headless (`--headless` or `CONNECTOR_HEADLESS`, the connector's own rule), starts a program that exited with anything but 0 or 75 again: after 5 s, doubling up to 5 minutes, starting over once a run lasted 10 minutes. On Linux too: systemd still restarts a killed launcher (`Restart=on-failure`), so the amendment above holds for the launcher's own exit. On Windows a killed launcher stays down until `Start-ScheduledTask` or the next boot, which the user accepted. A stopped task's program ends a moment after its launcher, so a task run again at once found it still answering, took it for a running connector and exited, leaving none (found in Step 3b's CI): a headless start that finds one answering waits up to 15 s for it to go, then starts, or logs `already running` and exits.
- **The task** (`packaging/headless-task.mjs`, run by the installer elevated with the bundled Node): `3D Maker Suite Connector`, a boot trigger, S4U as the installing account, `LeastPrivilege`, priority 5, no time limit, one instance, `launcher.mjs --background --headless` with the hub address, code and name as arguments (the task is readable by administrators only). Run again without them, it keeps the ones the task has. It refuses an install elevated as another account: the files would be in one profile and the task would run as another.
- **The installer** (`setup.iss`): an unchecked headless task and a hub page; silent, `/HEADLESS /HUBURL= /PAIRINGCODE= [/NAME=]`, exit code 8 when the task couldn't be added. Headless means no Run value, no shortcuts and no launch at the end. A marker file keeps a later setup and the uninstaller on the headless path; the uninstaller ends and deletes the task before the files go (Step 7c adds the unpairing).
- **Limits.** The installing account must be an administrator (S4U needs the batch logon right). An S4U task has no network credentials, so a sync folder on an SMB share isn't reached; a named account with its password is Plan 6.3.0 Step 5b. Windows on ARM has no headless install. *(Step 5b: the install moved to Program Files and the same-account refusal went, see its amendment below.)*
- **Tests:** `connector.yml` `headless-windows` on `windows-2025`: the silent install pairs from the task's arguments; the program killed comes back; the launcher killed stays down until the task runs again; **Stop connector** and the task's stop stay down; a newer test build is followed (`APP_DOWNLOAD_URL` in the user's environment); the uninstaller removes the task.

## Amendment (2026-11-21): Container images for x64 and ARM64 (6.3.0 Step 4)
- **Two images, one Dockerfile.** The default target is the app, as before. `--target connector` is the connector, `--target slicer` the x64 slicer image. The connector's stage runs `node packaging/build.mjs --product connector --image /connector`, which makes the tree of the archive from the working tree (no git in the build, links left in place, no Node, launcher, zip or installer) and keeps only that on a clean `node:22-trixie-slim`.
- **Start script.** `docker/entrypoint.sh` is the one script of both images: `PUID`/`PGID` (one set takes the other's number), `chown` of `APP_DATA_DIR` for the entries that differ (`find -xdev`, so a share mounted inside it stays as it is; links changed, not followed), `HOME=/data` (the connector's sync folder lives under it), then `setpriv --reuid --regid --clear-groups`. Started as another user (`user:`) or with neither variable, it only starts the program.
- **Start commands.** The app: `node --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/server/src/main.ts`, from `/app`, where `docker compose exec app pnpm user:reset-password` still finds its script. The connector: `node src/main.ts`, from `apps/connector`. Both are PID 1 after the script's `exec`, so a stop signal reaches them.
- **Releases.** `release.yml`: `docker` builds each architecture on its own runner (`ubuntu-latest`, `ubuntu-24.04-arm`) and pushes the app, connector and (x64) slicer images by digest, with no provenance or SBOM entries so the index holds only the two images. `docker-merge` joins them with `docker buildx imagetools create`: `X.Y.Z` and `latest`, or `X.Y.Z-alpha.N` and `dev`, and `-slicer` for the slicer. A test build (`workflow_dispatch`) pushes under `X.Y.Z-build.N` only, `docker-verify` runs `scripts/image-test.sh` on what was pushed on both architectures, and `docker-cleanup` deletes that tag and the untagged per-architecture images made since the run began.
- **No slicing on ARM, in code.** `slicingSupported(system)` (`packages/core`) is false for Linux on ARM only: Apple silicon and Windows on ARM are as before. `installable()` returns nothing there, `GET /api/integrations/adapters` says `managed.supported: false`, and `POST …/slicer/install` on this server answers 409 `slicing_unsupported` before any download. The add form greys **This server** under **Where** with the reason, and an existing install's card says so instead of offering **Install slicer**. A worker's device is judged by the hub as before (its Linux ARM system finds no asset); greying out the slice worker switch is Step 5b.
- **Tests.** `images.yml` builds both images on both native runners and runs `scripts/image-test.sh`: the app as `root` without `PUID` and started with node; a slicer install refused on ARM and offered on x64; a connector in host networking pairing from its variables as `PUID` 1234, keeping the pairing across a restart and across a container made again on the same volume; `/data` entirely owned by that user; and the app writing a project folder and a file into a mounted folder owned by that user. No test needs QEMU.
- **Not tested here.** A managed slicer installed into `/data/slicers` and run as the `PUID` user: the spike did it with Orca, and the new start script doesn't touch `slicers/` beyond its `chown`. Bridge-mode printer discovery in the compose example's commented variant.

## Amendment (2026-11-22): Files on a NAS (6.3.0 Step 5)
- Built as in "Folders on shares" above; the protocol part is in ADR-0014's amendment for this step (`mount` in the index, `EROFS`, the root check).
- **Share detection.** `mountOf` (`packages/host/src/mounts.ts`) reads `/proc/self/mountinfo` and takes the longest mount point that holds the root's real path; `cifs`, `smb3`, `smbfs`, `nfs`, `nfs3`, `nfs4` and `fuse*` count as shares. Windows: a UNC real path (a mapped drive resolves to one). macOS: not detected, so a root there is never labelled **Rescanned only**.
- **Watching again.** `folderIdent` (device and inode) is compared at every look. A bind mount into a container shows the host path's identity, so a share mounted again on the host under `rslave` changes it.
- **Not covered:** an unmounted share whose empty mount-point folder remains is indexed as an empty root (the folder is there); the connector can't tell it from an emptied folder. The rescan after the share is mounted again brings the projects back.
- **Tests:** temp folders for read-only (the mount is injected), a missing root that appears, and the share's mount in the index; a POSIX-only test replaces the folder under the watcher; one e2e spec for the labels. Real SMB and NFS shares are for the real-NAS test in Step 9.

## Amendment (2026-11-22): Windows headless as a named account (6.3.0 Step 5b)
The S4U task of Step 3b has no network credentials, so a project folder on `\\nas\share` wasn't reached. S8's named-account variant never ran, because the account lacked the batch logon right (`0x80070569`).

**Spike S9.** Five workflow_dispatch runs on GitHub's Windows Server 2022 and 2025 runners (branch `spike/winshare`), with the same results on both. A local account `ciconn` was made with `New-LocalUser` (no password on a command line), and a share `\\localhost\ci` on the runner.

| | Result |
|---|---|
| A Password task, account without the batch right | registers, never starts (`0x41303`, the scheduler's log: `LogonUserExEx` 0x80070569) |
| The right through the LSA API (`LsaAddAccountRights`, C# in `Add-Type`) | 11 to 17 ms; `Add-Type` itself 3 to 5 s; adding it twice is fine; `LsaRemoveAccountRights` takes it back |
| The right through `secedit` export, edit, configure | works too, changes only the `SeBatchLogonRight` line; not used (temp files, the whole area written back) |
| The password to `Register-ScheduledTask` on stdin | must be base64 of UTF-8: stdin to `powershell.exe` is read in the OEM code page, and a `ü` made every registration fail ("the user name or password is incorrect"); with base64, a password with a space, `"`, `'`, `$` and `ü` registers. A wrong one is refused at registration, and the error doesn't echo it |
| The connector as the account from the admin's `%LOCALAPPDATA%\Programs` (Modify granted) | **doesn't start**: Node `lstat`s every parent of its main script (`realpathSync`) and gets EPERM on `C:\Users\admin\AppData`; a probe script in `C:\probe` ran from the same Node |
| The same from `C:\Program Files\3D Maker Suite Connector` | starts in 1 s, launcher and program owned by the account. Its profile is made at the first start, and `%APPDATA%` and `homedir()` point into it. A Machine-scope variable is seen, the admin's User one isn't. With the admin's data folder copied into its profile, it is the same device on the hub |
| `icacls <dir> /grant acct:(OI)(CI)M /T` | fails on `node_modules` paths over 260 characters; without `/T` the inheritable entry reaches every file |
| A handoff folder: `/inheritance:r`, then the account, Administrators and SYSTEM | the account reads a file put in after the ACL (written before, the file kept no entry) |
| `\\localhost\ci` as the account | read, write, `fs.watch` events for changes through the share, on its local folder and by another user, in under 0.5 s. The root is indexed as `smb`, share |
| `\\localhost\ci` from the S4U task | **also works**: a loopback share reuses the local logon, so CI can't show S4U's limit on a real share |
| The account's password changed | the task can't log on (`0x8007052E`, logon failure) and nothing starts; registered again with the new one, it is back at once |

**Decision (with the user):**
- **Every headless install is per-machine**, in `C:\Program Files\3D Maker Suite Connector` (`{autopf}`, HKLM uninstall entry), with `/ALLUSERS` on the command line (`PrivilegesRequiredOverridesAllowed=commandline`). Setup for all users is always headless. `/HEADLESS` without `/ALLUSERS` exits 1, a per-user wizard that ticks headless says how to start it, and an existing desktop connector of the same account is refused. Desktop installs don't change. Headless wasn't in a release yet, so there is nothing to migrate.
- **Named account:** `/ACCOUNT=DOMAIN\name` (`.\name` is local) with `/PASSWORDFILE=` (read and deleted at once), or the hub page's **Run as** and **Its password**. The task is LogonType `Password`, `LeastPrivilege`, and the account gets `SeBatchLogonRight` through LSA, after a batch logon check. Without `/ACCOUNT` it runs S4U as the installing administrator, as before. The install-account refusal of Step 3b is gone: the files no longer sit in a profile.
- **Updates without the password:** run again with nothing changed, a Password task is kept and started. Any change to the address, code or name needs the password again (exit 5).
- **Switching account** keeps the device. `headless-task.mjs` copies the old account's data folder into `handoff\`, which only the new account (and Administrators, SYSTEM) can read, and the launcher moves it into its own data folder at the next start.
- **Taken back:** the old account's folder grant, and the batch right if setup granted it, on a switch or uninstall. That is recorded in `headless-account.json`.
- **No gMSA:** there is no domain to test on; it is refused (exit 4).
- **A password change** stops the task; the connector can't tell. Hub management shows it offline, and the fix is to run setup again with the new password.
- **Exit codes** of `headless-task.mjs`, which setup turns into messages (setup exits 8): 3 can't sign in, 4 no such account or a gMSA, 5 password needed, 6 a policy refuses the batch logon (a domain GPO that sets it replaces a local grant).
- **No dependency:** `packaging/headless-account.ps1` (Windows PowerShell 5.1) holds the LSA, LogonUser and `Register-ScheduledTask` calls. Setup runs elevated, so it uses `Exec` and its exit code (the `.result` file went), and it logs only the command, not the arguments with the pairing code.
- **Tests:** unit tests for the task XML of both logon types, account names, password files in UTF-8, UTF-16 and ANSI, the keep, switch or ask decision, and the handoff. `connector.yml` `headless-windows` on `windows-2025` covers:
  - `/HEADLESS` without `/ALLUSERS` refused, then the S4U install and its checks;
  - a switch to `.\ciconn`: the same device, data in its profile, the batch right and the folder grant, no secret in any log;
  - the checks again as `ciconn`, then `headless-test.mjs share`: a root on `\\localhost\ci`, indexed as a share, a project folder found, one made through the hub, one added on disk;
  - a password change, and the update (`APP_DOWNLOAD_URL` at Machine scope);
  - the uninstaller taking the right back.
- **Not tested here:** a share on another machine, where S4U really fails, and a domain account, left for the real test in Step 9.
