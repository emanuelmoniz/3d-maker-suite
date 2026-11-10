# Archive and delete

Printers, accessories, maintenance types, printer brands, printer models, printer presets, process presets, spools, filament brands, filament materials, filament presets, projects, prints, orders, quotes and clients can all be archived, restored and deleted. Maintenance records stay as permanent history.

## Archive

**Archive** hides an item from lists and pickers. Nothing else changes: stats, costs and spool weight still count it, and its history stays.

- **Show archived** on a list finds it, and **Restore** brings it back.
- An archived item keeps its name or number, so a new item can't take it. The "already taken" message says the other one may be archived.
- Archiving resolves the item's open alerts, and auto slice skips archived projects.
- A printer with accessories installed, or an installed accessory, can't be archived. Remove the accessory first.
- A sync or import leaves an archived item alone.
- Printer, process and filament presets also show old preset versions under **Show archived**. Restoring an old version while a newer one is in use isn't possible.

## Delete

**Delete** removes the item for good, and only when nothing uses it. If something does, the dialog lists what, with links, and offers **Archive** instead. Archived items still count as using it.

| You delete | Blocked by |
|---|---|
| Printer | prints, maintenance records, installed accessories, maintenance types that list it |
| Accessory | maintenance records, installs, maintenance types that list it |
| Maintenance type | maintenance records |
| Printer brand | printer models |
| Printer model | printers, printer presets, process presets, maintenance types that list it |
| Printer preset | prints |
| Filament brand, filament material | filament presets, spools |
| Spool | prints that used it |
| Project | prints, orders, quotes, and files left in its folder |
| Order | prints |
| Quote | orders |
| Client | orders, quotes |
| Print, process preset | nothing |

Comments, a spool's weight log, a print's filament usages (the filament goes back to the spool), tags and open alerts go with the item. Deleting a process preset or printer empties the places that pointed at it (a plate's printer, the default printer) and leaves those rows.

A project's folder is checked as before: a folder that still has files, a device's folder or a kept unlinked folder blocks the delete, because the next scan would find it again.

An item that came from an import and that you deleted shows **You deleted this** in the next review. It isn't written back until you import it by hand.

**API:** `DELETE` on a printer or accessory now deletes instead of archiving, and deleting an order, quote or client that is used is refused with `409 in_use`. Archive through `PATCH`.

## Bulk actions

With **Manage** on the item's module (see [permissions](users.md#permissions)), every list has a checkbox per row. Select rows, or **Select all matching rows, on every page** for everything the filters list, then **Archive**, **Restore** or **Delete**. The count is shown before you confirm.

- Each row is done on its own: free rows go through and blocked ones don't undo them. A dialog lists what was blocked and why, and those rows stay selected.
- For projects, ones you can't edit are skipped and listed.
- Users with only Write see no checkboxes, and the server refuses them. Single-row Archive and Delete keep their usual rights.
