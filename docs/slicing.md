# Slicing

Slicing gives a project's plates their print time and grams, so costs and quotes use the slicer's own numbers. The server runs a slicer's command line; no window opens. Set up at least one slicer in **Settings → Integrations**.

## Which slicer slices

**Add integration** asks for the slicer, then where it runs. Each slicer has one card on the Integrations page, with a row per place it runs; **Add location** on the card adds another.

| Where it runs | What it uses | Set up |
|---|---|---|
| **Installed on this computer** | The PC that runs the server, using the installed program | Set its **Slicer program** ([open-in-slicer.md](open-in-slicer.md)). OrcaSlicer needs 2.5 or newer |
| **Download it to this server** | The server, using a copy the app downloads | **Install** on its row |
| **On a connected workstation** | A workstation or NAS with the connector | See [Slice on a worker](#slice-on-a-worker) |

A plate slices with its own slicer, else its project's (**Print setup**), else the default slicer, else the first one that can slice. A slicer that is switched off is skipped; a deleted one is cleared. With one slicer, the plate shows its name instead of a picker.

## A plate's setup

A plate reads top to bottom, as in the slicer. Changing a line resets the lines below it to their default; filament presets and spools stay.

| Line | Default | What the list offers |
|---|---|---|
| **Slicer** | The project's slicer, else the default slicer | Your slicers. Another slicer resets the profiles to its own, and a filament preset of the old slicer goes back to *As saved in the file* |
| **Printer** | A printer the file was made for (the default printer first), else the default printer | Your printers, those *Made for this file* first |
| **Machine profile** | *As saved in the file* on the file's printer, else the printer's machine profile | The printer model's system machine profiles in the plate's slicer, every nozzle (for a nozzle swap). A line instead of a picker when there's only one choice; *None for this printer* warns before slicing |
| **Print profile** | *As saved in the file* when the machine profile is the file's, else the printer's default print profile (if made for that machine), else the machine profile's default | The slicer's print profiles made for the machine profile (their `compatible_printers`) |

The file's own changes, such as supports, still go on top of a picked print profile. Changing the slicer, printer or machine profile marks the slice outdated.

**Defaults for all plates**, above the files, sets slicer, printer, machine profile and print profile on every picked plate at once with **Apply**. *As saved in the file, where the printer matches* keeps the file's settings on plates made for that printer and the defaults on the others. A plate can still be changed on its own after. The defaults aren't saved: they start from the project's slicer and the default printer. Quotes have the same setup.

## Install a slicer on the server

Use this on a NAS or any server without a desktop slicer.

1. **Settings → Integrations → Add integration**, pick **Bambu Studio** or **OrcaSlicer**, then **Download it to this server**.
2. Its row opens on the slicer's card: press **Install**. Pick a version (pre-releases only when you tick them). The card shows the licence (both slicers are AGPL-3.0) and a link to the release's source.
3. The server downloads the slicer from the vendor's GitHub releases, checks its checksum, unpacks it under `<data folder>/slicers/` and starts it once to test it. The app never ships or changes the slicer. Downloads are 150 to 700 MB.
4. **Update** installs a newer version; the old one stays until the new one starts. **Remove** deletes the download and keeps your imported presets.

A daily check raises an alert when a newer release exists (pre-releases only when one is installed); installing or removing resolves it. Slices remember the slicer version they were made with: a new version marks them outdated, and an install slices them again for projects with auto slice on.

OrcaSlicer 2.5.0 is the minimum: 2.4 can't slice Bambu files. Until 2.5 is stable, OrcaSlicer is offered only with pre-releases ticked. See [ADR-0013](adr/0013-managed-slicer.md) for the details and the unsupported combinations (Linux on arm64, Bambu on Windows arm64).

## Slice on a worker

Use this when the server can't run a slicer (an arm64 hub, a small VPS) or a workstation is simply faster. Needs the [hub](hub.md) and the connector on the device, at the hub's version.

1. **Settings → Integrations → Add integration** (or **Add location** on the slicer's card), pick **Bambu Studio** or **OrcaSlicer**, then **On a connected workstation**. Pick the device (every online device with the connector is offered) and whether it uses the slicer installed on it or one the hub downloads there. This makes the device a slice worker; removing its last location makes it stop.
2. On its row pick the slicer: **Use this one** for a slicer found on the device, or **Install** to have the hub install its managed release there (same download and checks as on the server). **Manual path** is for a slicer the connector didn't find (an AppImage, a portable copy); the program is checked by starting it with `--help` on the device.
3. Import your presets from a zip as usual (**Catalog → Sources**). Presets stay on the hub; each slice sends the device the flattened presets and the 3MF, and the result comes back. The worker needs no preset folder.

The slicer pickers show the worker as "Bambu Studio (WS-3)", named after its device. A slice that runs on a worker takes at most 10 minutes, as on the server.

**If the device is offline** the plate shows *Waiting for the slice worker* and the queue goes on. It slices when the device connects or you press **Slice**; **Slice on the server instead** falls back to the hub's own slicer. A connector older than the hub says it's too old: update it from Hub management.

The slice remembers the worker and the slicer version, so a new version marks it outdated like on the server. It also remembers the presets it used: when one of them changes in the [library](hub.md#slicer-presets), the slice shows as outdated.

## Profiles

- **Bambu Studio (server)** imports its brands, printers and profiles from the download, with the same sync options as the local one.
- **OrcaSlicer (server)** does the same: the app reads the binary profile files Orca ships. If a newer Orca changes their format, Choose brands says it can't read them, and Orca slices with the 3MF's own settings plus the user presets you import until the app is updated. In Orca, a print preset can't be applied to a project made in Bambu Studio: Orca rejects a setting saved in the file (error `-18`). Open and save the project in Orca first.
- **Your own presets:** zip the slicer's config folder on your PC and upload it on [Import → slicer zip](import.md#slicer-catalog-from-a-zip). The zip is merged into the hub's [slicer preset library](hub.md#slicer-presets), so presets already there stay. Slicing on the server and on workers uses that library. A preset you save in a slicer that runs on the server reaches the catalog within a minute, on its own (see [the slicer's When setting](import.md#from-an-integration)).
- **Presets belong to a slicer.** A Bambu Studio print or printer preset doesn't exist in OrcaSlicer and the other way round, and a slicer's presets are never matched to the other's, even with the same name. The slicer pickers mark slicers that don't fit a plate's profiles, and the plate warns before slicing. A filament preset of the other slicer is fine: that slot slices with the file's own filament.

## Preset and spool per slot

Each filament slot of a plate has a **preset** and, optionally, a **spool**. They are separate picks: the preset is what the slicer slices with, the spool is the roll you print from and what the filament costs.

- **Preset:** *As saved in the file* by default, named after the 3MF's preset. The list shows the plate's slicer's filament presets. Presets aren't filtered by printer: when slicing, the slicer picks the version of the preset made for the plate's printer.
- **Spool:** optional. Picking one never changes the preset. The presets that match the spool are at the top of the preset list: first its brand, material and name, then its brand and material, then *Generic* of its material. Your own presets come first.

| The slot's preset | What you see after picking a spool |
|---|---|
| Already the spool's preset (its brand, material and name), or one of its brand and material when none has its name | Nothing |
| Same material, and a better preset exists: one with the spool's name (*PLA Matte* over *PLA Pure*), or of its brand | A suggestion: **Use** or **Keep** |
| Same material, no preset of the spool's brand | Nothing |
| As saved in the file, with a preset that isn't in the catalog | Nothing (it may be one tuned on purpose) |
| Another material | A warning with the best match: **Use** or **Keep** |
| Another material, and no preset of the spool's material | A warning; slicing still works |

**Keep** is saved with the plate: that spool's suggestion or warning stays hidden until you pick another spool or preset for the slot. When several presets match equally, none is suggested; they are listed first.

**Price per slot:** the spool's price paid, else its material's default price. Without a spool: the default price of the preset's material (for *As saved in the file*, the file's material).

Only a changed preset marks a slice outdated. Changing the spool only changes the price.

## Docker

The default image has no slicer libraries, so it stays small. For a server slicer use the **slicer image**: the same app plus the libraries Bambu Studio and OrcaSlicer need (about 800 MB more).

```yaml
image: ghcr.io/emanuelmoniz/3d-maker-suite:latest-slicer # or :X.Y.Z-slicer; :dev-slicer for pre-releases
```

Then `docker compose up -d`, add a server slicer and install it from its card. No display is needed. The slicer is downloaded into the `app-data` volume once, so it survives image updates. Only x64 is supported (Bambu has no Linux arm64 build). To build the image yourself: `docker build --target slicer -t 3d-maker-suite:slicer .`

## When a slice fails

The plate shows the slicer's reason: no objects on the plate, a preset that doesn't exist in that slicer, or the slicer's own error line. A file that crashes the slicer (for example one never sliced and with nothing on it) is worth opening once in the desktop slicer to see why.
