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
- `install.sh --headless` installs the same files as today and a systemd **user** service (`~/.config/systemd/user/3d-maker-suite-connector.service`) running `launcher.mjs --background`, with `Restart=always`. `on-failure` didn't restart a connector killed by a signal, because the launcher reports that as exit 0 (S7). `systemctl --user stop` still stops it.
- It runs at boot without a login only with linger. The installer runs `loginctl enable-linger` and, when that is refused, prints the `sudo` line to run once. Without linger the service stops when the user's last session ends (S7). A system service would need sudo to install and isn't used.
- Under a headless install the connector doesn't write the desktop autostart file. Today it does, and the launcher sets `APP_LAUNCH_CMD`, so on a Pi with a desktop it would start twice (S7).
- `install.sh --uninstall` removes it again (Plan 6.3.0 Step 7c).

### ARM builds (decided with the user)
- The `linux-arm64` archives of the connector **and the app** are built on a native ARM runner (`ubuntu-24.04-arm`): the same build times and sizes as x64, and the app starts on the `linux-arm64` `better-sqlite3` prebuild (S1).
- The images are multi-arch: each architecture is built on its own native runner and merged into one tag with `docker buildx imagetools create`, so `docker pull` picks the right one. Not QEMU: the app image took 8.4 times as long under it (S1). The ARM pairing test runs on the native runner too, so no test needs QEMU.

### Slicing on ARM (agreed with the user after S1)
- **OrcaSlicer works on Linux ARM64.** It has published an aarch64 AppImage since 2.4.0, and 2.5.1 sliced a fixture on the ARM runner, as the `PUID` user, with the app's own CLI flags (S1). Bambu Studio publishes x64 only.
- So on ARM: the managed install picks Orca's `aarch64` AppImage; the `-slicer` image is multi-arch like the others (it builds natively on ARM, S1); an ARM machine can be a slice worker for Orca. Bambu Studio is greyed out under **Where** on an ARM server or machine, with the reason, and the server refuses its install with a clear error (today nothing checks the architecture before an install, `packages/host/src/slicerInstall.ts`).

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
- **No slicing on ARM.** It was the plan's assumption until the spike showed OrcaSlicer's ARM build slicing.

## Risks and mitigations
- **Slicing on small ARM boards.** The spike's ARM runner is a server-class machine and the fixture was one small part (1 s). A Raspberry Pi or an ARM NAS is much slower, and many have 1 to 2 GB of memory; a big project may hit the 10-minute slice limit (`SLICE_TIMEOUT_MS`) or run out of memory. The real test (Plan 6.3.0 Step 9) slices a real project on the user's hardware. A timed-out or killed slice already fails with its reason.
- **A 24-hour code sits in a compose file.** It is single-use, works only for pairing, can be withdrawn while unused, and is ignored once the device is paired.
- **Host networking gives the container the host's network stack.** The connector listens only on loopback, and the image runs as the `PUID` user.
- **`rslave` and NAS UIs.** Some NAS container UIs can't set bind propagation; there, a share mounted later needs the container restarted. The wiki says so, and the machine page reports a missing root.
- **Not tested on NAS hardware or a real printer.** Everything here ran on GitHub's runners with a simulated printer. Plan 6.3.0 Step 6 tests the A1, and Step 9 a real NAS or server.

## Consequences
- Plan 6.3.0 Steps 2 to 7 follow this ADR. Step 2: headless start, refused codes, install kind; Step 3: ARM archives, `--headless`; Step 4: images, `PUID`/`PGID`, the start command, the multi-arch `-slicer` image, Orca on ARM; Step 5: re-watching a returning root, `rslave`; Step 6: per adapter, the A1; Step 7: the pairing choice, 24-hour codes, **Withdraw**.
- The README support matrix gains Linux ARM64 and Docker for the connector, and Linux ARM64 for the app; OrcaSlicer slices on ARM, Bambu Studio doesn't.
- The release workflow gains native ARM runners and a multi-arch merge for three images.

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
