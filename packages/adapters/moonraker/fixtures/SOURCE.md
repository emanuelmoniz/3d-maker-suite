# Moonraker fixtures

Captured 2026-11-14 for ADR-0015 (Plan 6.0.0 Step 1) with `spike/printers/moonraker.mjs` on branch `spike/printers`.

- **Moonraker API 1.5.0 with Klipper `282db76`**, the `ghcr.io/mainsail-crew/virtual-klipper-printer` Docker image: real Klipper and Moonraker, a simulated controller. Payloads are real; timings and temperatures are not (both heaters read a constant 103 °C).
- **Spoolman 0.27.1** next to it, set as Moonraker's `[spoolman]` server, with one spool made active.
- Job files: a 20 × 20 × 3 mm cube and a 10 × 10 × 0.6 mm tile, sliced with OrcaSlicer 2.5.0-rc (Voron 2.4 profile). They are in `packages/3mf/fixtures/job-headers`.
- Three jobs, in `history-list-after-complete.json`: `000001` **error** (the file moved before homing), `000002` **cancelled** at 16%, `000003` **completed**.

| File | Request |
|---|---|
| `server-info.json`, `printer-info.json`, `objects-list.json` | `GET /server/info`, `/printer/info`, `/printer/objects/list` |
| `printer-info-shutdown.json` | `GET /printer/info` after Klipper shut down ("Timer too close") |
| `status-idle.json`, `status-printing-*.json`, `status-complete.json`, `status-cancelled.json`, `status-error.json` | `GET /printer/objects/query?print_stats&virtual_sdcard&display_status&extruder&heater_bed&toolhead&webhooks&idle_timeout&gcode_move` |
| `upload-*.json`, `metadata-*.json`, `start-*.json`, `cancel.json` | `POST /server/files/upload`, `GET /server/files/metadata`, `POST /printer/print/start`, `POST /printer/print/cancel` |
| `history-list-after-*.json`, `history-totals.json` | `GET /server/history/list`, `/server/history/totals` |
| `spoolman-set-active.json`, `spoolman-spool-id.json`, `spoolman-status*.json` | `POST` and `GET /server/spoolman/spool_id`, `GET /server/spoolman/status` |
| `spoolman-spool-around-*.json` | Spoolman's own `GET /api/v1/spool/<id>` before and after the job |
| `ws-sequence.json` | the websocket (`printer.objects.subscribe`) over the cancelled and the completed job, with the time each message arrived. Thinned: Klipper sends a status update every 250 ms; kept are those that change `print_stats.state`, every 20th of the rest, and every other notification except load reports. |

What they show:
- A history job reports the filament **really extruded** (`filament_used`, mm) next to the file's totals (`metadata.filament_total` mm, `filament_weight_total` g, `filament_weights` per tool): the cancelled job used 76.50 of 331.1 mm, 0.23 of 0.99 g.
- A history job names its Spoolman spool: `auxiliary_data` → `spool_ids`.
- **Moonraker reports usage to Spoolman itself**: the spool's `used_length` was 76.50 mm after the cancelled job and 100.99 mm after the completed one, the sum of the jobs' `filament_used`, with nothing else writing to it.
- After a cancel `virtual_sdcard` is reset (`progress: 0`, no file); the history job keeps what happened.
- `print_stats.info` (`current_layer`, `total_layer`) stays null unless the slicer sends `SET_PRINT_STATS_INFO`.
- History says `completed`, `print_stats.state` says `complete`.
