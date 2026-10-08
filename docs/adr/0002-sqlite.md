# ADR-0002: SQLite as the only database

- Status: Accepted
- Date: 2026-10-08

## Context
The app runs as one process for one user (ADR-0001). It needs relational integrity (prints, spools, usages), aggregate queries for stats, and zero setup.

## Decision
- **SQLite** through **better-sqlite3**, with **Drizzle ORM** for the schema and queries.
- One file, `app.sqlite`, in the data dir.
- On open: `journal_mode = WAL` and `foreign_keys = ON`.
- The schema lives in `packages/db`. Every change is a Drizzle migration (`pnpm db:generate`). Migrations are applied automatically on startup, and an applied migration is never edited.
- Backups use `VACUUM INTO 'backups/<timestamp>.sqlite'`, which gives a consistent snapshot while the app is running.

## Alternatives rejected
- **PostgreSQL / MySQL:** a separate server to install and run, which is overkill for one user.
- **JSON files / lowdb:** no joins, no constraints, and the risk of corrupt writes.
- **Node built-in `node:sqlite`:** still experimental on Node 22, and Drizzle support is less mature.

## Consequences
- Zero configuration, and the whole state is one file plus a key.
- Synchronous driver calls are fast for this workload. Long scans (3MF parsing) run outside DB transactions.
- better-sqlite3 is a native module. Prebuilt binaries cover Windows, macOS and Linux on Node 22 LTS.
- One writer at a time. That's fine for a single-user app with a few background jobs.
