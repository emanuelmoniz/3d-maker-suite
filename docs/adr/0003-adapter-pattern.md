# ADR-0003: Brand-agnostic core with vendor adapters

- Status: Accepted
- Date: 2026-10-08

## Context
Bambu Lab is the first vendor (ADR-0006), but users also own Prusa, Creality and Klipper machines, and use other slicers and marketplaces. Vendor APIs are unofficial and change often. The domain must not depend on any of them.

## Decision
- `packages/core/src/integrations` defines small **capability interfaces**: `PrinterInventorySource`, `PrintHistorySource`, `FilamentLibrarySource`, `ProjectSource`, `SlicerLauncher` and `MarketplaceLinker`. The signatures are in `docs/architecture.md`.
- Each vendor lives in `packages/adapters/<vendor>` and exports one `IntegrationAdapter`. Its `create()` returns an instance where every capability is an **optional property**.
- **Adapters return DTOs and never touch the database.** Core validates the DTOs with zod and upserts them by `(integrationId, externalId)`. Sync logic, deduplication and alerts are written once, in core.
- Adapters get their config, a scoped `SecretStore`, a logger and an `AbortSignal` through `IntegrationContext`. They never read the DB or the env directly.
- Adapter errors map to `IntegrationErrorCode` (`auth_required`, `auth_expired`, …), never vendor messages.
- The registry is a **static list** in the server composition root. There's no dynamic plugin loading.
- Biome `noRestrictedImports` blocks imports of `@3d-maker-suite/adapter-*` outside the composition root (`apps/server/src/integrations/registry.ts`).

## Consequences
- Adding a vendor means adding one package and registering it, with no core changes unless a new capability is needed.
- Every feature works in manual mode, with integrations only filling data in.
- The DTO shapes are a lowest common denominator. Vendor-specific extras stay in the adapter or are dropped.
- Brand-agnostic built-ins, such as the local 3MF folder `ProjectSource`, live in the server and not in an adapter package.
