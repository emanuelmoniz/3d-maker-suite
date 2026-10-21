# ADR-0008: Alerts carry severity, module, task and detail

- Status: Accepted
- Date: 2026-10-21

## Context
An alert was a `kind` plus the entity it is about and a few display values. How bad it was lived in the kind or in its context (`overdue`). Nothing said which part of the app raised it, and a sync alert could not show what the run did. Step 13 lets each task pick which severities it raises, so the severity and the task have to be explicit.

## Decision
- Every alert has:
  - **severity**: `error` · `warning` · `success`.
  - **module**: `filament` · `maintenance` · `printers` · `integrations` (the nav module the task lives in).
  - **task**: a stable key of what raised it: `spool:<id>`, `maintenance:<targetId>:<typeId>`, `printer:<id>`, `sync:<integrationId>:<type>`. Step 13 hangs its settings on it.
  - **kind**: kept. It is the message (which i18n key, which notification text). Severity and kind are separate because one kind can change severity (maintenance due soon → overdue).
  - **context**: kept, the title's names and numbers, refreshed on every evaluation.
  - **detail**: optional JSON for the expanded view; null = nothing more to show.
- **Raising goes through one place** (`apps/server/src/alerts/evaluate.ts`):
  - Conditions (low spool, maintenance, warranty, pending review) are found by `evaluateAlerts` as before. Their severity, context and detail are refreshed in place on each run.
  - Events (a sync run's result) call `raise()` once, keyed by the run, as before.
  - A severity change on an open alert (due soon → overdue) updates the row and does not notify again.
- **Sync run log:** each run stores a bounded, structured log on `sync_runs.log`: one entry per row created, updated, invalid or left for review, and the error code if it failed. Entries are codes plus the row's title or name, never raw errors or vendor messages; those go to the local pino log only (ADR-0003, ADR-0005). At most 200 entries, then one `truncated` entry with the count. The app translates the entries, so no English is stored.
- **The alert keeps its own copy** of the log in `detail` (`{ runId, log }`), because runs are pruned (200 per integration) while an event alert stays until it is dismissed. A pending-review alert takes the latest run's `left` entries ("the prints no spool matched") and refreshes them along with its count. A run without any (a failed one) leaves the detail as it was.
- The list endpoint leaves `detail` out (the app polls it every minute) and returns `hasDetail`. `GET /api/alerts/:id` returns the detail.

## How the old kinds map (migration 0054)
| Old kind | Kind | Severity | Module | Task |
|---|---|---|---|---|
| `spool_low` | same | warning | filament | `spool:<spoolId>` |
| `maintenance_due` | same | warning; error if `overdue` = 1 (`overdue` is dropped from the context) | maintenance | `maintenance:<targetId>:<typeId>` |
| `warranty_ending` | same | warning | printers | `printer:<printerId>` |
| `sync_pending` | same | warning | integrations | `sync:<integrationId>:<type>` |
| `sync_success` | same | success | integrations | `sync:<integrationId>:<type>` (from the context) |
| `sync_error` | same | error | integrations | `sync:<integrationId>:<type>` (from the context) |
| `sync_failed` (before 0038) | `sync_error` | error | integrations | `sync:<integrationId>`, resolved if still open (evaluation already resolved them) |
| `print_failed` | removed | – | – | never raised; any rows are deleted |

Open alerts keep their id and their read, snooze, dismiss and notified state, so nothing is sent again. Existing alerts get `detail = null`, because old runs have no log.

## Auto slicing events (migration 0058)
After a scan of a project (full, at startup or of one folder), auto slicing raises events in the new `projects` module. Like the sync events, they are one-shot and stay until dismissed. Each is keyed by the file's new bytes, so scanning the same change again doesn't repeat it, while a new change is new.

| Kind | Severity | Entity id | Task |
|---|---|---|---|
| `slice_setup_changed` (plates added or removed, or a plate uses a slot its setup doesn't map) | warning | `<projectId>:<file>:<sha256>` | `project:<projectId>` |
| `slice_failed` (an auto slice failed) | error | `<projectId>:<file>:<plate>:<sha256>` | `project:<projectId>` |

## Rejected options
- **Severity derived from the kind, not stored.** It breaks for kinds that change severity and for Step 13, where a task chooses its severities. Queries such as "all errors" would need the mapping in SQL.
- **Drop `kind` and keep only module + severity + task.** The app and the channels still need to know which sentence to say, and that is what `kind` is.
- **The detail points at the sync run, no copy.** Runs are pruned while alerts stay. Keeping referenced runs out of pruning couples the two tables to save a few KB.
- **Free-text log lines.** They can't be translated (ADR-0004) and invite raw vendor errors in.
- **A separate `alert_details` table.** One JSON column does it, and the detail is never queried.
- **Separate kinds for due and overdue maintenance.** The alert would resolve and open again (and notify again) when it escalates, which changes today's behaviour. Step 13 can revisit this.

## Consequences
- Step 13 reads per-task settings by `task` and decides which severities to raise.
- The alerts page shows a severity mark, the module, and a "Details" disclosure that loads the log.
- Outside channels (ntfy, email) are unchanged. Severity could set their priority or tags later.
