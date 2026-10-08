# 3D Maker Suite

Local-first manager for 3D printing: printers, maintenance, filament, projects, prints, costs and stats.

- Display name: **3D Maker Suite** (use this in the UI, docs and README)
- Repo / CLI / folder name: `3d-maker-suite`
- Workspace package scope: `@3d-maker-suite/*` (e.g. `@3d-maker-suite/core`)
- i18n key for the app name: `common:appName` (never hard-code the name in components)

Runs locally on the user's PC (no Docker for now). Public GitHub repo. Brand-agnostic core; Bambu Lab is the first integration (Bambu Cloud first).

## Golden rules
- **Core is brand-agnostic.** `packages/core` and `apps/*` never import from a vendor adapter. Vendors live only in `packages/adapters/<vendor>` and implement interfaces from `packages/core/src/integrations`.
- **No hard-coded UI strings.** Every user-facing text goes through i18next keys (`apps/web/src/locales/en/*.json`). Only EN ships for now, but code must stay multi-language ready (no string concatenation for sentences, use ICU plurals, locale-aware dates/numbers/currency).
- **One source of truth for types:** zod schemas in `packages/core/src/schemas` → used by API validation, OpenAPI and frontend.
- **DB changes only via Drizzle migrations.** Never edit an applied migration.
- **Secrets** (cloud tokens) are encrypted at rest and never logged or returned by the API.
- **Responsive and accessible:** mobile-first, keyboard navigable, light/dark themes via CSS variables.
- Keep things small: no new dependency without a short reason in the PR/commit message.

## Stack
- pnpm workspaces monorepo, TypeScript (strict), Node 22 LTS
- Server: Fastify, zod, @fastify/swagger, Drizzle ORM + better-sqlite3, croner (jobs), pino (logs)
- Web: React + Vite, TanStack Router + TanStack Query, Tailwind + shadcn/ui, i18next, Recharts, @react-three/fiber + drei (3D)
- Files: yauzl + fast-xml-parser (3MF), chokidar (folder watching)
- Quality: Biome, Vitest, Playwright, GitHub Actions

## Layout
```
apps/server        Fastify API, jobs, serves built web app
apps/web           React SPA
packages/core      domain model, schemas, services, integration interfaces
packages/db        Drizzle schema + migrations
packages/3mf       3MF parser (pure, tested)
packages/adapters/bambu   Bambu Cloud + Bambu Studio adapter
docs/              ADRs (docs/adr), user docs
```

## Commands
- `pnpm dev` - server + web in watch mode
- `pnpm start` - production build, one command for end users
- `pnpm test` / `pnpm test:e2e`
- `pnpm lint` / `pnpm format`
- `pnpm db:generate` / `pnpm db:migrate`
- `pnpm i18n:check` - missing/unused translation keys

## Workflow
- Work is driven by `PLAN.md`. Read **only the current step** in it, not the whole file.
- **Never read `BACKLOG.md`** unless the user asks; it's the user's private notes (gitignored).
- Finish a step = tests pass, lint passes, `pnpm i18n:check` passes, tick the step checkbox in `PLAN.md`, one conventional commit (`feat(printers): ...`).
- If something is out of scope for the current step, note it in the summary instead of doing it.
- Prefer Context7 MCP for library docs over guessing APIs.
- Keep summaries short: what changed, how to verify, any open questions.
