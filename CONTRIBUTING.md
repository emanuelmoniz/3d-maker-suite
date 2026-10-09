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

## Ground rules

- `packages/core` and `apps/*` never import from a vendor adapter.
- No hard-coded UI strings. Every text goes through i18next keys in `apps/web/src/locales/en/*.json`.
- Zod schemas in `packages/core/src/schemas` are the only type source.
- Secrets are encrypted at rest and never logged or returned by the API.
- Commit messages follow Conventional Commits, for example `feat(printers): add comment pinning`.

## How to add an adapter

An adapter is a vendor package in `packages/adapters/<vendor>`. It implements interfaces from `packages/core/src/integrations`.

1. Create the package (copy `packages/adapters/mock` as a starting point). Export an `IntegrationAdapter` with `id`, `configSchema`, `secretsSchema`, `login` and `create`.
2. Implement only the capabilities the vendor supports: `printers`, `printHistory`, `spools`. Return DTOs; never touch the database.
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

Maintainers tag a version (`git tag v1.0.0 && git push --tags`). The release workflow runs the checks and attaches a source archive to the GitHub release. Add the entry to [CHANGELOG.md](CHANGELOG.md) first.
