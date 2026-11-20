# 6.3.0 Step 1 spikes (ADR-0024)

Branch `spike/connector`, never merged. GitHub-hosted runners on 2026-11-20: `ubuntu-24.04` (x64) and
`ubuntu-24.04-arm` (arm64), Docker 28.0.4, Node 22, the connector and app at 6.2.0. No hardware of our
own: the printer is simulated (agreed with the user; the real A1 is Plan 6.3.0 Step 6).

Runs: [44814580829](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/44814580829) (all),
[44816519547](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/44816519547) (S6 again,
slicer), [44817797801](https://github.com/emanuelmoniz/3d-maker-suite/actions/runs/44817797801)
(slice). Every measured line in the logs starts with `RESULT`.

The only connector change is a spike patch in `apps/connector/src/main.ts`: pair from
`CONNECTOR_HUB_URL`, `CONNECTOR_PAIRING_CODE` and `CONNECTOR_NAME` when not paired;
`CONNECTOR_SPIKE_EXIT=1` exits on a refused code.

## S1 - ARM64 (`bundle`, `images`, `merge`, `qemu-build`)

| | x64 | arm64 (native runner) |
|---|---|---|
| app archive build | 18 s | 18 s |
| connector archive build | 7 s | 7 s |
| app `.tar.gz` / update `.zip` | 62.0 / 23.7 MB | 61.8 / 23.7 MB |
| connector `.tar.gz` / update `.zip` | 47.9 / 4.6 MB | 47.7 / 4.6 MB |
| app archive healthy after start | 1.6 s | 2.1 s |
| `better-sqlite3` prebuild kept | `linux-x64.node` | `linux-arm64.node` |
| installed connector | 136 MB | 133 MB |
| `scripts/pair-test.mjs` (pair, rename, revoke) | passed | passed |
| app image, native build | 44 s, 1.34 GB, healthy | 50 s, 1.32 GB, healthy |
| spike connector image, native build | 11 s, 630 MB | 10 s, 637 MB |
| `-slicer` image, native build | 60-83 s, 1.93 GB | 74 s, 1.91 GB |

- The app image for arm64 built under QEMU on x64: **421 s**, against 50 s natively (8.4x).
- The two native connector images, as `docker save` artifacts → local `registry:2`, merged with
  `docker buildx imagetools create`: worked. A pull on amd64 picks amd64.
- The same tag run with `--platform linux/arm64` under QEMU on x64 pairs: online after **21.3 s**, against
  1.4 s for amd64. Good enough for a pairing test, not for builds.
- The spike connector image is the source tree plus `node_modules` (630 MB); the pruned archive is
  133 MB installed. Step 4 builds the image from the archive's contents.

**OrcaSlicer on ARM** (`slicer`): Orca publishes `OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V*.AppImage`
since 2.4.0 and an aarch64 Flatpak since 2.3.0 (`packages/adapters/orca/src/releases.fixture.json`);
Bambu Studio publishes x64 only (2.9.1: `ubu22`, `ubu24`). Orca 2.5.1 in the `-slicer` image, extracted
into `/data/slicers` and run as the PUID user (1001:1001, glibc 2.41): `--help` exit 0 on both arches;
`--slice 1 --export-3mf --allow-newer-file` of `single_color.3mf` (its `raft_first_layer_expansion` of -1,
which Orca refuses, set to 0): **exit 0 in 1 s on both, 84,922 bytes (x64) and 84,900 bytes (arm64)**.
`unsliced.3mf` fails the same way on both (an object partly off the plate).

## S2 - pairing from environment variables in a container (`pairing`)

Hub from source on the runner (`HOST=0.0.0.0`), the connector container in the default bridge, the hub
at the bridge gateway `172.17.0.1:4310`.

| Case | Result |
|---|---|
| 1. first start | paired and online in **1.4 s**; `HEALTHCHECK` on `127.0.0.1:4301` healthy (the Host guard passes) |
| 2. `docker restart` | online again; code not sent ("already paired"); 1 device |
| 3. container recreated on the same volume (an image update) | online, **same device id**, 1 device |
| 4. wrong code | `invalidCode`; the container stays up and healthy, unpaired |
| 5. expired code | `invalidCode` (the hub answers 401 for wrong, used and expired alike); the code is deleted |
| 6. revoked, restarted with the variables still set | the used code is sent again at each start: `invalidCode` |
| 7. exit on a refused code + `restart: unless-stopped`, fixed IP | **11 restarts in 120 s**: 5 × `invalidCode`, then 6 × `tooManyAttempts`; afterwards a **valid** code from that IP gets **429** (15 min lock, `loginLimiter`); sign-in from that IP still 200 (its own limiter) |
| 8. host networking beside a hub on 4300 | exit 1: "a hub (6.2.0) is running on this machine" (`localHub()`) |

So exiting on a refused code is never safe in Docker: `unless-stopped` restarts whatever the exit code,
and the loop locks pairing out for every container behind that address (a NAS behind NAT is one
address). Staying up and not sending a refused code again is the safe behaviour.

## S3 - updates in a container (`pairing`, after case 3)

Hub restarted at 6.3.99, the Docker connector at 6.2.0 (`APP_INSTALL=docker`):
- the hub lists it `outdated: true`, `updateFailed: null`;
- 0 download attempts in the connector's log (`update.ts` updates only `APP_INSTALL=bundle`);
- the connector's local page says nothing about it;
- the `connector_outdated` alert ("Connector outdated") fires after `CONNECTOR_UPDATE_GRACE_MS` (15 min),
  read from `apps/server/src/alerts/evaluate.ts`, not waited for.
So the hub can't tell a Docker connector from a bundle one that hasn't updated yet: it needs the
connector's install kind to show `docker compose pull`.

## S4 - `PUID` / `PGID` (`owner`, `slicer`)

- `setpriv` is in `node:22-trixie-slim` (util-linux 2.41.5).
- A `/data` first used as root, plus 10,000 files: the first start with `PUID=1001` changed **10,003
  entries in 54 ms**; the second start 0 entries in 19 ms. Healthy; nothing left owned by root.
- The process: `Uid 1001`, `Gid 1001`, no supplementary groups (`--clear-groups`).
- A file written into a bind mount: `runner:runner` with PUID, `root:root` without (today's behaviour).
- **The app image breaks as another user with its current `CMD`:** `pnpm --filter … start` goes through
  corepack, which downloads pnpm again into the new `HOME` and then fails: `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`,
  `Failed to remove /app/node_modules/vitest … Permission denied`. With no network it fails at the
  download. Started directly (`node_modules/.bin/tsx src/main.ts`) it is healthy as 1001, offline too.
- The `-slicer` image as 1001: Orca extracted into `/data/slicers` owned by 1001, runs and slices (S1).

## S5 - a printer on the LAN from a container (`printers`, simulated)

The printer is a network namespace (10.99.0.2) behind a bridge `lan0` (10.99.0.1) on the runner: the A1's
NOTIFY (fixture) every 2 s to the subnet broadcast, `255.255.255.255` and `239.255.255.250`, on 2021
and 1990 (each path named, so the listener tells them apart), mosquitto with TLS on 8883 (user `bblp`),
HTTP and a WebSocket on 7125. The listener is the adapter's own `ssdp.ts` and the `mqtt` package.

| Mode | Broadcast | Multicast | MQTT-TLS, HTTP, WebSocket by typed IP |
|---|---|---|---|
| bridge | no | no | yes |
| bridge with `-p 2021:2021/udp -p 1990:1990/udp` | **yes** (via docker-proxy) | no | yes |
| host | yes | yes | yes |
| macvlan on the LAN | yes | yes | yes |

Which destination a real A1 uses is not known here (the fixture's `HOST:` says multicast; ADR-0015 says
broadcast): Step 6 checks it on the A1. Published UDP ports also need 2021 and 1990 free on the host
(Bambu Studio on the same machine takes them).

## S6 - folders on mounts (`folders`, second run)

One client mount per share: two mounts of one share on one kernel share a superblock, so in the first run
a write through the second mount raised events on the first, which a write from another PC never does.

| Folder in the container | Change | Event |
|---|---|---|
| bind mount of a local folder | by a host process (as the NAS's samba writing for an SMB client) | yes, 2 ms |
| | inside the container | yes, 34 ms |
| | new subfolders + file | yes (folder, subfolder, file) |
| | 50 files right after `mkdir`, three times | 50 of 50 each time |
| named volume | inside / another container | yes, 35 / 84 ms |
| CIFS share mounted on the host | **not through this mount** (on the server, as another PC would) | **no**; a listing sees it at once |
| | through this mount, on the host or inside | yes, 3 / 35 ms |
| NFS export mounted on the host | **not through this mount** | **no**; a listing sees it at once |
| | through this mount, on the host or inside | yes, 3 / 37 ms |

- **A share that drops and comes back** (watcher in a host process, CIFS and NFS alike): at the drop the
  watcher reports every file as renamed, then nothing after the remount, and **no error**. The connector's
  watcher would go silent with nothing in its log (`roots.ts` restarts it only on connect, `roots.changed`
  or `folders.set`; the hub's scanner only when the roots change).
- **A share mounted on the host after the container started** (NAS boot order): the default (`rprivate`)
  container sees an empty folder; with `bind-propagation=rslave` it sees the share. After the host
  unmounts, `rslave` sees it gone; a `rprivate` container that started with the share mounted keeps
  listing it.

## S7 - headless Linux install (`bundle`, both arches)

The archive's `install.sh`, then a systemd user unit running `launcher.mjs --background`.

| | x64 | arm64 |
|---|---|---|
| user service up | 1.07 s | 1.12 s |
| pairing from `Environment=` in the unit | online | online |
| `Restart=on-failure`, the connector process killed (`-9`) | **stays down, unit inactive** | same |
| `Restart=on-failure`, the launcher killed | back | back |
| `Restart=always`, the connector process killed | back | back |
| `Restart=always`, `systemctl --user stop` | stopped, no restart | same |
| `loginctl disable-linger` | the connector stops | same |
| system unit (`User=`, needs sudo to install) | up, still paired | same |

- The launcher turns a connector killed by a signal into exit 0 (`server.on("exit", (c) => done(c ?? 0))`),
  so `on-failure` doesn't restart it: the unit needs `Restart=always`, or the launcher a non-zero exit.
- `loginctl enable-linger` worked without sudo on the runner (polkit allowed it); the runner user is not
  a typical one, so `install.sh` tries without sudo and prints the `sudo` line when refused.
- Under systemd the connector still writes `~/.config/autostart/3d-maker-suite-connector.desktop`
  (the launcher sets `APP_LAUNCH_CMD`): on a Pi with a desktop both would start it (the second one only
  finds the first). A headless install must not register the desktop autostart.
- Field evidence: bekkas-server runs the connector as a systemd user service with linger (set up by hand,
  seen 2026-11-16).
