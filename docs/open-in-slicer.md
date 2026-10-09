# Open in slicer / open folder

In **Settings → Integrations**, set the **Slicer program** of an integration (e.g. Bambu Lab) to the full path of your slicer. With several slicers set up, one is the default and the project page shows a picker. The server starts it with the model file as its only argument. "Open folder" uses the OS file manager. Both only work for projects whose folder is inside a configured project folder, and for model files the scan listed.

| OS | Slicer path example | Open folder uses |
|----|---------------------|------------------|
| Windows | `C:\Program Files\Bambu Studio\bambu-studio.exe` | `explorer` |
| macOS | `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio` | `open` |
| Linux | `/usr/bin/bambu-studio` (or the AppImage path) | `xdg-open` |

Only Windows is tested so far; macOS and Linux follow the same code path.
