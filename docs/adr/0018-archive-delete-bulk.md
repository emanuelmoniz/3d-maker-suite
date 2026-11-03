# ADR-0018: Archive, delete and bulk actions

- Status: Accepted (Plan 5.2.0 Step 8)
- Date: 2026-11-03

## Context
Only some entities can be archived today, and "Delete" means different things per entity: printers and accessories archive, orders and quotes unlink what used them, catalog rows rely on a caught FK error, and spools, filament profiles and maintenance types have no delete at all. A refused delete says "in use" without saying by what. Nothing can be done to many rows at once.

Plan 5.2.0 Phase 22 gives every entity the same three actions. This ADR is the design Steps 9-12 follow, checked against all 65 foreign keys of a freshly migrated database (`pragma foreign_key_list`). That check found FKs that would silently do the opposite of the design, so the table below is the source of truth, not the FK actions.

## Decision

### The three actions
Applies to 16 entities: printers, accessories, maintenance types, printer brands, printer models, machine profiles, print profiles, spools, filament brands, filament materials, filament profiles, projects, prints, orders, quotes, clients. Maintenance task records stay permanent history.

- **Archive** hides an item from lists and pickers; a "Show archived" filter finds it and Restore brings it back. Stats, costs and spool weight still count it.
- **Delete** is real and only works when nothing depends on the item. Archived items still block.
- **Bulk** runs either one on many rows, reporting the ones it couldn't do.

A reference to the item has one of three outcomes on delete:
- **Blocks:** the delete is refused with a 409 naming it.
- **Goes:** the referencing row is deleted in the same transaction.
- **Clears:** the reference is emptied and the row stays.

### Dependency table
Every FK to one of the 16, plus the references that have no FK. **Enforced by** says what makes the outcome true: the FK alone, or the helper Step 10 adds (one helper driven by this table, used by every `DELETE`).

| Item | Referenced by | FK on delete | Outcome | Enforced by |
|---|---|---|---|---|
| Printer brand | `printer_models.brand_id` | RESTRICT | Blocks | helper, FK as backstop |
| Printer model | `printers.model_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `machine_profiles.printer_model_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `print_profiles.printer_model_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `maintenance_types.applies_to_model_ids` | no FK (JSON) | Blocks | helper only |
| Machine profile | `prints.machine_profile_id` | RESTRICT | Blocks | helper, FK as backstop |
| Print profile | `printers.print_profile_id` | SET NULL | Clears | FK |
| | `project_slice_plates.print_profile_id` | SET NULL | Clears | FK |
| Printer | `prints.printer_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `maintenance_tasks.printer_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `accessory_installs.printer_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `maintenance_types.applies_to_printer_ids` | no FK (JSON) | Blocks | helper only |
| | `printer_comments.printer_id` | CASCADE | Goes | FK |
| | `project_slice_plates.printer_id` | SET NULL | Clears | FK |
| | `defaultPrinterId` setting | no FK | Clears | helper only |
| Accessory | `maintenance_tasks.accessory_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `accessory_installs.accessory_id` | **CASCADE** | Blocks | helper only: the FK would delete the install history |
| | `maintenance_types.applies_to_accessory_ids` | no FK (JSON) | Blocks | helper only |
| | `accessory_comments.accessory_id` | CASCADE | Goes | FK |
| Maintenance type | `maintenance_tasks.type_id` | RESTRICT | Blocks | helper, FK as backstop |
| Filament brand | `filament_profiles.brand_id` | RESTRICT | Blocks | helper, FK as backstop |
| Filament material | `filament_profiles.material_id` | RESTRICT | Blocks | helper, FK as backstop |
| Filament profile | `spools.profile_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `print_filament_usages.profile_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `project_slice_plates.filaments` | no FK (JSON) | Clears | reads as null already |
| Spool | `print_filament_usages.spool_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `spool_weight_entries.spool_id` | **RESTRICT** | Goes | helper: the FK would refuse, so the entries go first |
| | `project_slice_plates.spools` | no FK (JSON) | Clears | reads as null already |
| Project | `prints.project_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `order_projects.project_id` | RESTRICT | Blocks | helper, FK as backstop |
| | `quotes.project_id` | **SET NULL** | Blocks | helper only: the FK would unlink |
| | its folder still having files | no FK | Blocks | `folder_has_files`, see "Imported rows" |
| | `project_slice_plates.project_id` | CASCADE | Goes | FK |
| | `collection_projects.project_id` | CASCADE | Goes | FK |
| | `device_projects.project_id` | CASCADE | Goes | FK |
| Print | `print_filament_usages.print_id` | CASCADE | Goes | FK, after `syncUsages` returns the filament to its spools |
| Order | `prints.order_id` | **SET NULL** | Blocks | helper only: the FK would unlink |
| | `order_projects.order_id` | CASCADE | Goes | FK |
| Quote | `orders.quote_id` | **SET NULL** | Blocks | helper only: the FK would unlink |
| Client | `orders.client_id` | **SET NULL** | Blocks | helper only: the FK would unlink |
| | `quotes.client_id` | **SET NULL** | Blocks | helper only: the FK would unlink |

Why the JSON lists block: a maintenance type whose `applies_to_*` lists are all empty applies to everything (`appliesToPrinter`, `appliesToAccessory` in `core/services/maintenanceDue.ts`). Removing the last id would silently put the type on every printer, and leaving a stale id makes it apply to nothing with no sign of why. So the 409 names the type and the user edits it.

Why a client's quotes block: a project is blocked by its quotes, and a quote that loses its client no longer says who it was for.

**No FK at all, in the same transaction as the delete:**
- `taggings` of a spool, printer or accessory. A project's taggings move here from its route; a print's keep their trigger (`prints_taggings_cleanup`, the only trigger in the schema).
- `import_snapshots` of the row. This removes the `ponytail:` note on that table.
- Open alerts of the item (see "Archive side effects").
- After the commit: its image files (logo, model image, photo, thumbnail). Catalog deletes leave these on disk today.

`quotes.form` is a free JSON snapshot of the calculator, so it isn't a dependent. Step 10 tests that reopening a quote with a stale id in it doesn't fail.

**Out of scope, unchanged.** These 31 FKs point at tables that keep their own rules:

| Parent | Referenced by |
|---|---|
| `users` | `alert_states.user_id`, `devices.user_id`, `pairing_codes.user_id`, `projects.owner_id`, `root_editors.user_id`, `sessions.user_id`, `user_settings.user_id` |
| `roles` | `users.role_id` |
| `integrations` | `filament_profiles.integration_id`, `import_snapshots.integration_id`, `printers.integration_id`, `prints.integration_id`, `project_slice_plates.slicer_integration_id`, `projects.integration_id`, `projects.slicer_integration_id`, `sync_policies.integration_id`, `sync_runs.integration_id` |
| `roots` | `device_root_folders.root_id`, `hub_files.root_id`, `projects.root_id`, `projects.unlinked_root_id`, `root_editors.root_id` |
| `devices` | `device_projects.device_id`, `hub_events.device_id`, `hub_files.lock_device_id`, `pairing_codes.device_id` |
| `hub_files` | `hub_file_versions.file_id` |
| `slicer_presets` | `slicer_preset_versions.preset_id` |
| `alerts` | `alert_states.alert_id` |
| `tags` | `taggings.tag_id` |
| `collections` | `collection_projects.collection_id` |

Step 10 adds a guard test: it reads `pragma foreign_key_list` and fails on any FK to one of the 16 that the helper's map doesn't cover, so a new table can't skip this.

### The `in_use` error
```json
{
  "error": {
    "code": "in_use",
    "message": "Still used by other records",
    "details": {
      "dependents": [
        {
          "type": "print",
          "total": 12,
          "archived": 3,
          "items": [{ "id": "…", "label": "12-Vase", "archived": false }]
        }
      ]
    }
  }
}
```
- The zod schema lives in core, like every other shape. `type` is the key the web uses for ICU plurals and links. `label` is data, built with the existing label helpers.
- At most 20 `items` per type, active ones first; `total` and `archived` count them all.
- `items` only holds rows the caller may read (`visibleProjects`, the module's read level). `total` still counts the others, so a 409 never leaks a hidden project's name.
- `HttpError` gets an optional `details`, and the handler in `app.ts` passes it on. Today it sends only `code` and `message`.
- `folder_has_files` stays its own code and is checked after `in_use`: the user can only act on it once the rest is free.

What changes for today's callers:

| Route | Today | New |
|---|---|---|
| `DELETE /printers/:id`, `/accessories/:id` | archives, 204 | really deletes, or `in_use`. The web archives through `PATCH` and doesn't call these; tests and API users do, so the CHANGELOG says so |
| `DELETE /orders/:id` | prints stay without an order, 204 | `in_use` when a print uses it |
| `DELETE /costs/quotes/:id` | orders stay without a quote, 204 | `in_use` when an order uses it |
| `DELETE /clients/:id` | `client_in_use` on orders; quotes lose the client | `in_use` on orders or quotes |
| `DELETE /projects/:id` | `project_has_prints`, `project_in_order`; quotes lose the project | `in_use` on prints, orders or quotes. `ProjectDetailPage.tsx` and `projects.json` lose those two keys |
| Catalog `DELETE` (`crud` in `routes/catalog.ts`) | `in_use` with no details, from a caught FK error | same code, with details, from the helper |
| Spools, filament profiles, maintenance types | no `DELETE` | new |

### Imported rows
What the next sync does with a row you archived or deleted. All of this applies to sourced rows only (`sourced` in `import/review.ts`): a file import is a person's act and ignores it.

**Archived.** The row is offered as a skip against the archived one, never written by a run, and an update restores it. That is the existing `archived` hook in `import/review.ts`.
- Printers, spools and filament profiles have it.
- Machine and print profiles don't, so today's next sync re-adds an archived one as a new row. They get it, and so do brands, printer models, filament brands and filament materials, which gain `archivedAt` in Step 9.
- Prints need no hook: `bySource` and `known` already find an archived print, and `handsOff` skips it.

**Deleted.** A new table remembers it, since the row itself is gone:

```
deleted_sources (entity, source, deleted_at)  primary key (entity, source)
```

`source` is what the row is matched by:

| Entity | `source` |
|---|---|
| Printers, prints | `<integrationId>:<externalId>` |
| Spools | `sourceSpool` |
| Filament, machine and print profiles | `sourcePreset` |
| Printer brands, printer models, filament brands, filament materials | the lowercase name (these match by name) |

- A mark only counts when no existing row matches: one you have, or one you archived, is the row.
- The row is offered as a skip marked "you deleted this", `optional` like an archived one, so an auto run never writes it and it doesn't count as pending. Importing it by hand clears the mark.
- A brand or model that a child row needs (`modelIdFor`, `filamentBrandIdFor`) is still created, and that clears its mark. The child is what you asked to keep.
- Marks of a removed integration stay and do nothing, because a new integration gets a new id.

**Projects** have no sync type, but they come back through the scanner, by two paths this design closes:
- A device-root project: `projectDir` returns null on a device, so `folder_has_files` never fires, and the project is recreated when the folder next changes. Now a `device_root_folders` row for its folder counts as files. It also holds while the device is offline.
- An unlinked project whose folder was kept: deleting it removes the `unlinked*` row the scanner's `kept` check reads, so the folder is scanned back in. Now the kept folder is checked the same way.

### Unique names and numbers
An archived row keeps its name, number, VAT, mobile, email, folder and source key. These indexes aren't partial, so a restore can never conflict.

- Today's codes stay: `duplicate`, `<entity>_number_taken`, `client_vat_taken` and its siblings, `folder_in_use`. The web's text says the other row may be archived, since it isn't in the list.
- `nextNumber` is max + 1 over the whole table, so an archived number isn't reused. A deleted top number can be, as a deleted project's already is today.
- A name match in an import (`idByName`, `modelIdFor`) links to an archived parent without restoring it. It isn't a picker, and an archived reference still displays.

**The exception** is `*_source_uq` on machine, print and filament profiles. These are partial, because `archivedAt` also marks an old preset version kept for the prints that used it. So:
- Restoring an old version while a current one exists gets a 409 `preset_newer_exists`.
- "Show archived" lists old versions too.
- When an `archived` hook finds several rows for one source, the newest wins.

### Archive side effects
- **Installed accessories:** `printer_has_accessories` and `accessory_installed` stay as 409s on archive, and bulk reports them as blocked. They drop off `DELETE`, where the installs block anyway.
- **Scanner:** keeps updating an archived project (`at(place)` doesn't filter), so it holds its folder and is current on restore.
- **Auto slice:** skips archived projects, in `autoSliceOn`, so nothing slices or alerts for a hidden project. Slicing by hand still works.
- **Locks and connector sync:** unchanged. `hub_files` are per root, `device_projects` rows stay, and a held lock stays. Stopping sync on archive could make a connector drop its local copies.
- **Root removal:** archived projects still hold their root (`root_in_use`), and the web's text says so.
- **Alerts:** condition alerts already filter archived rows, but only resolve at the next scheduled evaluation, and one-shots like `slice_failed` never do. Archive and delete resolve the item's open alerts by `task` in the same transaction: `spool:<id>`, `printer:<id>`, `project:<id>`, and `maintenance:<target>:<type>` on either side. A restored item's alerts come back as new at the next evaluation.
- **New references:** the server refuses a new reference to an archived row where a check already exists (`checkModel`, `checkPrintProfile`, `checkProject`, `checkClient`), as spools and filament profiles already do. An unchanged reference is allowed, so a row with an archived parent can still be edited.

### Permissions
Single-row actions keep today's level: archive and delete follow the route's module rule in `lib/auth.ts`. Bulk needs `manage` on the item's module (printers, maintenance, filament, projects, prints, costs). Project bulk also checks per-project access: projects the user can't edit are skipped and reported.

### Bulk
Each row goes through the same archive and delete code as a single one, in its own transaction, so free rows go through and blocked ones don't undo them. The result lists the done ids and the blocked rows, each with its code and details, which the web shows in one dialog with links.

Rows run in request order. A row blocked by another in the same request (a project and its quote) is reported as blocked and can be retried.

One shared route, `POST /api/bulk/:kind` with `{ action, ids }`, answers 200 with `{ done, blocked }`, including when every row is blocked. It takes at most 100 ids, the API's largest page, because a selection is one page's rows.

Each row is the `PATCH` or `DELETE` its own button sends, replayed in process as the same caller (`app.inject`). So a row can't drift from the single-row code, its error becomes its `blocked` entry, and `authGuard` applies per-project access: a hidden project is `not_found` and a download-only one `forbidden`. A replayed row skips the on-change alert check, and the bulk request runs one when it ends.

## Rejected options
- **Archive only, no delete.** A mistake or a test row could never be removed.
- **Cascading delete.** One click would remove prints and their costs from stats.
- **Reassigning dependents in the delete dialog.** A second editor for every relation. The 409 links to the rows instead.
- **Tightening the SET NULL and CASCADE FKs to RESTRICT.** Each needs a table rebuild, and the note on `roots` in `schema.ts` shows what a rebuild inside the migrator's transaction can cascade to. The helper and the guard test cover it, and writes are synchronous, so nothing interleaves between check and delete.
- **A `deletedAt` on the row instead of `deleted_sources`.** Every query would filter it, and the row would keep holding its unique values.
- **Partial unique names and numbers, freed while archived.** A restore could then conflict and would need a rename flow.
- **Stopping connector sync on archive.** Archive would stop being reversible with nothing else changing.
- **Removing ids from `applies_to_*`.** It changes what a maintenance type applies to without asking, and an emptied list means everything.
- **A trash with undo.** Backups cover recovery, and a trash needs every query to filter it, the same as `deletedAt`.

## Consequences
- `DELETE` on a printer or accessory now removes the row. This is a behaviour change for API users, in the CHANGELOG, on a minor version: the web never called these, and one with history is refused rather than lost.
- A printer that has printed can't be deleted, only archived, and neither can one with a maintenance task, since those records are permanent. That is the point.
- Six blocks rest on the helper alone, with the FK saying otherwise. The guard test keeps the map complete, but a raw `db.delete` that skips the helper would take the FK's action.
- `spool_weight_entries` is append-only except when its whole spool is deleted.
- `archivedAt` keeps two meanings on profiles (archived by you, old preset version), and "Show archived" shows both.
- One new table, `deleted_sources`, whose marks are never pruned. They are few, one row per deleted imported item.
