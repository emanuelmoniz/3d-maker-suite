# Import

The **Import** page brings data in from spreadsheets. Nothing is saved until you review the rows and confirm. Integrations (Bambu Cloud, Bambu Studio, OrcaSlicer) import through the same review screen when a sync needs your decision.

You can import **spools**, **printers** and **prints**. Filament brands, materials and profiles, and printer brands and models, are added for you when the rows that need them are imported.

## Spreadsheet template

1. Open **Import** and choose what to import (spools, printers or prints).
2. Click **Download template**. It is an `.xlsx` file with one sheet of columns, a **Lists** sheet with the allowed values, and an **Instructions** sheet.
3. Fill in one row per item on the first sheet. Columns marked `*` are required. Leave a cell empty to keep what the app already has.
4. Upload the file (or a `.csv` whose first row holds the column names).

Notes on the columns:

- **Multicolor prints:** one print uses one *Spool*, *Filament* and *Filament used (g)* per colour: the first set, then *Spool 2* and so on, up to 16.
- **Track usage:** leave empty or enter `yes` to subtract the filament from your spools. Enter `no` to save the print and its filament without changing the spools' weights.
- **Names:** for brand, material and profile columns, pick an existing name or type a new one.

To get your data back out, use **Export** on the same page. It downloads one `.xlsx` per module, ready to edit and re-import.

## Review rows

After upload, every row gets a status:

| Status | Meaning |
|---|---|
| New | Nothing like it exists yet; it will be created |
| Identical | Already in the app with the same values; nothing to do |
| Changed | Matches an existing item with different values |
| Ambiguous | Matches more than one existing item; pick one |
| Invalid | A value is missing or wrong (the message says which); fix the file and upload again |

For each row you choose **Create**, **Update** or **Skip**. For matched rows, pick a policy: **Overwrite with file values** or **Fill empty fields only**. The bulk actions apply to all, selected or filtered rows (for example *Auto-match: update matched, add new*, or *Skip all*). Reset to suggestions brings back the app's choices.

## Import history

**Import history** on the page lists every import: when it ran, the file or source, and how many rows were created, updated, skipped or invalid. Before an import saves anything, the app takes a backup and names it in the history, so you can restore it from [Backups](backups.md).

## From an integration

On the **Integrations** page, a type's **Review and import** button opens the same review screen with the rows an integration offers. Automatic runs import only what needs no decision from you; everything else waits there. For print history, a print waits when one of its filaments matches no single spool. The review then reads the date range picked on the Integrations page.

## Slicer catalog from a zip

For a server with no slicer installed (a NAS, for example), you can import the filament and machine profiles from your slicer's config folder. Zip the folder on the PC where the slicer is installed, then upload the zip on **Import → Import a slicer catalog from a zip**.

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
