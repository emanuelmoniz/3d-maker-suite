# Printer spikes (Plan 6.0.0 Step 1)

Input for ADR-0015. Code: this folder on branch `spike/printers`, not merged. Fixtures: on `dev`, in `packages/adapters/<moonraker|octoprint|prusalink>/fixtures` and `packages/3mf/fixtures/job-headers`, each with a `SOURCE.md`.

Run 2026-11-14 on Windows 11 Pro, Node 24.19.0, Docker Desktop 29.9.2. Raw captures are not in git (the Bambu ones hold the serial and the IP); `fixtures.mjs` writes the scrubbed fixtures.

| System | Evidence | Hands-on |
|---|---|---|
| Moonraker API 1.5.0, Klipper `282db76` | `virtual-klipper-printer` image + Spoolman 0.27.1 | real software, simulated printer |
| OctoPrint 1.11.8 | official image, virtual printer plugin | real software, simulated printer |
| PrusaLink | Home Assistant's test payloads (XL, firmware 6.1.2), Prusa's OpenAPI spec and firmware source | **no** |
| Bambu LAN | an A1 (`N2S`), firmware 01.09.00.00, cloud-connected | discovery and ports only; **MQTT, files and the two test prints are still open** (they need the access code) |
| Slicers | OrcaSlicer 2.5.0-rc, PrusaSlicer 2.9.7, Bambu Studio 02.09.01.70 | yes |

## Setup
```
docker compose up -d moonraker spoolman octoprint
# Moonraker: add "[spoolman] server: http://spoolman:8000" to moonraker.conf, set "microsteps: 1"
# in config/addons/*.cfg, then docker restart (else Klipper shuts down with "Timer too close").
# OctoPrint: octoprint user add …, config set plugins.virtual_printer.enabled true, server.firstRun false.
node moonraker.mjs <out> cube.gcode cancel:0.15 ; node moonraker.mjs <out> tile.gcode finish
OCTO_KEY=… node octoprint.mjs <out> cube.gcode
node ssdp.mjs 60
docker compose --profile relay up -d hub ; node relay-connector.mjs 2000 10000
node bambu.mjs ../../.env.spike <out>          # needs BAMBU_ACCESS_CODE
node fixtures.mjs <raw> <slice work dir>       # from the repo root on dev
```
Port 7912 held a real Spoolman on this PC; the spike's own runs on 7913 and nothing was pointed at the real one.

## 1. Payloads

### Moonraker
- State: `print_stats.state` = `standby` · `printing` · `paused` · `complete` · `cancelled` · `error` (with `message`). `/printer/info` `state` = `ready` · `shutdown` when Klipper itself is down.
- Progress: `virtual_sdcard.progress` (file position) and `display_status.progress` (M73). After a cancel `virtual_sdcard` is reset to 0 with no file.
- Layers: `print_stats.info.current_layer`/`total_layer` were null for an OrcaSlicer file; they need `SET_PRINT_STATS_INFO` in the G-code. The file's metadata has `layer_count`.
- Push: websocket `printer.objects.subscribe`, a `notify_status_update` every ~270 ms (279 B on average) while printing; `notify_history_changed` (`added`, `finished`) once per job.
- History (`/server/history/list`): `status` `completed` · `cancelled` · `error`, `start_time`, `end_time`, `print_duration`, `filament_used` (mm, what was really extruded), the file's `metadata`, and `auxiliary_data` with Spoolman's `spool_ids`.
- Spoolman: `GET /server/spoolman/spool_id` gives the active spool. **Moonraker reports usage to Spoolman on its own.**
- No sign-in here (`trusted_clients`); a real one may want an API key (`X-Api-Key`).

| Job | `filament_used` | File total | Really used |
|---|---|---|---|
| `000003` completed | 24.49 mm | 24.64 mm, 0.07 g | 0.070 g |
| `000002` cancelled at 16% | 76.50 mm | 331.1 mm, 0.99 g | 0.229 g |
| `000001` error before the first move | 0 mm | 331.1 mm, 0.99 g | 0 g |

### OctoPrint
- REST: `/api/job` (`state` text, `progress.completion`, `printTime`, `printTimeLeft`, `job.file`, `job.filament.tool0.length` mm and `volume` cm³ from the file's analysis), `/api/printer` (temperatures, flags; HTTP 409 when no printer is connected).
- After a cancel `/api/job` says `Operational` with an empty `progress`: REST alone can't tell a cancel from a print that never ran.
- Push: `/sockjs/websocket` works with Node's global `WebSocket`: `POST /api/login {passive:true}` with the API key, then `{"auth":"<name>:<session>"}`. `current` messages (throttled with `{"throttle":4}` to one per 2 s) and `event` messages.
- Events seen: `PrintStarted`, `PrintDone` (`time`), `PrintCancelling`, `PrintCancelled` (`progress: 47`, `fileposition`), then **also `PrintFailed` with `reason: "cancelled"`**.
- Grams: none. Length and volume are the file's totals; nothing says what a stopped print used.
- File: `GET /downloads/files/local/<path>` honours `Range` (HTTP 206).

### PrusaLink (not hands-on)
- `GET /api/v1/status` (`printer.state`, temperatures, `job.id`, `progress`, `time_remaining`, `time_printing`), `GET /api/v1/job` (state, file with `refs.download`; **204** when there is none), `GET /api/v1/info` (serial, nozzle, mmu), `GET /api/version`. HTTP Digest sign-in.
- States: `IDLE`, `BUSY`, `PRINTING`, `PAUSED`, `FINISHED`, `STOPPED`, `ERROR`, `ATTENTION`, `READY`. No push, no history.
- The spec's file `meta` (`filament used [g]`) is not sent by the MK4/XL/MINI firmware (`lib/WUI/nhttp/file_info.cpp` renders none). Grams come from the file.
- Nothing reports the filament a stopped job used.

### Bambu LAN
- Found: TLS 1.2 on 8883 with a certificate whose CN is the serial, signed by "BBL CA" (valid 2024-12-11 → 2034-12-09); ports 990 (FTPS) and 6000 open; 80 and 322 closed.
- **Open:** the MQTT report, `get_version`, `pushall`, FTPS, both with the printer on the cloud and Developer mode off. Bambu's blog (2025-01-20) says Developer mode "leave[s] the MQTT channel, live stream, and FTP open" and doesn't say what works without it.

## 2. Slicer totals in job files
| Slicer | Where | Keys |
|---|---|---|
| OrcaSlicer 2.5.0-rc | the last 253 bytes, after the config block | `; filament used [g] = 0.99` (one value per filament), `; total filament used [g] = 0.99` |
| PrusaSlicer 2.9.7 `.gcode` | 11 KB before the end, before the config block | the same two keys |
| PrusaSlicer 2.9.7 `.bgcode` | the Printer metadata block at byte 90, not compressed | `filament used [g]=1.20` |
| Bambu Studio 02.09.01.70 `.gcode` | the first 300 bytes | `; total filament weight [g] : 98.33,10.09,9.70,6.60`: only the filaments used, so position is not the slot |
| Bambu Studio `.gcode.3mf` | `Metadata/slice_info.config` | `<filament id="4" used_g="18.73">` with the slot; `packages/3mf` reads it already |

Reading the file:
| Printer | How | Partial read |
|---|---|---|
| Moonraker | not needed: `GET /server/files/metadata` has `filament_weight_total`, `filament_weights`, `filament_type`, `filament_colors`; history jobs carry it | `GET /server/files/gcodes/<file>` honours `Range` (206) |
| OctoPrint | `GET /downloads/files/local/<path>` | `Range` works (206): the last 64 KB covers Orca and PrusaSlicer |
| PrusaLink | `refs.download` (`/usb/<name>`) | not confirmed; a `.bgcode` has its totals in the first KB, so the read can stop there |
| Bambu | FTPS on 990 | open |

## 3. Dedupe tolerance, Bambu Cloud vs LAN
Open: needs the MQTT capture of two prints.

## 4. Discovery
- **Bambu SSDP, hands-on:** a `NOTIFY` every 10 s to `239.255.255.250` on UDP **2021 and 1990** (the `HOST` header says 1900). It carries `Location` (IP), `USN` (serial), `DevModel` (`N2S`), `DevName`, `DevVersion`, `DevConnect` (`cloud`), `DevBind`, `Devseclink`. A passive `node:dgram` listener reads it, no dependency. `M-SEARCH` gets no answer.
- **mDNS, from source:** Moonraker `_moonraker._tcp` and only with its optional `[zeroconf]` section; OctoPrint `_octoprint._tcp` and `_http._tcp` (bundled discovery plugin); PrusaLink `_prusalink._tcp` on port 80 (Buddy firmware `lib/WUI/mdns/mdns.c`).
- Node has no mDNS: a dependency or a hand-written DNS packet parser. Multicast doesn't reach a container on a bridge network (the usual Docker install), and a hub would need its connector to listen.

## 5. Connector relay
`relay-hub.mjs` in a container on its own network, `relay-connector.mjs` on the host, the Moonraker container as the printer. SSE down, POST up.
- The hub can't reach the printer: `localhost:7125` → `ECONNREFUSED`, `moonraker:7125` → `ENOTFOUND`.
- One snapshot (state, file, progress, ETA, layer, filament, temperatures) is **271 B**. Printing at one per 2 s: 8.1 KB/min. Idle at one per 10 s: 1.5 KB/min.
- POST round trip: median 9 ms, max 17 ms (same PC; a real VPS adds its network).
- History asked by the hub (`printer.history` event → the connector reads Moonraker → POST): 24–30 ms, 3.3 KB for 3 jobs.
- Hub restarted mid-print: the connector noticed at once and was back **1.0 s** after the hub was. Hub stopped for 25 s: the connector kept polling, held the latest snapshot and sent it on reconnect.
- **Gap:** only the latest snapshot is held. A print that ends while the hub is away is lost for a printer without history (PrusaLink, OctoPrint) unless the connector keeps the end of a job, or runs the job tracker itself.

## Integration kind
`kind` is read as "an account or a slicer install" in 20 places (10 server, 10 web), e.g. `capabilities.ts:117` (a non-cloud row always works, its Enabled switch isn't read), `capabilities.ts:125` (a non-cloud source is usable when its slicer folder exists), `routes/integrations.ts:147` (a non-cloud row never syncs), `routes/integrations.ts:226` (one non-cloud install per library), `apps/web/src/lib/integrations.ts:83,87` (only cloud rows get a line on the Printers, Prints and Spools Sources tabs), `IntegrationsPage.tsx:73` (all-cloud → accounts card, else a slicer card). A printer added by host marked `local` would be a slicer in all of them; it behaves like `cloud` in all of them except the name ("Account").
