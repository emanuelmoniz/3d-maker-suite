# Archive and delete

How to hide, bring back and remove things in 3D Maker Suite, one at a time or many at once. The same rules apply on every list.

## Who can use it

- **Archive**, **Restore** and **Delete** on one item need the **Write** or **Manage** right of the item's module, as that module's page says.
- **Bulk actions** (the checkboxes on a list) need **Manage** on the module. Someone with only **Write** sees no checkboxes, and the server refuses them too.

## What can be archived

Printers, accessories, maintenance types, printer brands, printer models, printer presets, process presets, spools, filament brands, filament materials, filament presets, projects, prints, orders, quotes and clients.

Maintenance records can't be archived. They can be deleted one by one from [Maintenance history](Maintenance.md#maintenance-history), by the person who logged them or by someone with **Manage**.

## Archive

**Archive** hides an item from lists and pickers. Nothing else changes.

- Its history stays, and stats, costs and spool weights still count it.
- **Show archived** on a list finds it again, and **Restore** brings it back.
- It keeps its name or number, so a new item can't take it. The "already taken" message says the other one may be archived.
- Archiving resolves the item's open alerts.
- A sync or import leaves an archived item alone.
- Automatic slicing skips archived projects.
- A printer with accessories installed, or an accessory that is installed, can't be archived. Remove the accessory from the printer first.
- Printer, process and filament presets also keep old versions. **Show archived** lists them. An old version can't be restored while a newer one is in use.

## Delete

**Delete** removes an item for good, and only when nothing uses it. This can't be undone.

If something uses it, the dialog says **is still in use**, lists what uses it with links, and offers **Archive** instead. Archived items still count as using it. Change or delete them first.

| You delete | It is blocked by |
|---|---|
| Printer | Prints, maintenance records, installed accessories, maintenance types that list it |
| Accessory | Maintenance records, installs, maintenance types that list it |
| Maintenance type | Maintenance records |
| Printer brand | Printer models |
| Printer model | Printers, printer presets, process presets, maintenance types that list it |
| Printer preset | Prints |
| Filament brand, filament material | Filament presets, spools |
| Spool | Prints that used it |
| Project | Prints, orders, quotes, and files left in its folder |
| Order | Prints |
| Quote | Orders |
| Client | Orders, quotes |
| Print, process preset | Nothing |

These go along with the item: comments, a spool's weight log, a print's filament usages (the filament goes back to the spool), tags and open alerts.

Deleting a process preset or a printer empties the places that pointed at it, such as a plate's printer or the default printer. Those rows stay.

### A project's folder

A project is only deleted when its folder can be left alone. A folder that still has files blocks it, and so does a device's folder or a kept unlinked folder, because the next scan would find the project again. Move or delete the files first.

### Deleted by an import

An item that came from an import and that you deleted shows **You deleted this** in the next review. It isn't written back until you import it by hand.

## Bulk actions

1. Open a list. If you have **Manage** on the module, each row has a checkbox.
2. Tick the rows, or tick **Select all matching rows, on every page** to take everything the filters list.
3. Choose **Archive**, **Restore** or **Delete**. The number of rows is shown before you confirm.
4. Confirm.

Each row is done on its own. Free rows go through, and blocked ones don't undo the rest. A dialog lists what was blocked and why, and those rows stay selected. For projects, the ones you can't edit are skipped and listed.

## Limits and tips

- When in doubt, archive. It hides the item and keeps every number the same.
- Archive an item before deleting it to check that nothing you need is hidden by it.
- Restoring a preset that a slicer owns brings back its archived copy. A preset made by hand in an older version can't come back, because no slicer has its file.

## Problems and fixes

- **Delete is refused.** Open the links in the dialog and change what uses the item, or choose **Archive**.
- **I can't archive a printer.** It still has accessories installed. Remove them first.
- **I can't restore an item.** The message says why. Common reasons: a newer version of the preset is in use, or the name has since been taken.
- **I can't see the checkboxes.** You need **Manage** on the module.
- **An archived item is missing from a picker.** Pickers hide archived items. Restore it.

## Related pages

- [Sources and sync](Sources-and-Sync.md)
- [Glossary](Glossary.md)
- [FAQ](FAQ.md)
