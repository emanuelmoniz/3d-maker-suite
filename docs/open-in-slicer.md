# Slicer program

Since 5.6.0 the project page has no **Open** or **Open folder** button: files stay where they are, and opening one in a slicer is your own step ([ADR-0014](adr/0014-hub-and-connector.md), last amendment). What is left of this page is the slicer setup.

In **Settings → Integrations**, add a local integration (Bambu Studio or OrcaSlicer) and set its **Slicer program** to the full path of your slicer. The program must exist on the computer running the server, so a server without a slicer (a NAS) has none. The server uses it for slicing ([slicing](slicing.md)).

| OS | Slicer path example |
|----|---------------------|
| Windows | `C:\Program Files\Bambu Studioambu-studio.exe` |
| macOS | `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio` |
| Linux | `/usr/bin/bambu-studio` (or the AppImage path) |

OrcaSlicer is the same: `C:\Program Files\OrcaSlicer\orca-slicer.exe` on Windows, `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer` on macOS, `/usr/bin/orca-slicer` (or the AppImage) on Linux. Its presets are read from `%APPDATA%\OrcaSlicer`, `~/Library/Application Support/OrcaSlicer` or `~/.config/OrcaSlicer` (Flatpak: `~/.var/app/io.github.softfever.OrcaSlicer/config/OrcaSlicer`), both `user/default/` and the cloud-synced `user/<uuid>/` folders.

Only Windows is tested so far; macOS and Linux follow the same code path.
