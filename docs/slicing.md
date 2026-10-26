# Slicing

Slicing gives a project's plates their print time and grams, so costs and quotes use the slicer's own numbers. The server runs a slicer's command line; no window opens. Set up at least one slicer in **Settings → Integrations**.

## Which slicer slices

| Slicer | Where it runs | Set up |
|---|---|---|
| Bambu Studio / OrcaSlicer (local) | The PC that runs the server, using the installed program | Set its **Slicer program** ([open-in-slicer.md](open-in-slicer.md)). OrcaSlicer needs 2.5 or newer |
| Bambu Studio (server) / OrcaSlicer (server) | The server, using a copy the app downloads | **Add integration**, then **Install** on its card |

A plate slices with its own slicer, else its project's (**Print setup**), else the default slicer, else the first one that can slice. A slicer that is switched off is skipped; a deleted one is cleared. The pickers show only with two or more slicers.

## Install a slicer on the server

Use this on a NAS or any server without a desktop slicer.

1. **Settings → Integrations → Add integration**, then pick **Bambu Studio (server)** or **OrcaSlicer (server)**.
2. Open its card and press **Install**. Pick a version (pre-releases only when you tick them). The card shows the licence (both slicers are AGPL-3.0) and a link to the release's source.
3. The server downloads the slicer from the vendor's GitHub releases, checks its checksum, unpacks it under `<data folder>/slicers/` and starts it once to test it. The app never ships or changes the slicer. Downloads are 150 to 700 MB.
4. **Update** installs a newer version; the old one stays until the new one starts. **Remove** deletes the download and keeps your imported presets.

A daily check raises an alert when a newer release exists (pre-releases only when one is installed); installing or removing resolves it. Slices remember the slicer version they were made with: a new version marks them outdated, and an install slices them again for projects with auto slice on.

OrcaSlicer 2.5.0 is the minimum: 2.4 can't slice Bambu files. Until 2.5 is stable, OrcaSlicer is offered only with pre-releases ticked. See [ADR-0013](adr/0013-managed-slicer.md) for the details and the unsupported combinations (Linux on arm64, Bambu on Windows arm64).

## Profiles

- **Bambu Studio (server)** imports its brands, printers and profiles from the download, with the same sync options as the local one.
- **OrcaSlicer (server)** can't be read (Orca ships its profiles in a binary format). It slices with the 3MF's own settings plus the user presets you import.
- **Your own presets:** zip the slicer's config folder on your PC and upload it on [Import → slicer zip](import.md#slicer-catalog-from-a-zip). The `user` presets are kept in the server slicer's config folder, so slicing finds them later.
- **Presets belong to a slicer.** A Bambu Studio print or printer preset doesn't exist in OrcaSlicer and the other way round, and a slicer's presets are never matched to the other's, even with the same name. The slicer pickers mark slicers that don't fit a plate's profiles, and the plate warns before slicing. A filament preset of the other slicer is fine: that slot slices with the file's own filament, and the spool's price still counts.

## Docker

The default image has no slicer libraries, so it stays small. For a server slicer use the **slicer image**: the same app plus the libraries Bambu Studio and OrcaSlicer need (about 800 MB more).

```yaml
image: ghcr.io/emanuelmoniz/3d-maker-suite:latest-slicer # or :X.Y.Z-slicer; :dev-slicer for pre-releases
```

Then `docker compose up -d`, add a server slicer and install it from its card. No display is needed. The slicer is downloaded into the `app-data` volume once, so it survives image updates. Only x64 is supported (Bambu has no Linux arm64 build). To build the image yourself: `docker build --target slicer -t 3d-maker-suite:slicer .`

## When a slice fails

The plate shows the slicer's reason: no objects on the plate, a preset that doesn't exist in that slicer, or the slicer's own error line. A file that crashes the slicer (for example one never sliced and with nothing on it) is worth opening once in the desktop slicer to see why.
