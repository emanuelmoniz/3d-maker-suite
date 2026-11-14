# PrusaLink fixtures

**Not captured hands-on.** No Prusa printer was at hand for ADR-0015 (Plan 6.0.0 Step 1) and PrusaLink has no simulator. These payloads were published from real printers by others; a real printer must confirm them before the PrusaLink adapter ships.

Source: Home Assistant's PrusaLink tests, [`tests/components/prusalink/conftest.py`](https://github.com/home-assistant/core/blob/7f18b3eb6ae0f264c8c4594f80820d28256bfb8b/tests/components/prusalink/conftest.py) (commit `7f18b3e`, 2026-10-19, Apache-2.0), an XL on firmware 6.1.2. Copied 2026-11-14, values unchanged.

| File | Request |
|---|---|
| `version.json` | `GET /api/version` |
| `info.json` | `GET /api/v1/info` |
| `status-idle.json`, `status-printing.json` | `GET /api/v1/status` |
| `job-printing.json` | `GET /api/v1/job` |
| `job-idle-mk3.json` | `GET /api/v1/job` on an MK3 (PrusaLink on a Pi), which keeps the last job |
| `legacy-printer.json` | `GET /api/printer`, the only place the loaded material is named |

Not in a file:
- `GET /api/v1/job` with no job answers **HTTP 204** with no body (MK4, XL, MINI).
- Sign-in is HTTP Digest (user `maker`), per Prusa's [OpenAPI spec](https://github.com/prusa3d/Prusa-Link-Web/blob/337fabbd581de28dce85f1bfb773c150128c6437/spec/openapi.yaml) (`1.0.0-draft`, GPL-3.0, not copied here). States: `IDLE`, `BUSY`, `PRINTING`, `PAUSED`, `FINISHED`, `STOPPED`, `ERROR`, `ATTENTION`, `READY`.
- The spec lists a `meta` object on a print file (`filament used [g]`, …), but the firmware of the MK4, XL and MINI doesn't send it: [`file_info.cpp`](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/6cca0a68f5172088da814ff0177d26c02c89f46e/lib/WUI/nhttp/file_info.cpp) writes name, size, timestamp and `refs` only. Grams come from the file itself, through `refs.download`.
- Nothing reports the filament a stopped job really used.
