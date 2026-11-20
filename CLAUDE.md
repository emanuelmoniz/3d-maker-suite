# 3D Maker Suite

Local-first manager for 3D printing: printers, maintenance, filament, projects, prints, costs and stats.

- Display name: **3D Maker Suite** (use this in the UI, docs and README)
- Repo / CLI / folder name: `3d-maker-suite`
- Workspace package scope: `@3d-maker-suite/*` (e.g. `@3d-maker-suite/core`)
- i18n key for the app name: `common:appName` (never hard-code the name in components)

Runs locally on the user's PC (Windows, macOS, Linux) or in Docker on a NAS or server. Public GitHub repo. Brand-agnostic core; Bambu Lab is the first integration (Bambu Cloud first).

## Golden rules
- **Core is brand-agnostic.** `packages/core` and `apps/*` never import from a vendor adapter, except the two registries: `apps/server/src/integrations/registry.ts` and the connector's printer and spool library adapters in `apps/connector/src/sources/registry.ts`. Vendors live only in `packages/adapters/<vendor>` and implement interfaces from `packages/core/src/integrations`.
- **No hard-coded UI strings.** Every user-facing text goes through i18next keys (`apps/web/src/locales/en/*.json`). Only EN ships for now, but code must stay multi-language ready (no string concatenation for sentences, use ICU plurals, locale-aware dates/numbers/currency).
- **One source of truth for types:** zod schemas in `packages/core/src/schemas` → used by API validation, OpenAPI and frontend.
- **DB changes only via Drizzle migrations.** Never edit an applied migration.
- **Secrets** (cloud tokens) are encrypted at rest and never logged or returned by the API.
- **Responsive and accessible:** mobile-first, keyboard navigable, light/dark themes via CSS variables.
- **Canonical Tailwind classes.** Use a registered theme token's utility (`accent-accent`, `wrap-anywhere`) over the arbitrary-value or longhand form (`accent-[var(--accent)]`, `[overflow-wrap:anywhere]`), and don't stack utilities that set the same CSS property (e.g. `outline` with `outline-2`). Biome's linter doesn't catch these; check the tailwindcss-intellisense diagnostics (Problems panel / pasted VS Code diagnostics) for any file you touch.
- Keep things small: no new dependency without a short reason in the PR/commit message.

## Stack
- pnpm workspaces monorepo, TypeScript (strict), Node 22 LTS
- Server: Fastify, zod, @fastify/swagger, Drizzle ORM + better-sqlite3, croner (jobs), pino (logs)
- Web: React + Vite, TanStack Router + TanStack Query, Tailwind + shadcn/ui, i18next, Recharts, @react-three/fiber + drei (3D)
- Files: yauzl + fast-xml-parser (3MF), node:fs recursive watch (folder watching)
- Quality: Biome, Vitest, Playwright, GitHub Actions

## Layout
```
apps/server        Fastify API, jobs, serves built web app
apps/web           React SPA
apps/connector     workstation connector for the hub (ADR-0014): status page, event stream
packages/core      domain model, schemas, services, integration interfaces
packages/db        Drizzle schema + migrations
packages/3mf       3MF parser (pure, tested)
packages/host      node-only helpers for server + connector: autostart, zip, secrets, bundle download
packages/adapters/bambu   Bambu Cloud + Bambu Studio adapter
docs/              ADRs (docs/adr), user docs
wiki/              the user guide's only source: the docs site (GitHub Pages) and the GitHub wiki mirror (guide: docs/wiki-guide.md)
site/              VitePress config that builds the docs site from wiki/ (output site/dist)
```

## Commands
- `pnpm dev` - server + web in watch mode
- `pnpm start` - production build, one command for end users
- `pnpm test` / `pnpm test:e2e`
- `pnpm speed:check` - quick machine check (CPU load, memory, power, benchmark), useful when tests time out
- `pnpm screenshots` - regenerates `docs/images/*.png` for the README and the wiki (`wiki-<screen>.png`, one per screen of the route map; not part of e2e or CI)
- `pnpm lint` / `pnpm format`
- `pnpm db:generate` / `pnpm db:migrate`
- `pnpm i18n:check` - missing/unused translation keys
- `pnpm wiki:check` - wiki links, anchors, images, sidebar and route map (pending pages are listed, `--strict` fails on them)
- `pnpm docs:dev` / `pnpm docs:build` - the documentation site from `wiki/`, live or built into `site/dist`

## Workflow
- Work is driven by `PLAN.md`. Read **only the current step** in it, not the whole file.
- **Never read `BACKLOG.md`** unless the user asks; it's the user's private notes (gitignored).
- **What to check depends on what the step changed (standing rule).** Don't ask the user which tests to run.
  - Only `wiki/` or Markdown docs: `pnpm wiki:check`.
  - The route map (`packages/core/src/wikiRoutes.ts`): `pnpm wiki:check`, `pnpm lint` and `pnpm typecheck`.
  - Wiki tooling (its scripts, workflows and the site in `site/`): the tooling's own tests, `pnpm lint`, `pnpm typecheck` and `pnpm docs:build`; `pnpm screenshots` too if the screenshots script changed.
  - Anything else the app runs (`apps/*`, `packages/*`): the affected tests below, `pnpm lint`, `pnpm typecheck` (vitest does not typecheck; the release workflow fails on it) and `pnpm i18n:check`.
- **Running tests (standing rule).**
  - Steps between releases: only the affected tests (`vitest related <changed files> --run`), plus the e2e specs that cover the changed screens.
  - A release, pre-release on `dev` or stable on `main`: the full suite (`pnpm test` and `pnpm test:e2e`).
  - Always start with the default limits (Vitest 5 s per test, Playwright 30 s per test and 5 s per check, and the limit a slow test sets for itself), and watch the run while it goes.
  - As soon as a test fails on a timeout, stop the whole run. Start the tests that haven't passed yet again with `TEST_TIMEOUT` at double the limit that test failed at, and at least 30000 (PowerShell: `$env:TEST_TIMEOUT=30000; pnpm test`). Double it on each new timeout, up to 240000. A test that still times out at 240000 counts as a failed test. The env var reaches Playwright too, stretches polling helpers and skips speed checks.
  - Any other failure: fix the bug or the test, then re-run it until it passes. Never skip or weaken a test to get it to pass.
  - New tests follow the same timeout rules as the existing ones. Say in the summary which scope and timeouts were used.
- Finish a step = the checks for what it changed pass (`pnpm wiki:check` whenever `wiki/` or the route map changed), docs updated, tick the step checkbox in `PLAN.md`, one conventional commit (`feat(printers): ...`).
- **Docs follow the code, in the same commit.** A step that adds or changes something a user sees or does (a page, a field, a setup flow, a rule such as "one printer per source") or an API or design decision updates every doc that describes it: the user page in `wiki/` (setup steps, what it reads, limits; user guides live only there, and the files in `docs/` are pointers to it), the hub pages (`Hub-Setup`, `Connector-Setup`, `Hub-Management`) when the hub or a connector is involved, `docs/architecture.md` for APIs and data flow, the ADR it changes (amend it, saying which step), and README's feature list and support matrix. Search `wiki/`, `docs/` and README for the feature's names and the UI labels it renames or removes; stale text found on the way, also from earlier steps, gets fixed too. Say in the summary which docs changed.
- **The wiki follows the code (standing rule).** `wiki/` is the source of the documentation site, where users read the guide, and of the GitHub wiki, its mirror. Once a page exists there, any step that changes what it describes (a page, section, field, button, label, right, setup flow or limit) updates that page and its screenshots in the same commit, **before the step is ticked**. A new app page gets its wiki section and Help link in the same step. Never edit the wiki on GitHub, because the next publish overwrites it (the site and the wiki publish together). Don't rename a wiki page or a heading the app links to without updating the route map and leaving a pointer page. If a step needs no wiki change, say so in the summary.
- Release checklist (CONTRIBUTING.md#releases): CHANGELOG entry (it becomes the GitHub release notes via `scripts/release-notes.mjs`, so every release, pre-releases included, must list all changes since the last release), the same version in root, `apps/*` and `packages/*` `package.json`, `Version X.Y.Z.` on README's Status line, docs that name features or versions. `pnpm version:check` must pass before tagging. Never tag while README or docs still show the old version.
- Versioning: stay on 4.x until 5.0.0 (the hub, an agreed major; see PLAN.md), then on 5.x; one plan = one release, minor bump if it adds features, patch if fixes only (major only for an agreed breaking change). Keep root, `apps/*` and `packages/*` versions in sync; `apps/connector` too, because a connector updates to its hub's version.
- Branches: steps commit to `dev`, not `main`. A stable release = fast-forward `main` to `dev` and tag `vX.Y.Z` on `main`. Pre-releases tag `vX.Y.Z-alpha.N` on `dev`. The release workflow fails if a tag is on the wrong branch.
- If a step visibly changes a page that has a README screenshot, re-run `pnpm screenshots` and commit the images in `docs/images`.
- If something is out of scope for the current step, note it in the summary instead of doing it.
- Prefer Context7 MCP for library docs over guessing APIs.
- Keep summaries short: what changed, how to verify, any open questions.
