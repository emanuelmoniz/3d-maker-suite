# Import

The **Import** page brings data in from spreadsheets. Nothing is saved until you review the rows and confirm. Integrations (Bambu Cloud, Bambu Studio, OrcaSlicer) import through the same review screen when a sync needs your decision.

You can import 19 types, and every one can also be exported in the same format (Import | Export page):

- **Your things:** spools, printers, accessories, accessory installs, projects, prints.
- **Money:** clients, quotes, orders, order projects.
- **Maintenance:** maintenance types and maintenance (the history).
- **Printer catalog:** brands, printer models, machine profiles, print profiles.
- **Filament catalog:** filament brands, filament materials, filament profiles.

A file names the brands, models and materials a row needs, and they must already exist (import them first, or add them in the catalog); a slicer zip or an integration creates them for you.

## Accessory installs

One row per period an accessory is on a printer. **Accessory** and **Printer** must already exist, by number or name (for example `1-AMS`). **Installed** is required; leave **Removed** empty while it is still on the printer. A row is the same install when its accessory, printer and install day match, so exporting, editing and importing again updates the removal day. A removal before the install, or a period that overlaps another install of the accessory, is an invalid row (the same rule as the accessory page).

## Maintenance

- **Maintenance types**: **Name** and **Target** (printer or accessory) are required. **Every** and **Warn before** are given in days, hours and prints; leave one empty to not use it. **Warn alert** and **Due alert** are yes or no (empty uses the maintenance settings). **Models** (for example `Bambu Lab X1C`), **Printers**, **Accessory types** and **Accessories** are lists separated by `;`; leave them all empty for every printer or accessory. A type is found by its name.
- **Maintenance**: one row per maintenance done. **Type** and **Done** (date and time) are required, plus the **Printer** or the **Accessory** the type is for, exactly one. A row is the same task when its type, printer or accessory and time match. **Runtime at (h)** and **Prints at** left empty take what the printer or accessory had at that time, as logging maintenance does.
- **Order projects**: one row per project of an order: the **Order** number and the **Project** (number or name). Changing the project of a row moves the link, unless the order has prints of the project it leaves.

An unknown type, printer, accessory, order or project, or a printer where the type is for accessories (and the other way round), is an invalid row.

## Projects

A row with a **Number** updates that project; without one it is a new project. **Folder** is the full path of the project's folder, inside one of your project folders (Settings → Projects). A folder outside them, or one that already belongs to another project (or to an earlier row of the file), is an invalid row.

In the review, a row without a folder, or whose folder isn't there, is highlighted. For each row you can:

- **Choose…** a folder inside your project folders. If it already has files, you can take the project's name, description and link from the folder instead of the file.
- **Create folder**: the app makes it when you import. Leave the name empty to name it by number and name (`012_Vase`).
- **No folder**: the project is saved without one.

After the import each folder is scanned (files, cover, materials). **Prints** shows the prints each project gets: the ones it has, plus imported prints whose title names one of its files, the same way a folder scan links them. Open it to add or remove prints; a project whose prints you changed gets exactly those.

## Clients, quotes and orders

- **Clients** are matched by mobile, else email, else VAT number.
- **Quotes** are typed-in prints (a unit cost per print plus the pricing columns). The client and project must already exist, referenced by name or number.
- **Orders** reference a client, a quote and one or more projects. Separate several projects with `;`. The status must be one of the order statuses.

An unknown client, quote or project is an invalid row, and the message says which reference is missing. Create the client or project first, then import again.

## Spreadsheet template

1. Open **Import** and choose what to import (spools, printers or prints).
2. Pick a **Format** and click **Download template**. The `.xlsx` has one sheet of columns, a **Lists** sheet with the allowed values, and an **Instructions** sheet. The `.csv` is the header row alone; the `.json` is an empty list (`[]`) of objects named by the column keys.
3. Fill in one row per item. Columns marked `*` are required. Leave a cell empty to keep what the app already has.
4. Upload the file. Headers are read by their name in the template or by the column key.

Notes on the columns:

- **Multicolor prints:** one print uses one *Spool*, *Filament* and *Filament used (g)* per colour: the first set, then *Spool 2* and so on, up to 16.
- **Track usage:** leave empty or enter `yes` to subtract the filament from your spools. Enter `no` to save the print and its filament without changing the spools' weights.
- **Names:** for brand, material and profile columns, pick an existing name or type a new one.

To get your data back out, use **Export** on the same page, as `.xlsx`, `.csv` or `.json`. An export is the template with your rows in it, plus an `id` column, so it can be edited and imported again: a row with an id updates that item. Money is in your currency's units (not cents), names stand for references, and dates are ISO (`2026-03-04`). For a full copy of everything, take a [backup](backups.md).

Data in another app or file? Pick the type, download its template, copy your data into it and upload it. Files you exported earlier can be uploaded as they are.

## Review rows

After upload, every row gets a status:

| Status | Meaning |
|---|---|
| New | Nothing like it exists yet; it will be created |
| Identical | Already in the app with the same values; nothing to do |
| Changed | Matches an existing item with different values |
| Ambiguous | Matches more than one existing item; pick one |
| Invalid | A value is missing or wrong (the message says which); fix the cell in the review, or the file |

The review shows the file's columns in the file's order. Click a cell to edit it, with an input for its kind: text, a number (`12,5` or `12.5`), a date, a date and time (in your local time), a list of options, a name (one you have, or a new one) or a colour. Enter or leaving the cell keeps the edit, Escape drops it. An edited cell has a bar on its left and an undo button. A value that can't be read shows its error as you type; a fixed invalid row can then be created or updated. The **Id**, and the **Number** of a row that updates, can't be edited. The edits are checked again when you import, and any error stops the whole import.

For each row you choose **Create**, **Update** or **Skip**. For matched rows, pick a policy: **Overwrite with file values** or **Fill empty fields only** (from an integration also **Keep my edits, update the rest**, see below). The bulk actions apply to all, selected or filtered rows (for example *Auto-match: update matched, add new*, or *Skip all*). Reset to suggestions brings back the app's choices.

### Spools of new prints

Each filament slot of a new print has a spool picker:

- From a file, the picker starts on the spool the row names. A slot without one stays empty: its grams wait on the **Filament to review** page (linked from **Prints**), where **Add new spool** works too.
- The spools that fit the slot are listed first: the same material and colour the printer reported, or the filament profile the file names.
- A spool opened after the print started is not offered, and neither is an empty one. The app refuses such a spool anywhere: in the review, the print form and the filament review queue.
- **Add new spool…** at the end of the list adds a spool without leaving the review and picks it.
- **Track usage** is a tick on every print row, from a file or an integration. It starts from the file's *Track usage* cell (ticked unless it says `no`; ticked for an integration). Untick a row to save that print and its filament without changing the spools' weights, for example for prints your spools already account for.

A spool is marked **Empty** as soon as its remaining weight reaches 0 g, and **In use** once filament is taken from it. Spools have a **Number** (unique; leave it empty for the next free one) and an optional colour name. The spool's display name is built from them.

Printers and projects get a unique number and display name too. Imported prints get their own print numbers, and every imported print needs a project or **No project** (a calibration print, say: its filament is still tracked). A synced print whose title matches no project waits in the review for you to pick one of the two; a print with No project is never linked to a project by its title later. Numbers follow the order of the print's date, oldest first, and an integration import renumbers the cloud prints the same way.

## Estimated durations

A print that has grams but no duration gets an estimated duration: its grams divided by the printer's average grams-per-hour from its past prints (a preset default applies until there are some). The print is marked as estimated. A real duration, from a file or an integration, replaces the estimate. On the print form, **Estimate from filament** fills the duration the same way.

## Backups before an import

Before an import saves anything, the app takes a backup, so you can restore it from [Backups](backups.md).

## From an integration

On the **Integrations** page, a type's **Review and import** button opens the same review screen with the rows an integration offers. Automatic runs import only what needs no decision from you; everything else waits there. For print history it shows every print not imported yet. Under **Review and import a period** in the type's settings, pick a period (since the last sync, the last 7 / 30 / 90 days, this year or your own dates) to review every print in it, imported or not.

Importing from the review is not a sync: **Sync now** and automatic runs always continue from the last sync, so a print you skipped in the review still comes in with the next one.

For print history, each filament is matched to a spool of the same material and colour that was opened by the print's day and still holds the grams used:

- **One spool fits:** it is picked, and the print is imported without asking.
- **Several fit:** the app picks the one this printer last used in that AMS slot, else the oldest (in use before new, then by opened date, purchase date and number). The pick shows in yellow ("check it"), and the print waits for you. The same goes for two slots of one colour in one print (the AMS switched to a second roll): each gets its own spool, in yellow.
- **None fits:** the slot shows no spool, and the print waits for you.

Prints that wait raise a **Sync needs review** alert when the type's alert is on. The **Track usage** setting of print history on the Integrations page decides whether syncs that run without a review (scheduled or **Sync now**) take the filament from the spools; when off, prints are imported with their spools linked and the weights unchanged.

### What to sync and how to sync

Every type except print history has two more settings on the Integrations page (open the type's row). Print history has neither: an imported print never changes.

**What to sync**

| Option | What a sync does |
|---|---|
| Everything | Adds every row the source offers and keeps them up to date. |
| Only what I already have | Keeps the rows you have up to date. A new row is added only when you have its brand: a new model of your printer brand still arrives, a brand you never imported doesn't. Brands, filament brands and materials themselves are never added. Rows it leaves out don't wait for review and raise no alert. |

To start with only the brands you use: open **Manual import** for brands, filter the brand column, select all the rows shown, import them, then switch to **Only what I already have**.

**How to sync** (what a sync does when the source changes a row you have)

| Option | What happens |
|---|---|
| Overwrite with the source | The source's values replace yours, your own edits included. |
| Keep my edits | Fields you changed since the last sync stay as you left them; the other fields follow the source. The default for catalog types. |
| Let me review the changes | An automatic run changes nothing you have. The row waits under **Manual import** and raises a **Sync needs review** alert. Import it there, or **Dismiss** it: a dismissed change only comes back when the source changes the row again. The default for printers and spools. |

The app remembers what each sync last imported into a row, and that's how it tells your edits from a change at the source. For rows imported before this setting existed it doesn't know yet: the first sync after the update only fills empty fields (Keep my edits) or takes the source as it is (Let me review), and from then on it tells them apart. With **Track usage** of spools off, a sync never changes the remaining weight of a spool you have.

In the review of an integration, the **When updating** policy starts with the type's choice, and **Keep my edits, update the rest** is offered next to the file policies.

## Slicer catalog from a zip

For a server with no slicer installed (a NAS, for example), you can import the filament and machine profiles from your slicer's config folder. Zip the folder on the PC where the slicer is installed, then upload the zip on **Import → Import from a slicer zip**.

1. Open the slicer's config folder: in Bambu Studio or OrcaSlicer, **Help → Show Configuration Folder**. Or find it yourself:
   - Windows: `%APPDATA%\BambuStudio` or `%APPDATA%\OrcaSlicer` (paste it into the File Explorer address bar)
   - macOS: `~/Library/Application Support/BambuStudio` or `~/Library/Application Support/OrcaSlicer` (Finder → Go → Go to Folder)
   - Linux: `~/.config/BambuStudio` or `~/.config/OrcaSlicer`
2. Select only the **system** and **user** folders. Cache, logs and plugins aren't needed.
3. Zip them:
   - Windows: right-click → Send to → Compressed (zipped) folder
   - macOS: right-click → Compress
   - Linux: run `zip -r slicer.zip system user` in that folder
4. Upload the zip, then review what it offers. The zip must be under 100 MB.

Only `.json` and `.png` files are read; the rest of the folder is ignored.
