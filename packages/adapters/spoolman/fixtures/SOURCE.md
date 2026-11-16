# Spoolman fixtures

- `spool-list.json`: one real spool from **Spoolman 0.27.1**, captured 2026-11-14 for ADR-0015 (Plan 6.0.0 Step 1) with `spike/printers/moonraker.mjs` on branch `spike/printers`. It is `spoolman-spool-around-complete.json` → `after` from `packages/adapters/moonraker/fixtures`, as `GET /api/v1/spool` lists it. Moonraker had charged it for two jobs (`used_weight` 0.30 g).

The writes (`PATCH /spool/{id}`, `POST /spool`, `/vendor`, `/filament`, `/field/spool/{key}`) were not captured. `src/fake.ts` follows Spoolman's API documentation for them (https://donkie.github.io/Spoolman):
- a `PATCH` changes only the fields it sends, and an `extra` it sends replaces all extra fields;
- `remaining_weight` and `used_weight` can't be set together;
- an extra value is JSON text, and only the keys a field defines are taken (`POST /field/spool/{key}` with `name` and `field_type`).

Check them against a throwaway Spoolman (`docker run -p 7913:8000 ghcr.io/donkie/spoolman`), never one that holds real spools.
