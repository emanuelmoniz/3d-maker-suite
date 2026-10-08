# ADR-0006: Bambu Cloud as the first integration

- Status: Accepted
- Date: 2026-10-08

## Context
The first integration should cover the most users with the least setup. Bambu Lab printers can be reached three ways:
- **Bambu Cloud:** the HTTP API used by Bambu Studio and Bambu Handy.
- **LAN mode:** local MQTT and FTP with an access code.
- **Developer mode:** full local control, but the cloud features are lost.

## Decision
The first adapter, `packages/adapters/bambu`, implements:
- **Bambu Cloud** for `PrinterInventorySource` and `PrintHistorySource`.
- The **Bambu Studio** local filament library for `FilamentLibrarySource` (Step 14).
- Bambu Studio for `SlicerLauncher`, and MakerWorld for `MarketplaceLinker` (Step 18).

LAN/MQTT (live status, AMS state) comes later, as a separate capability or adapter.

## Why the cloud first
- It works with stock firmware and default printer settings. There's no LAN mode, developer mode or access code to set up.
- It has the full **print history**, including jobs started from the phone app or while the PC was off. That's the core data for stats and costs.
- One sign-in covers every printer on the account.

## Risks and mitigations
- **The API is unofficial** and can change without notice. Mitigation: the adapter is isolated (ADR-0003), DTOs are zod-validated, and failures surface as a `sync_failed` alert instead of crashes.
- **Auth:** email codes / 2FA and token expiry. Mitigation: an interactive sign-in (`IntegrationAdapter.login`) stores only the token. Upstream token refresh no longer works (the endpoint only answers 401), so an expired token (about 3 months) maps to `auth_expired` and the UI asks the user to sign in again.
- **Rate limits and bot protection:** incremental sync (`since: lastSyncAt`), a modest job interval, and a 1 h scheduled-sync pause after `rate_limited` / `blocked` (Cloudflare challenge). Response shapes are zod-checked; a mismatch is reported as `api_changed`.
- **Region:** global and China endpoints are a config option of the integration.
- Phase 1 is fully usable without any integration, so an outage never blocks the user.

## Consequences
- Requires an internet connection and a Bambu account to sync. Manual entry is always available.
- Tokens are stored as described in ADR-0005.

## Sources (unofficial API, checked 2026-10)
- OpenBambuAPI, cloud-http.md: https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md
- ha-bambulab pybambu (login, email code, TFA + CSRF, bind): https://github.com/greghesp/ha-bambulab/tree/main/custom_components/bambu_lab/pybambu
- ha-bambulab #2136 (CSRF endpoint is /api/csrf) and #692 (Cloudflare 403 on login)
