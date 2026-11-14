# Bambu LAN fixtures

Captured 2026-11-14 for ADR-0015 (Plan 6.0.0 Step 1) with `spike/printers/bambu.mjs` and `ssdp.mjs` on branch `spike/printers`, hands-on.

- **Bambu Lab A1 with AMS Lite, firmware 01.09.00.00**, connected to Bambu Cloud, LAN Only Mode off, Developer Mode off.
- MQTT over TLS on port 8883, user `bblp`, password = the printer's access code, topic `device/<serial>/report`. Two read requests were sent on `device/<serial>/request`: `get_version` and `pushall`. Nothing else.
- Two prints of the same plate, sent from Bambu Studio through the cloud: one finished, one cancelled on the printer at 40%.

**Scrubbed.** Serial numbers, RFID tag ids, spool uuids, task, project, profile and model ids are replaced by stable fakes (the same real value gets the same fake). The job's name, file name, download URL and MD5 are replaced, the IP is zeroed. Messages of the `system` and `security` kind are dropped: the first carries the access code, the second the printer's certificate.

| File | What |
|---|---|
| `ssdp-notify.txt` | the printer's discovery broadcast (UDP 2021 and 1990, every 10 s) |
| `version.json` | the answer to `get_version` |
| `pushall-idle.json` | a full status while idle (4.9 KB) |
| `print-1-finish.json` | the finished print, from the cloud's `project_file` command to the first messages after `FINISH`, with the time each arrived |
| `print-2-failed.json` | the cancelled print, the same way |

The two print files keep what a job tracker reads (state, percent, layer, remaining time, ids, AMS, errors); messages that only changed a temperature, a fan or the Wi-Fi signal are dropped.

What they show:
- After the first full status the printer sends only what changed, about every 2 s (134 B on average). A full status comes on `pushall`.
- The cloud's start command is echoed on the report topic: `task_id` (the cloud's task id), `plate_idx`, `ams_mapping` (the AMS slot of each filament) and `timestamp` (the cloud's start time, to the second).
- States: `IDLE` → `PREPARE` → `RUNNING` → `FINISH` or `FAILED`. A cancel is `FAILED` with `print_error: 50348044` (`0x0300400C`); four seconds later `mc_percent` and `print_error` are back to 0.
- The message that ends a job has an empty `gcode_file` and `print_type: "idle"`; the ids are in the messages before it.
- No grams anywhere, and the AMS `remain` stayed at 100 for all four slots through both prints.
- `mc_percent` is time, preparation included: it reached 29% before the first layer. At the cancel it said 40% on layer 6 of 45, when 16% of the filament had been extruded (summed from the job file's G-code).
