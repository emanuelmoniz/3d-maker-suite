# OctoPrint fixtures

Captured 2026-11-14 for ADR-0015 (Plan 6.0.0 Step 1) with `spike/printers/octoprint.mjs` on branch `spike/printers`.

- **OctoPrint 1.11.8**, the official `octoprint/octoprint` Docker image, with its **virtual printer** plugin. The server software and its payloads are real; the printer is simulated, so timings and temperatures are not.
- Job file: a 20 × 20 × 3 mm cube sliced with PrusaSlicer 2.9.7 (Marlin flavour).
- One print ran to the end, a second one was cancelled at 47%.

| File | Request |
|---|---|
| `version.json`, `server.json`, `connection.json` | `GET /api/version`, `/api/server`, `/api/connection` |
| `job-offline.json`, `printer-offline-409.json` | `GET /api/job` and `GET /api/printer` (HTTP 409) with no printer connected |
| `printer-idle.json`, `printer-printing.json` | `GET /api/printer` |
| `job-printing.json`, `job-finished.json`, `job-cancelled.json` | `GET /api/job` during a print, after it finished, after a cancel |
| `upload.json` | `POST /api/files/local` |
| `file.json`, `file-after-finished.json`, `file-after-cancelled.json` | `GET /api/files/local/<name>`: the analysis, then the print statistics |
| `download-range.json` | what `GET /downloads/files/local/<name>` answered to `Range: bytes=-2048` (HTTP 206) |
| `push-sequence.json` | every message of the push socket (`/sockjs/websocket`) over both prints, with the time it arrived. `logs` and `messages` are cut. |

What they show:
- `/api/job` after a cancel has an empty `progress` and state `Operational`: only the push events say the print was cancelled.
- A cancel raises `PrintCancelled` **and** `PrintFailed` with `reason: "cancelled"`.
- Filament is the file's analysis only (`length` in mm, `volume` in cm³): no grams, and nothing about what a stopped print really used.
