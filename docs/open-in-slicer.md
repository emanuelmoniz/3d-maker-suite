# Open in slicer / open folder

In **Settings → Integrations**, add a local integration (Bambu Studio or OrcaSlicer) and set its **Slicer program** to the full path of your slicer. The button shows only while "Open projects in the slicer" is ticked there and that program exists on the computer running the server, so a server without a slicer (a NAS) offers none. With several slicers set up, one is the default and the project page shows a picker. The server starts it with the model file as its only argument. "Open folder" uses the OS file manager. Both only work for projects whose folder is inside a configured project folder, and for model files the scan listed.

| OS | Slicer path example | Open folder uses |
|----|---------------------|------------------|
| Windows | `C:\Program Files\Bambu Studio\bambu-studio.exe` | `explorer` |
| macOS | `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio` | `open` |
| Linux | `/usr/bin/bambu-studio` (or the AppImage path) | `xdg-open` |

OrcaSlicer is the same: `C:\Program Files\OrcaSlicer\orca-slicer.exe` on Windows, `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer` on macOS, `/usr/bin/orca-slicer` (or the AppImage) on Linux. Its presets are read from `%APPDATA%\OrcaSlicer`, `~/Library/Application Support/OrcaSlicer` or `~/.config/OrcaSlicer` (Flatpak: `~/.var/app/io.github.softfever.OrcaSlicer/config/OrcaSlicer`), both `user/default/` and the cloud-synced `user/<uuid>/` folders.

Only Windows is tested so far; macOS and Linux follow the same code path.
