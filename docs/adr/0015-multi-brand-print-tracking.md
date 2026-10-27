# ADR-0015: Every printer: live status, automatic prints and spool usage from any brand

- Status: Proposed (Plan 6.0.0 Step 1 runs the spikes below and accepts it)
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

Each one is a `local` adapter package in `packages/adapters/<id>` (ADR-0003), configured with a host and its key or access code (secrets per ADR-0005). Printers are added by host or IP; automatic discovery is a Step 1 spike.

### Printer status and the job tracker
- A new optional capability on `IntegrationInstance`: **`PrinterStatusSource`**. It returns a snapshot per printer: state, job file, progress, ETA, current layer, temperatures and slots (material, colour, RFID or spool id when known). An adapter can poll or subscribe; the server calls it the same way.
- One **job tracker in core** watches the snapshots. idle → printing → finished, failed or cancelled becomes an `ExternalPrint` (the existing `externalPrintSchema`), which then goes through the existing upsert, dedupe and review. Adapters stay thin and the state logic is written once.
- Adapters that also have history (`PrintHistorySource`: Moonraker, Bambu Cloud) backfill the prints that ended while the app was off.

### Live status
- The latest snapshot per printer lives **in memory only**. Nothing is stored as telemetry history.
- The server pushes it to the web app over SSE, the same channel pattern as ADR-0014. The dashboard shows a card per printer: state, progress, ETA, temperatures.
- **No printer control.** Nothing pauses, stops or starts a print.

### One printer, several sources
A Bambu printer can come from Bambu Cloud and from Bambu LAN. Sources are matched by serial. Live status comes from LAN, history from the cloud. Prints are deduped per printer by start time within a tolerance that Step 1 sets.

### Grams
The first that answers wins:
1. what the printer reports;
2. the slicer totals in the job file's header (G-code or 3MF);
3. the slice result of the matched project plate;
4. the review queue.

### Which spool
The first that answers wins:
1. the printer says: AMS or CFS RFID, Moonraker's Spoolman active spool;
2. the **loaded spool per printer slot**, which the user sets on the printer page;
3. the review queue: a `print_filament_usages` row with `spoolId` null, as today.

**Review policy** `never` · `unmatched` · `always`, set globally and overridden per integration and per printer; the most specific setting wins. `always` makes every print wait for review even when a spool matched.

### Spoolman, two-way
- An integration of its own. It imports spools, writes usage back after each print, and reads the active spool.
- Each usage it writes carries an idempotency key (print id + slot), so a retry never charges a spool twice.
- Our spool database stays the app's own. Spoolman is a source and a target, not the master.

### LAN reach
- A server on the same LAN talks to printers directly.
- A hub elsewhere reaches them through the ADR-0014 connector. The connector gets one new fixed operation: relay status and history for the printer hosts the hub assigns to it. It still never runs a command the hub sends, and it never sends commands to a printer.
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

## Risks and mitigations
- **Bambu's authorization firmware** may block third-party LAN access unless Developer mode is on. Step 1 checks what works on current firmware, and the setup docs say what to switch on.
- **PrusaLink and OctoPrint have no history:** a print that ends while nothing watches is missed. An always-on server or connector watches; a print first seen half-way is recorded from that point and flagged for review.
- **Vendor APIs change:** real payloads are kept as test fixtures, and an adapter that fails maps to `IntegrationErrorCode` and raises the usual sync alert.
- **Polling load on small printers:** a few seconds while printing, slower when idle, per adapter.
- **Dependencies:** `mqtt` for Bambu LAN, since Node has no MQTT client. Moonraker and OctoPrint use HTTP or Node 22's global `WebSocket`, with no new dependency.

## Consequences
- Plan 6.0.0: the status capability and job tracker, live status, the grams chain, loaded spools, the review policy, four adapters, Spoolman and the connector's printer bridge.
- `docs/architecture.md` lists `PrinterStatusSource`. The README gets a support matrix of printers and what each one provides.
- The backlog ideas "Live status module", "Spoolman & other integrations" and "Other slicer integrations" are covered by this plan, except the camera snapshot.

## Spikes for Step 1
1. Real payloads, saved as fixtures: Moonraker status and history; PrusaLink status and job; Bambu LAN MQTT push and what needs Developer mode on current firmware; OctoPrint job and push.
2. Slicer totals in job file headers from OrcaSlicer, PrusaSlicer and Bambu Studio, and how each printer lets us read the file.
3. The dedupe tolerance between Bambu Cloud and Bambu LAN for the same print.
4. Discovery: mDNS for Moonraker, PrusaLink and OctoPrint; SSDP for Bambu. Worth it in 6.0.0 or later.
5. A connector relaying a LAN printer to a hub on a VPS, through the ADR-0014 channel.
