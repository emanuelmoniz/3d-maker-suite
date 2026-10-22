# ADR-0010: Stay on SQLite, no external database servers

- Status: Accepted
- Date: 2026-10-22

## Context
ADR-0002 chose SQLite. Users who run the app in Docker on a NAS or server ask for MariaDB, PostgreSQL or SQL Server so the data can live on an existing database server.

## Decision
SQLite through better-sqlite3 stays the only database. External database servers are not supported.

## Reasons
- **Drivers:** Drizzle has no SQL Server driver. MariaDB lacks `RETURNING` and `ON CONFLICT` in Drizzle, which the code uses in 68 places.
- **Synchronous access:** all data access is synchronous better-sqlite3 (about 390 calls, 21 transactions). A network database is asynchronous, so every call site, transaction and the code that relies on a transaction not yielding would change.
- **SQLite-only SQL:** about 25 spots use SQLite-only SQL (pragmas, `VACUUM INTO` for backups, SQLite functions) that differs per engine.
- **One file:** backup, restore, update and rollback copy or swap the DB file (ADR-0002, ADR-0009). With a server, each of them would need its own per-engine procedure.
- **Cost for the user:** the app is one process for one user (ADR-0001); a second server to install and maintain adds setup and failure modes without a workload that needs it.

## What would change the decision
- Several users writing at the same time (the multi-user plan) that WAL's single writer can't serve.
- A real need that SQLite can't meet (database size, or a shared DB across several app instances).
- Drizzle gaining the missing driver and features, with the data layer moved to async calls first.

If that happens, it needs a new ADR, a dialect-neutral data layer and a migration path from the SQLite file.

## Consequences
- Docker users keep the data directory on a volume and back it up as files.
- No per-engine test matrix or migrations.
