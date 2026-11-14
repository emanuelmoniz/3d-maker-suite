# ADR-0015: Every printer: live status, automatic prints and spool usage from any brand

- Status: Accepted (after the Plan 6.0.0 Step 1 spikes, see Spike results). Revised 2026-11-14 against 5.6: prints are recorded at once, the spool chain keeps today's matcher, the review policy has a shape, and printer alerts are in.
- Date: 2026-10-27

## Context
Bambu Cloud is the only source that fills data in on its own (ADR-0006): prints through `PrintHistorySource`, spools through `SpoolInventorySource`, and spool usage through those two. A Prusa, Klipper, OctoPrint, Elegoo or Creality user, and a Bambu user who doesn't use the cloud, logs every print by hand. The app should be the one place where prints arrive from the printer systems people really use, with live status and grams per slot, so spool usage follows.

Requirements from the 2026-10-27 discussion:
- Prints are recorded automatically, and the dashboard shows what each printer is doing now.
- The first wave covers the most used systems; more come in later minors.
- When a printer can't say which spool it used: a loaded spool per printer slot, Spoolman, and an option to review every print.
- A hub on a VPS (ADR-0014) must reach printers that sit on a LAN.
- Printers with no network keep the manual flow.

### Which systems people use
Nobody publishes counts per protocol, so each brand's share is mapped to the protocol its printers speak. The numbers are estimates; the order matters, not the digits.

| Brand | Share | Protocol |
|---|---|---|
| Bambu Lab | 37% of entry-level shipments in 2025 (Context); ~20–25% of desktop units (printingxyz 2026) | Bambu Cloud (done), LAN MQTT |
| Creality | ~25–30% (printingxyz) | K1/K2/Hi/Ender-3 V3 stock: Creality OS websocket; rooted: Moonraker; older Marlin machines: no network, OctoPrint only |
| Elegoo | ~15%, much of it resin | Neptune 4: Moonraker; Centauri Carbon and resin: SDCP |
| Anycubic | ~12%, much of it resin | closed cloud and MQTT (the Rinkhals mod adds Moonraker) |
| Prusa | ~4–5% | PrusaLink (MK4/S, Core One, XL, MINI); MK3S through OctoPrint or PrusaLink on a Pi |
| Sovol, Qidi, Snapmaker U1, Voron, RatRig | ~10–15% together | Moonraker |

- OctoPrint: 66k (7 days) / 91k (30 days) opted-in instances at the last public count, with 0.7–1M real installs estimated by its maintainer. Old figures.
- Home Assistant: PrusaLink is on 2,911 installs; OctoPrint on ~1.5% of ~712k installs.
- Prior art: 3D Print Log's open-source `printlog-bridge` picked the same order: Moonraker, Bambu LAN, PrusaLink, then OctoPrint, Elegoo SDCP, Creality stock, Anycubic, FlashForge, Duet.

Sources: [Tom's Hardware on Context's data](https://www.tomshardware.com/3d-printing/tariff-fears-caused-a-surge-in-entry-level-3d-printer-sales-chinese-companies-accounted-for-95-percent-of-entry-level-machines-shipped-globally), [tt3dprint](https://tt3dprint.com/bambu-lab-overtakes-creality-top-budget-3d-printer-2025/), [printingxyz](https://printingxyz.com/stats/3d-printer-sales-by-brand/), [OctoPrint on Wikipedia](https://en.wikipedia.org/wiki/OctoPrint), [HA PrusaLink](https://www.home-assistant.io/integrations/prusalink/), [HA OctoPrint](https://www.home-assistant.io/integrations/octoprint/), [printlog-bridge#102](https://github.com/HoffmanEngineering/printlog-bridge/issues/102).

## Decision

### Waves
- **6.0.0:** Moonraker, Bambu LAN, PrusaLink, OctoPrint. Moonraker covers the most brands with one adapter. OctoPrint is the only route for the large base of Marlin printers without a network.
- **6.x:** Creality stock websocket, Elegoo SDCP.
- **Later:** Anycubic, FlashForge, Duet, a Home Assistant bridge.

Each one is an adapter package in `packages/adapters/<id>` (ADR-0003), configured with a host and its key or access code (secrets per ADR-0005).

**Integration kind `host`, new:** an address on the network and its key. `local`, `server` and `worker` name a slicer install, and the code reads "not `cloud`" as "a slicer" in 20 places; a `host` source is enabled, synced and listed on the Sources tabs as an account is. Spoolman is a `host` too. A printer reached through a connector is the same kind, with the device in its config.

**Discovery:** printers are added by host or IP. In 6.0.0 the Bambu adapter also listens for the printer's own broadcast (SSDP, no dependency): it finds the printer and follows it by serial when its IP changes. It doesn't reach a server in a bridged Docker network, so the host field stays. mDNS (Moonraker, OctoPrint, PrusaLink) comes in 6.x: it needs a dependency.

### Printer status and the job tracker
- A new optional capability on `IntegrationInstance`: **`PrinterStatusSource`**. It returns a snapshot per printer: state, job file, progress, ETA, current layer, temperatures and slots (material, colour, RFID or spool id when known). An adapter can poll or subscribe; the server calls it the same way.
- One **job tracker in core** watches the snapshots. idle → printing → finished, failed or cancelled becomes an `ExternalPrint` (the existing `externalPrintSchema`, which gains the spool a printer named per slot and an estimated mark on grams), which then goes through the existing upsert and dedupe. Adapters stay thin and the state logic is written once.
- Adapters that also have history (`PrintHistorySource`: Moonraker, Bambu Cloud) backfill the prints that ended while the app was off.
- The tracker keeps a job's file and ids from its first messages: the message that ends a job often has neither (Bambu LAN, Moonraker after a cancel).
- OctoPrint is read through its push socket: its REST job looks the same after a cancel as before a print. A cancel raises both `PrintCancelled` and `PrintFailed` there; it is one cancelled print.
- An adapter never logs a raw printer message: Bambu's local feed also carries the access code when another client asks for it.
- **A print recorded automatically is written when it ends, never held back.** Until 5.6 an automatic Bambu Cloud sync held a print with no sure spool or project and read it again from the cloud's history at review time; PrusaLink and OctoPrint have no history to read it from. So the print is written at once, its project linked by title or left empty, and a slot without a sure spool waits in **Filament to review**. Bambu Cloud's automatic sync follows the same rule, so one printer on cloud and LAN has one behaviour. Review and import by hand stays as it is.

### Live status
- The latest snapshot per printer lives **in memory only**. Nothing is stored as telemetry history.
- The server pushes it to the web app over SSE, the same channel pattern as ADR-0014. The dashboard shows a card per printer: state, progress, ETA, temperatures.
- **No printer control.** Nothing pauses, stops or starts a print.

### One printer, several sources
A Bambu printer can come from Bambu Cloud and from Bambu LAN. Sources are matched by serial. Live status comes from LAN, history from the cloud. Prints are deduped per printer: by the cloud's task id, which the LAN feed carries for a print started through the cloud, else by start time within **60 seconds**.

**Bambu LAN works alone.** It needs no Bambu Cloud integration and no cloud-bound printer: the printer, its slots, live status and prints come from the LAN source. Without the cloud there is no history, so a print that ends while nothing watches is missed, as with PrusaLink and OctoPrint. A print started over LAN has no cloud task id; its start is when the tracker first saw it.

### Grams
The first that answers wins:
1. what the printer reports;
2. the slicer totals in the job file's header (G-code or 3MF);
3. the slice result of the matched project plate;
4. the review queue.

| System | Grams of a finished print | Grams really used when cancelled or failed |
|---|---|---|
| Moonraker | its history: the file's totals per tool | **reported**: the length really extruded, against the file's totals |
| Bambu LAN | the job's 3MF on the printer (`slice_info.config`, per filament, with the slot) | not reported |
| Bambu Cloud | the cloud's sliced weight per slot | not reported |
| PrusaLink | the job file's header | not reported |
| OctoPrint | the job file's header (its own analysis has length and volume only) | not reported |

A cancelled or failed print whose printer doesn't report the grams really used gets the file's or the plate's total × the progress it reached, marked **estimated**. Progress is the share of the material, not of the time: on Bambu the layer reached over the layer count (or the job file's G-code summed up to that layer), never the printer's percent, which counts preparation and said 40% when 16% was extruded. A usage keeps where its grams came from.

### Which spool
The first that answers wins:
1. the printer says: AMS or CFS RFID, the Spoolman spool a Moonraker job names;
2. the **loaded spool per printer slot**, which the user sets on the printer page. One whose material differs from what the printer reported for the slot isn't sure;
3. a sure material + colour match, as Bambu Cloud prints are matched today (`matchPrint`);
4. the review queue (Filament to review): a `print_filament_usages` row with `spoolId` null, as today.

**Review policy** `never` · `unmatched` · `always` (in the UI: Never · When unsure · Always), set globally and overridden per source and per printer; the most specific setting wins. It applies to prints recorded automatically, from any source.
- **Unsure** means: no spool, a guess among several, a loaded spool that contradicts the printer, or estimated grams.
- `never`: a sure spool is charged, estimated grams too; anything else is written as not tracked and nothing waits.
- `unmatched`: a sure spool with real grams is charged; an unsure slot waits, with the best guess suggested.
- `always`: every slot waits, with its match suggested.
- A suggestion (`suggestedSpoolId` on the usage) **charges nothing until a person accepts it**. Accepting, or picking another spool, books the spool's history once.
- The global level is a preference, a source's is on its `sync_policies` row for prints (set in Prints settings → Sources, ADR-0021), a printer's on the printer.

### Alerts
New kinds in the kind catalog (ADR-0016):
- `print_finished` and `print_failed`: event kinds, one per print the tracker saw end. A cancelled print and a backfilled one raise none.
- `printer_offline`: a condition kind, raised when a printer stops answering during a print and resolved when it answers. A printer that is off while idle raises nothing.
- `filament_review`: a condition kind with the count of slots waiting in Filament to review, resolved when the queue is empty. It replaces `sync_pending` for automatic print runs.

### Spoolman, two-way
- An integration of its own. It imports spools, writes usage back after each print, and reads the active spool.
- Each usage it writes carries an idempotency key (print id + slot), so a retry never charges a spool twice.
- **The app's own spool is always charged**, with or without Spoolman.
- **Moonraker reports usage to Spoolman on its own** when its `[spoolman]` is set up. A job that Moonraker reported (it names its Spoolman spool) is not written to Spoolman again. Every other print is: another printer, or a Moonraker that doesn't report to Spoolman.
- Our spool database stays the app's own. Spoolman is a source and a target, not the master.

### LAN reach
- A server on the same LAN talks to printers directly.
- A hub elsewhere reaches them through the ADR-0014 connector. The connector gets one new fixed operation: relay status and history for the printer hosts the hub assigns to it. It still never runs a command the hub sends, and it never sends commands to a printer.
- The connector keeps the end of a job until the hub has it, not only the latest status: a print that ends while the hub is away must not be lost on a printer without history.
- So 6.0.0 builds on 5.0.0.

### Printers with no network
Manual logging from a project plate's slice result, as today.

## Rejected options
- **A Home Assistant bridge as the main path:** it needs Home Assistant, and every HA integration names its entities differently. It stays a later adapter for brands nobody else covers.
- **Printer control (pause, stop, start):** safety, and a much bigger scope. The app records; it doesn't drive the printer.
- **Spoolman as the master spool database:** our spool model would depend on theirs, and users without Spoolman would lose features.
- **Storing telemetry history:** a lot of rows for little use. The finished print keeps what matters.
- **Capturing slicer uploads (the app as an OctoPrint host):** covers SD-card printers only half (it doesn't know whether the print ran). Kept in the backlog.
- **Recording prints only, without live status:** the job tracker needs the same polling anyway, and live status was asked for.
- **Holding an automatic print back until it is reviewed** (Bambu Cloud until 5.6): a printer without history can't offer the print again, and two rules (held for the cloud, recorded for the rest) would give the review policy two meanings and make the cloud + LAN dedupe look at held prints too.
- **Charging the matched spool at once under `always`:** a wrong pick needs two correction entries in the spool's history and can raise a false low-spool alert in between. Someone who picks `always` reviews anyway.
- **An alert whenever a printer is offline:** printers are switched off when idle; only contact lost during a print is worth an alert.

## Risks and mitigations
- **Bambu's authorization firmware:** reading status and files works with the access code while the printer stays on the cloud, with Developer mode off (A1, firmware 01.09.00.00). Not tested: LAN Only mode, Developer mode, other models. Step 9 checks LAN Only on a real printer, and the setup docs say where the access code is.
- **Bambu's job file can't be read in part** (FTPS refuses an offset): the whole 3MF is downloaded once per print.
- **PrusaLink is not verified on a printer:** its payloads come from Home Assistant's tests and Prusa's source. A real printer confirms the adapter before it ships.
- **PrusaLink, OctoPrint and Bambu LAN without the cloud have no history:** a print that ends while nothing watches is missed. An always-on server or connector watches; a print first seen half-way is recorded from that point and flagged for review.
- **Vendor APIs change:** real payloads are kept as test fixtures, and an adapter that fails maps to `IntegrationErrorCode` and raises the usual sync alert.
- **Polling load on small printers:** a few seconds while printing, slower when idle, per adapter.
- **Dependencies:** `mqtt` for Bambu LAN, since Node has no MQTT client. Moonraker and OctoPrint use HTTP or Node 22's global `WebSocket`, with no new dependency.

## Consequences
- Plan 6.0.0: the status capability and job tracker, live status, printer alerts, the grams chain, loaded spools, the review policy, four adapters, Spoolman and the connector's printer bridge.
- Bambu Cloud users see a change: an automatic sync records every print, and a print whose title matches no project arrives without one instead of waiting. The CHANGELOG says so.
- `docs/architecture.md` lists `PrinterStatusSource`. The README gets a support matrix of printers and what each one provides.
- The backlog ideas "Live status module", "Spoolman & other integrations" and "Other slicer integrations" are covered by this plan, except the camera snapshot.

## Spike results (2026-11-14)
Scripts and details: branch `spike/printers` (`spike/printers/NOTES.md`, not merged). Fixtures: `packages/adapters/<moonraker|octoprint|prusalink>/fixtures`, `packages/adapters/bambu/fixtures/lan` and `packages/3mf/fixtures/job-headers`, each with a `SOURCE.md`. Windows 11 Pro, Node 24.19.0, Docker Desktop 29.9.2.

| System | Evidence | Hands-on |
|---|---|---|
| Bambu LAN | an A1 with AMS Lite, firmware 01.09.00.00, on the cloud | yes: a finished and a cancelled print |
| Moonraker API 1.5.0, Klipper `282db76` | the `virtual-klipper-printer` image and Spoolman 0.27.1 | real software, simulated printer |
| OctoPrint 1.11.8 | the official image with its virtual printer | real software, simulated printer |
| PrusaLink | Home Assistant's test payloads (XL, firmware 6.1.2), Prusa's OpenAPI spec and firmware source | no |

**1. Payloads.**
- *Bambu LAN:* MQTT over TLS on 8883 and FTPS on 990 answer with the access code while the printer is on the cloud, LAN Only and Developer mode off. A full status is 4.9 KB, then changes about every 2 s (134 B). The cloud's start command is echoed with its task id, the plate and the AMS slot of each filament. A cancel is `FAILED` with `print_error` `0x0300400C`. No grams; the AMS `remain` stayed at 100 through both prints. Another client's answers are broadcast too, the access code among them.
- *Moonraker:* `print_stats.state` is `standby`, `printing`, `paused`, `complete`, `cancelled` or `error`. A history job has the length really extruded, the file's totals per tool and the Spoolman spool it used. Layer numbers are null unless the slicer sends them. Moonraker wrote each job's usage to Spoolman itself.
- *OctoPrint:* `/api/job` has state, progress and the file's length and volume. After a cancel it is empty; the push socket (it works with Node's `WebSocket`) says `PrintCancelled`, then also `PrintFailed` with `reason: "cancelled"`.
- *PrusaLink:* `/api/v1/status` and `/api/v1/job` (204 when there is none); no push, no history. The file `meta` of the spec is not sent by the MK4, XL and MINI firmware.

**Grams when cancelled.** Moonraker: 76.50 of 331.1 mm extruded, 0.23 of 0.99 g, in the history job. Bambu: the printer said 40% on layer 6 of 45; the job's G-code summed to 15.9% (0.69 of 4.35 g); total × percent gives 1.74 g, total × layer 0.58 g. OctoPrint and PrusaLink report nothing.

**2. Slicer totals.**

| Slicer | Where |
|---|---|
| OrcaSlicer 2.5.0-rc | the last 253 bytes: `; filament used [g] = …`, one value per filament |
| PrusaSlicer 2.9.7 `.gcode` | 11 KB before the end, the same keys |
| PrusaSlicer 2.9.7 `.bgcode` | the Printer metadata block at byte 90, not compressed |
| Bambu Studio 02.09.01.70 `.gcode` | the first 300 bytes; only the filaments used, so position is not the slot |
| Bambu Studio `.gcode.3mf` | `Metadata/slice_info.config`, with the slot |

Reading the file: Moonraker's metadata endpoint has the totals already; OctoPrint's download honours `Range`; PrusaLink gives a download link (a ranged read is not confirmed); Bambu's FTPS gives the whole file only (532 KB in 3.5 s).

**3. Dedupe.** The cloud's task id is the LAN's `task_id` in both prints, and the start command's `timestamp` is the cloud's start time to the second. The LAN saw the start 2.3–2.7 s later, `PREPARE` after 4.4–4.7 s, `RUNNING` after 13.3–19.8 s, the end 2.5–3.9 s after the cloud's. Two prints of one model. In 222 synced prints the two closest starts are 106 s apart, so 60 s.

**4. Discovery.** A Bambu printer broadcasts every 10 s on UDP 2021 and 1990 with its IP, serial, model, name and firmware; a `node:dgram` listener reads it; it doesn't answer a search. From source: Moonraker announces `_moonraker._tcp` only with its optional `[zeroconf]`, OctoPrint `_octoprint._tcp`, PrusaLink `_prusalink._tcp`. Node has no mDNS, and multicast doesn't reach a bridged container.

**5. Connector relay.** A stand-in hub in a container that can't reach the printer, a stand-in connector on the host, SSE down and POST up. A snapshot is 271 B: 8.1 KB a minute while printing (one per 2 s), 1.5 KB idle (one per 10 s). A history request from the hub came back in 24–30 ms. After a hub restart mid-print the connector was back 1.0 s after the hub. Same PC, so no real network delay. It held only the latest status, which is why the connector must keep job endings.

**Not tested:** Bambu in LAN Only or Developer mode, a print started over LAN, Bambu models other than the A1, any PrusaLink printer, real Klipper and OctoPrint hardware.
