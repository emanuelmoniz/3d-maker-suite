# Import

The **Import** page brings data in from spreadsheets. Nothing is saved until you review the rows and confirm. Integrations (Bambu Cloud, Bambu Studio, OrcaSlicer) import through the same review screen when a sync needs your decision.

You can import 16 types, and every one can also be exported in the same format. Twelve are on the Import | Export page:

- **Your things:** spools, printers, accessories, accessory installs, projects, prints.
- **Money:** clients, quotes, orders, order projects.
- **Maintenance:** maintenance types and maintenance (the history).

The other four are the catalog: brands, printer models, filament brands and filament materials. They are imported and exported in **Catalog** (see below), not on this page.

A file names the brands, models and materials a row needs, and they must already exist (import them first, or add them in the catalog); a slicer zip or an integration creates them for you. Printer, process and filament presets aren't in a spreadsheet: they come only from a slicer (see below).

## The catalog

**Catalog** in the menu (with the catalog permission at read) holds what your printers, spools and prints are described with, in two tabs:

- **Printers:** brands, printer models, printer presets and process presets.
- **Filament:** filament brands, filament materials and filament presets.

A preset table holds a slicer's system and user presets together; the **Source** column says which (**Bambu Studio (system)** or **(user)**). Under the tabs, a link per table jumps to it. Since [ADR-0023](adr/0023-one-catalog-module.md) presets are part of Catalog: the catalog permission at read covers them, and the old **Presets** page and its links land on the matching Catalog tab and table. Catalog's settings (the gear) have **Sources**, where brands, models and materials come from, **Preset sources**, where the presets come from, and with the hub on the **Preset library** ([hub presets](hub.md#slicer-presets)).

Brands, printer models, filament brands and materials can be added **by hand** or come **from a slicer**. A row a slicer brought keeps its name: that is how the next import finds it, so the name can't be edited. Its other fields (logo, website, power, picture, density, default price) stay yours: an import only fills the ones that are empty, it never overwrites one. A row you made by hand whose name later comes in a slicer's files is linked to it: it keeps your values and shows the slicer as its source from then on.

Presets are the slicer's own files, so they come **only from a slicer**: an integration (Bambu Studio, OrcaSlicer, Bambu Cloud) or a zip of its config folder. You can't add or edit one here: change it in the slicer and it changes here. **Archive** hides a preset from the pickers; **Delete** removes it once nothing uses it. Presets made by hand before 5.4 are archived and shown as **By hand (older)**: no slicer has their file, so they can't come back, and a plate that pointed at one slices with the settings saved in its 3MF.

Every table has a **Source** column, with a filter: **By hand**, **By hand (older)**, **Bambu Studio (system)** or **(user)** for a preset, or the slicer or account that brought a row. Presets also show **In use** or **Unused**: a print, a printer's default, a plate or an older version of the preset uses it.

**Import** and **Export** sit next to **Add** on the brands, printer models, filament brands and filament materials tables. Export picks a format (`csv`, `xlsx` or `json`) and downloads the table; Import opens the template, upload and review described under Spreadsheet template, and its back link returns to the tab. Both need the catalog permission (Import at manage).

Under the preset tables, **How presets arrive** says the same as above and lists, per slicer and operating system, the config folder to zip (the system and user folders in it).

## A preset's page: All settings

Click a preset's name in its Catalog table to open its page: what the app uses (model, nozzle, material, temperatures), its source, **where it is used**, and **All settings**, every key and value of the slicer's file. A slicer file only holds what differs from the preset it inherits from, so the page fills the parents in and marks each row with where its value comes from: **This preset**, or the parent or template that gives it. The chips above the table show one source at a time, the search matches keys and values, and **Download JSON** saves the whole list.

The settings are read from the file when the page opens: the slicer's folder on this server, the hub's library for a user preset, or a Bambu Cloud preset's copy (its parent is found in the slicer's system presets). If that can't be done, the page says why instead: the slicer's files aren't on this server (connect it in Integrations, or upload the zip), the slicer no longer has the preset, or the preset was made by hand in an older version. If the parent preset can't be found, the values it would give are missing and a note says so. If the slicer's files changed and rows wait for your review, a note links to the review: the settings shown are the file's current ones, so they may differ from what the app uses.

The old addresses (Printers → Settings, Filament → Settings, and the Catalog preset tables, Preset library and Sources tabs of 5.4) open the matching tab. Printers → Settings keeps the default printer and the printer states.

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

Each folder can also be edited in the table. To fix many at once, tick the rows and open **Bulk edit**, then set the **Folder** field to **Move to root**: each row gets that root plus its own last folder (`D:\old\a\012_Vase` → `E:\3d\012_Vase`). **Create folder**, **No folder** and **Use import values** work the same way on every selected row.

After the import each folder is scanned (files, cover, materials). **Prints** shows the prints each project gets: the ones it has, plus imported prints whose title names one of its files, the same way a folder scan links them. Open it to add or remove prints; a project whose prints you changed gets exactly those.

## Clients, quotes and orders

- **Clients** are matched by mobile, else email, else VAT number.
- **Quotes** are typed-in prints (a unit cost per print plus the pricing columns). The client and project must already exist, referenced by name or number.
- **Orders** reference a client, a quote and one or more projects. Separate several projects with `;`. The status must be one of the order statuses.

An unknown client, quote or project is an invalid row, and the message says which reference is missing. Create the client or project first, then import again.

## Spreadsheet template

1. Open **Import** and choose what to import (or, for the catalog, **Import** on its table in **Catalog**).
2. Pick a **Format** and click **Download template**. The `.xlsx` has one sheet of columns, a **Lists** sheet with the allowed values, and an **Instructions** sheet. The `.csv` is the header row alone; the `.json` is an empty list (`[]`) of objects named by the column keys.
3. Fill in one row per item. Columns marked `*` are required. Leave a cell empty to keep what the app already has.
4. Upload the file. Headers are read by their name in the template or by the column key.

Notes on the columns:

- **Multicolor prints:** one print uses one *Spool*, *Filament* and *Filament used (g)* per colour: the first set, then *Spool 2* and so on, up to 16. *Filament* names the material (`PLA`); it prices grams that have no spool yet.
- **Spools:** a spool is its *Brand* (optional), *Material* and *Name* (`PLA Basic`, optional), plus its colour. It needs no filament preset. A spool without a *Price paid* costs its material's default price per kg.
- **Track usage:** leave empty or enter `yes` to subtract the filament from your spools. Enter `no` to save the print and its filament without changing the spools' weights.
- **Names:** for brand, material and preset columns, pick an existing name or type a new one. A new brand or material is added with the spool.

To get your data back out, use **Export** on the same page (catalog tables: their own Export), as `.xlsx`, `.csv` or `.json`. An export is the template with your rows in it, plus an `id` column, so it can be edited and imported again: a row with an id updates that item. Money is in your currency's units (not cents), names stand for references, and dates are ISO (`2026-03-04`). For a full copy of everything, take a [backup](backups.md).

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

For each row you choose **Create**, **Update**, **Skip** or **Use suggestion**. For matched rows, each column can overwrite the existing value with the file's, or keep your edits and fill the rest from the file.

**Bulk edit** works on the rows you tick. A bar above the table shows how many are selected, with **Clear** and **Bulk edit…**. The form has an **Action** and one field per column, each starting on **Don't change**, so only what you change is applied. **Apply** writes to the selected rows at once; nothing is saved until **Import**. A row that still has a problem stays selected and says why, and a row with no match is shown in red: pick its match in the table first. A new filter or status chip ends the selection. Reset to suggestions brings back the app's choices.

### Spools of new prints

Each filament slot of a new print has a spool picker:

- From a file, the picker starts on the spool the row names. A slot without one stays empty: its grams wait on the **Filament to review** page (linked from **Prints**), where **Add new spool** works too.
- The spools that fit the slot are listed first: the same material and colour the printer reported, or the material the file names.
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

For an account's printers, prints and spools, **Review and import** in the **⋯** menu of the type's line on its **Settings → Sources** tab opens the same review screen with the rows the account offers. For the catalog and presets, it's the same **⋯** menu on the type's line in **Catalog → Settings → Sources** or **Preset sources**. Automatic runs import only what needs no decision from you; everything else waits there. For print history it shows every print not imported yet. With **Review and import a period…** in the same menu, pick a period (since the last sync, the last 7 / 30 / 90 days, this year or your own dates) to review every print in it, imported or not.

Importing from the review is not a sync: **Sync now** and automatic runs always continue from the last sync, so a print you skipped in the review still comes in with the next one.

For print history, each filament is matched to a spool of the same material and colour that was opened by the print's day and still holds the grams used:

- **One spool fits:** it is picked, and the print is imported without asking.
- **Several fit:** the app picks the one this printer last used in that AMS slot, else the oldest (in use before new, then by opened date, purchase date and number). The pick shows in yellow ("check it"), and the print waits for you. The same goes for two slots of one colour in one print (the AMS switched to a second roll): each gets its own spool, in yellow.
- **None fits:** the slot shows no spool, and the print waits for you.

Prints that wait raise a **Sync needs review** alert when the type's alert is on. The **Track usage** setting of print history (**Prints → Settings → Sources**, **Edit**) decides whether syncs that run without a review (scheduled or **Sync now**) take the filament from the spools; when off, prints are imported with their spools linked and the weights unchanged.

### What to sync and how to sync

Every type except print history has two more settings. For an account's printers and spools, they are under **Edit** on the type's line in **Printers** or **Filament → Settings → Sources**. For the catalog and presets, it's **Edit** on the type's line in **Catalog → Settings → Sources** or **Preset sources**. Print history has neither: an imported print never changes.

**What to sync**

| Option | What a sync does |
|---|---|
| Everything | Adds every row the source offers and keeps them up to date. |
| Only what I already have | Keeps the rows you have up to date. A new row is added only when you have its brand: a new model of your printer brand still arrives, a brand you never imported doesn't. Brands, filament brands and materials themselves are never added. Rows it leaves out don't wait for review and raise no alert. |

**Catalog → Settings → Sources** lists, under **Share to the hub**, only each slicer's **hub's slicer** ([ADR-0022](adr/0022-one-slicer-per-type.md)): this server's install or one machine's, picked on the slicer's card in **Settings → Integrations**. It is where the slicer's system presets, brands and printer models are read from, so two PCs on different slicer versions don't keep changing the catalog. Other installs of the slicer, on this server or a machine, aren't listed: they share nothing to the catalog. Until you pick one, the hub's slicer is chosen for you. It has four lines: **Printer brands**, **Printer models**, **Filament brands** and **Filament materials**, each with its switch, **Edit** and **⋯** (Sync now, Review and import, the sync log), and **Choose brands**.

The hub's slicer's heading has **Change in Integrations**, on this tab and on Preset sources.

**Receive from the hub** lists every install that can get the hub's slicer's `system/` folder: **This server** for a slicer installed on the server's computer, and every machine with the slicer, all but the hub's slicer itself. Per slicer, one table with the **System presets** line (the whole `system/`: system presets, brands and printer models): its **Receive** switch (the same as on the machine page) and its state: *Off*, not received yet, waiting for the slicer to close, received with the date and the presets' version, a version that doesn't match, or the error. **Backup** shows the last backup; a machine that is offline or too old says so at the top of its card ([hub.md](hub.md#receive-catalog)). The switch shows only to whoever may change it: for a machine, its machine page's **Catalog** right; for This server, Integrations.

**Catalog → Settings → Preset sources** lists, under **Share to the hub**:

- **This server**: per slicer, its **User printer**, **process** and **filament presets** lines, and while it is the hub's slicer its **System** preset lines too. **Choose brands** links to Catalog settings.
- Each account that allows user presets, with its user preset lines (Bambu Cloud's sit under Bambu Studio). The first source to bring a preset keeps it.
- Each machine that shares something, per slicer, in one table: while its **User presets → Share** is on, a **User printer**, **process** and **filament presets** line, whose switch is whether the machine sends that kind (*On each save*, or *Off*) and whose **Edit** and **⋯** set how the hub imports it; on the hub's slicer, its **System** preset lines too. A machine that shares nothing isn't listed.

System presets come only from each slicer's hub's slicer; user presets come from every install, account and machine that shares them.
- **No connector? Upload a zip**: brings the presets of a desktop install that isn't connected, for example to a slicer on this server, which has no folder of yours to read (see [below](#slicer-catalog-from-a-zip)). Every slicer that can take a zip shows it, even before anything is connected. **How presets arrive** under the preset tables and the zip card on **Import | Export** lead here.

**Receive from the hub** lists the same receivers as on Catalog. Per slicer, one table: the **System presets** line, with the same switch as on Catalog (either tab saves it), then on a machine the **User presets** line: its **Receive** switch (the same as on the machine page; it takes every kind) and how many presets wait there. Both on give the slicer a full copy of the hub's slicer; either one alone keeps the slicer's own other part.

Every source on a Sources tab (this server, an account, a machine, the zip) is a card, closed at first: open one to see its lines. A card you open stays open on that page until you close it, and a link into it opens it. Only an account's lines run on a schedule. A slicer's lines, on this server or a machine, follow its files: *Automatic when the files change* imports a change at once, *When the files change, after your review* (Manual) leaves it waiting for review with an alert. Every slicer line starts as Automatic, the catalog and system presets too (5.5.0 switched existing Manual ones over); **Edit** sets one to Manual. Under **Only what I already have** (after **Choose brands**), a slicer update that brings new vendor presets only updates the rows you have. The tables show the same columns everywhere: **Item**, **On**, **When**, **What**. On a machine's user preset lines, **On** is whether the machine sends that kind, and **When** is the hub's import of it, or *Off* while it doesn't send.

A line turned off keeps what it brought. **Choose brands** sits on the catalog source in Catalog settings and lists the slicer's printer brands and filament brands (the ones you have are checked, and **Select all** ticks every one). Pick the ones you use and **Import**: you get those brands with their models, printer and process presets, and for filament brands their materials and filament presets, after a backup. Then **Only what I already have** is switched on for all the catalog types at once; switch it off for **Everything**. The rows' links open the review of each type, where the slicer's changes wait.

**When** on the card is one switch:

- **Automatic** (the default): a change in the slicer's files runs the type. A new user preset is added and a changed one updated within a minute, keeping the values you typed. Under **Only what I already have**, a new preset raises a **Sync needs review** alert and waits for you instead.
- **Manual**: nothing is written. A change raises a **Sync needs review** alert, and the review offers the changes.

Catalog types of a slicer don't run on a schedule: a daily check looks at the slicer's files and raises the alert when they changed. Your user presets reach only the catalog this way; sharing and installing them between machines is a separate step.

**A preset gone from the slicer** (you deleted it there, or a slicer update dropped a system preset) is never deleted for you, in Automatic too. It raises a **Sync needs review** alert, and the review lists it under **Gone from the slicer**:

- **Nothing uses it**: **Delete** removes its row after you confirm.
- **Something uses it**: the row stays, and the review says what: prints, spools, plates and printers that use it, its older versions, and other presets in the slicer that inherit from it. Once nothing uses it, the alert asks again.
- **Keep the rest**, or ignoring the alert, keeps the rows. You aren't asked again until the slicer's presets change. A preset that comes back in the slicer closes its alert.

A slicer folder that reads empty (moved, or not readable) counts nothing as gone. Signing in or out of the slicer isn't a removal either: every account's presets are read.

**How to sync** (what a sync does when the source changes a row you have) is only on Bambu Cloud's printers and spools. A catalog type doesn't need it: a preset follows its file, and brands, models, filament brands and materials only get their empty fields filled.

| Option | What happens |
|---|---|
| Overwrite with the source | The source's values replace yours, your own edits included. |
| Keep my edits | Fields you changed since the last sync stay as you left them; the other fields follow the source. |
| Let me review the changes | An automatic run changes nothing you have. The row waits under **Manual import** and raises a **Sync needs review** alert. Import it there, or **Dismiss** it: a dismissed change only comes back when the source changes the row again. The default for printers and spools. |

The app remembers what each sync last imported into a row, and that's how it tells your edits from a change at the source. For rows imported before this setting existed it doesn't know yet: the first sync after the update only fills empty fields (Keep my edits) or takes the source as it is (Let me review), and from then on it tells them apart. With **Track usage** of spools off, a sync never changes the remaining weight of a spool you have.

In the review of an integration, a column left on **Don't change** follows the type's choice from the table above. Bulk edit can set a column to **Keep my edits, fill the rest with import values** instead.

## Slicer catalog from a zip

For a server with no slicer installed (a NAS, for example), you can import the filament and printer presets from your slicer's config folder. Zip the folder on the PC where the slicer is installed, then upload it from **No connector? Upload a zip** on **Catalog → Settings → Preset sources**.

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
