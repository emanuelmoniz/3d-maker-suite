# Contributing

Thanks for helping. Read [docs/architecture.md](docs/architecture.md) and the ADRs in [docs/adr](docs/adr/) first; they explain the rules this project keeps.

## Setup

```bash
pnpm install
pnpm dev            # server + web, watch mode
pnpm test           # unit tests (Vitest)
pnpm test:e2e       # Playwright
pnpm lint           # Biome
pnpm typecheck
pnpm i18n:check     # missing or unused translation keys
```

Database changes go through Drizzle migrations only: `pnpm db:generate`, then `pnpm db:migrate`. Never edit a migration that was already applied.

Before a release, run the release journeys on a copy of real data. The file is only read and never committed; the copy's alert delivery is removed, its integrations are off or fake, and its project roots point at a temp folder, so nothing gets mailed or deleted:

```bash
REAL_DB=/path/to/app.sqlite pnpm vitest run apps/server/src/release.test.ts
REAL_DB=/path/to/app.sqlite pnpm exec playwright test real-data   # after building the web app
```

Without `REAL_DB`, `release.test.ts` runs on made-up rows (as in CI) and `real-data.e2e.ts` is skipped.

## Ground rules

- `packages/core` and `apps/*` never import from a vendor adapter.
- No hard-coded UI strings. Every text goes through i18next keys in `apps/web/src/locales/en/*.json`.
- Zod schemas in `packages/core/src/schemas` are the only type source.
- Secrets are encrypted at rest and never logged or returned by the API.
- Commit messages follow Conventional Commits, for example `feat(printers): add comment pinning`.

## How to add an adapter

An adapter is a vendor package in `packages/adapters/<vendor>`. It implements interfaces from `packages/core/src/integrations`.

1. Create the package (copy `packages/adapters/mock` as a starting point). Export an `IntegrationAdapter` with `id`, `kind`, `capabilities`, `configSchema` and `secretsSchema`, plus `login` and `create` for an account (`kind: "cloud"`) or `library` for a slicer folder (`kind: "local"`). A vendor with both ships two adapters.
2. Declare and implement only the capabilities the source really has. Return DTOs; never touch the database.
3. Validate every vendor response with zod. Map failures to `IntegrationErrorCode`, so the UI can show a message.
4. Add `"@3d-maker-suite/adapter-<vendor>": "workspace:*"` to `apps/server/package.json`, then register it in `apps/server/src/integrations/registry.ts`. That file is the only place that imports adapters.
5. Add the UI name under `integrations:adapters.<id>.name` in `apps/web/src/locales/en/integrations.json`.
6. Add tests for the adapter with recorded or fake responses. No live calls in CI.

## How to add a language

1. Copy `apps/web/src/locales/en/` to `apps/web/src/locales/<code>/` (for example `de`) and translate the values. Keep the keys identical.
2. Run `pnpm i18n:check`.
3. Register the language's `common` and `nav` bundles in `apps/web/src/i18n.ts`. Feature namespaces load on demand from the folder.
4. Use ICU-style plural keys (`_one`, `_other`) and `Intl` for dates and numbers. Never concatenate sentences.

Known gap: `common` and `nav` are bundled for English only in `i18n.ts`. Make them lazy like the other namespaces before shipping a second language.

## Pull requests

- Keep the change small and focused on one step.
- Tests, lint, typecheck and `pnpm i18n:check` must pass.
- Describe how you checked the change in the UI, if it touches the UI.

## Releases

Maintainers tag a version after the release checklist below. Do the steps in this order:

1. Add the entry to [CHANGELOG.md](CHANGELOG.md) as the newest `## [X.Y.Z]` heading.
2. Bump `version` in the root `package.json` and every `apps/*` and `packages/*` `package.json` (all the same version).
3. Put `Version X.Y.Z.` on the status line of [README.md](README.md).
4. Check the docs that name features or versions (README features, `docs/*.md`, the screenshots if the UI changed).
5. Write the CHANGELOG entry so it lists everything that differs from the last release: the workflow publishes it as the GitHub release notes (`node scripts/release-notes.mjs X.Y.Z` previews them). A stable release's notes merge in all its pre-releases' sections.
6. Run `pnpm version:check`. The release workflow runs it too and fails on a mismatch or on a tag that isn't `v` plus the version.
7. If a new OrcaSlicer is out, open it once on a Windows PC and run `pnpm vitest run packages/slicer-presets/src/opc.test.ts`. Its real-install test reads that machine's `.opc` files, whose format is private ([ADR-0013](docs/adr/0013-managed-slicer.md)).

- **Stable** (`vX.Y.Z`) is tagged on `main`. Fast-forward `main` to `dev` first.
- **Pre-release** (`vX.Y.Z-alpha.N`) is tagged on `dev`.

The release workflow runs the checks, builds the app and connector installers and their update zips on every OS (each one installed and started once), attaches them with a source archive, `SHA256SUMS` and GitHub artifact attestations to the GitHub release (a suffixed tag is marked as a pre-release) and publishes the Docker image to `ghcr.io/emanuelmoniz/3d-maker-suite`. It fails if a tag is on the wrong branch. The in-app update check reads these releases: stable users see only stable ones, dev users see pre-releases too (see [ADR-0009](docs/adr/0009-updates.md)).
