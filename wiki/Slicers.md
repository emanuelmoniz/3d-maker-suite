# Slicers

Bambu Studio and OrcaSlicer, connected to the app. A slicer gives your project's plates their print time and grams, so costs and quotes use the slicer's own numbers. It also brings in your brands, printers and presets. The app runs the slicer's command line in the background. No window opens, and no display is needed.

![The Integrations page with a slicer card open](../docs/images/wiki-integrations.png)

You can connect a slicer in three places:

| Where it runs | What it uses | Best for |
|---|---|---|
| **This server**, installed | The copy of the slicer installed on the computer that runs the app | A desktop PC |
| **This server**, downloaded | A copy the app downloads from the vendor and runs itself | A NAS, a server, Docker, or a PC with no slicer |
| A computer paired with the hub | The slicer on a workstation, or one the hub installs there | A server that can't run a slicer, or a faster workstation |

## Who can use it

| You can | You need |
|---|---|
| See a slicer's card, add, switch off, remove, install, update, and set the default | **Set up integrations** |
| Slice a project's plates | **Projects** with **Write**. See [Projects](Projects.md#print-setup) |

Slicing on a computer needs the hub. See [Hub setup](Hub-Setup.md).

## Before you start

- To slice on the server, the slicer must run there. On a PC, install it first, or let the app download it. In Docker, use the `-slicer` image, see [Docker](Docker.md#slicing-in-docker).
- **OrcaSlicer needs 2.5.0 or newer.** Version 2.4 can't slice Bambu files. If no stable release is new enough, the install dialog says so, and **Show pre-releases** lists the others.
- To slice on a computer, the computer needs the connector, at the hub's version, and **Use slicer as server worker** switched on, on its page in Hub management. See [Connector setup](Connector-Setup.md).
- Both slicers are AGPL-3.0 software. The app downloads the vendor's own release and never changes it.

## The slicer card

Each slicer type has one card on [Integrations](Integrations.md#integrations-page), once it has an install. It shows every install of it, on this server and on each computer.

| Part | What it means |
|---|---|
| The title and **{n} installs** | The slicer's name, and how many installs it has |
| **Default slicer** | Shown when you have more than one slicer type. It marks the slicer that slices when a plate or project names none |
| **Add to this server** | Shown while the slicer isn't on this server yet. It opens the add form with the slicer picked |
| **⋯** | **Make default slicer** (when it isn't the default), and **Remove integration** |
| **Installs** | One row per place the slicer runs, see below |
| **Sync sources configurations** | **Catalog** opens **Catalog → Catalog settings → Sources**, where the slicer's brands and presets are set up |

### Installs

Each row is one place: **This server**, or a computer's name.

| Part | What it means |
|---|---|
| The name, and **v{version}** | Where it runs, and the version installed. Click the name to open its settings |
| **Default install** | This install slices for the hub, and is the source of its catalog and system presets. Hover it for what that means |
| **Enabled** | Decides only whether this install can be the default. One switched off says **Switched off, so it can't be the default install. Turn it on to pick it.** It stays set up and keeps syncing |
| **⋯** | **Make default install** (when it can be picked), and **Delete** |

A slicer is installed once per machine. A second install on the same machine is refused with **This slicer is already set up on that machine.** A computer that has the slicer, but isn't set up yet, is listed as **{name}** with **Has it installed, not set up yet.** and the button **Set up**. **Add a machine…** lists the other computers that have **Use slicer as server worker** on.

### The default slicer

Slicing is done by the default install of the slicer type.

- Plates, projects and quotes pick a **slicer type**. A plate slices with its own, else its project's, else the default slicer, else the first one that can slice.
- **Make default slicer**, in a card's **⋯** menu, sets the default type. The default one has the **Default slicer** pill in its title.
- **Make default install**, in an install's **⋯** menu, picks which install of a type slices. It asks **Make {where} the default {name} install?** and says what the change does. When the version differs, every computer that receives the catalog gets the new system presets, and plates sliced with the old version are sliced again. Press **Make default install** to confirm.
- A type with no install that can slice is skipped.

With one slicer type, a plate just shows its name.

## Add a slicer

1. Open **Settings**, then **Integrations**, and press **Add integration**.
2. Pick **Bambu Studio** or **OrcaSlicer**.
3. Under **Where**, pick **This server**, or a computer.
4. Press **Add**.

**This server** says either **Uses the {name} installed on this computer, with its presets.** or **{name} isn't installed on this computer: the app downloads it from the vendor's releases and slices with it on this server.** A place that has the slicer already is greyed out with the reason: **Already on this server. Find it on the slicer's card.** or **Already set up on this machine.** A computer says **Uses the slicer found on this machine (version {version}).**, **Uses the slicer found on this machine.** or **Not found on this machine: the hub installs its download there.** A computer with the switch off says **Use slicer as server worker is off on this machine.**, with **Open its machine page**.

On a computer's page, **Set up Bambu Studio on this machine** does the same and picks the computer for you.

## A slicer installed on this server

Open its row on the card. The **Slicer** part has:

| Field | What it means | Required | Example |
|---|---|---|---|
| **Config folder** | Where the slicer keeps its presets. Leave empty to use the detected one, which the hint shows | No | `C:\Users\you\AppData\Roaming\BambuStudio` |
| **Slicer program** | The full path to the slicer's program. **Use as slicer** needs it | Yes, to slice | `C:\Program Files\Bambu Studio\bambu-studio.exe` |
| **Use as slicer** | **When active, this integration can be used for slicing projects.** | | On |

The program must exist on the computer that runs the app, so a NAS has none. Both fields have a button to browse the computer's folders.

| System | Bambu Studio | OrcaSlicer |
|---|---|---|
| Windows | `C:\Program Files\Bambu Studio\bambu-studio.exe` | `C:\Program Files\OrcaSlicer\orca-slicer.exe` |
| macOS | `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio` | `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer` |
| Linux | `/usr/bin/bambu-studio`, or the AppImage's path | `/usr/bin/orca-slicer`, or the AppImage's path |

Presets are read from the slicer's config folder: `%APPDATA%\OrcaSlicer`, `~/Library/Application Support/OrcaSlicer` or `~/.config/OrcaSlicer` for OrcaSlicer, and the same under `BambuStudio` for Bambu Studio. A Flatpak keeps its folder at `~/.var/app/io.github.softfever.OrcaSlicer/config/OrcaSlicer`. Both `user/default/` and the cloud-synced `user/<uuid>/` folders are read.

Only Windows is tested. macOS and Linux follow the same code.

## A slicer the app downloads

Use this on a NAS or any server without a desktop slicer. Open its row on the card.

1. Press **Install slicer**.
2. In **Install {name}**, pick a **Version**. The hint says **Download: {size}. Unpacked it takes a little more, plus the old version until the new one works.** Tick **Show pre-releases** to see pre-releases too.
3. Read the licence line, with its **Licence** and source links, and press **Install slicer**.

The row shows the progress: **Downloading {version}…**, **Checking the download…**, **Unpacking {version}…** and **Testing {version}…**. The app downloads from the vendor's GitHub releases, checks the checksum, unpacks it under `slicers/` in the data folder and starts it once to test it. Downloads are 150 to 700 MB.

| Button | What it does |
|---|---|
| **Update to {version}** | Installs a newer version. The old one stays until the new one starts |
| **Install another version** | Opens the version list again |
| **Try again** | After a failed install |
| **Remove slicer** | Deletes the download from this server. Imported presets stay. Slicing stops until you install again |

A daily check raises a **Slicer update** alert when a newer release exists. It counts pre-releases only when one is installed. Installing or removing resolves it. A slice remembers the slicer version it was made with: a new version marks it outdated, and an install slices it again for projects with automatic slicing on.

The slicers don't change your own presets. To bring in your brands, printers and presets, use **Choose brands**, or upload them as a zip. See [Presets](#presets).

## A slicer on a computer

Use this when the server can't run a slicer, or a computer is simply faster. It needs the hub and the connector. See [Hub setup](Hub-Setup.md).

1. Add the slicer with a computer under **Where**, or press **Set up** on a computer the card lists.
2. Open the computer's row on the card. Under **Slicer**, pick **Installed on the device**, or **Installed by the hub**.
3. For **Installed on the device**, a list **Slicers found on the device** shows what the connector found, with each version and path. Press **Use this program**. For a slicer that wasn't found, such as an AppImage or a portable copy, switch on **Manual path**, type the **Program path on the device**, and press **Check and use**. The app starts it there with `--help` to check it.
4. For **Installed by the hub**, the hub downloads the slicer onto the computer. It uses the same buttons and checks as on the server.
5. Make it the default: in its **⋯** menu, press **Make default install**.

Only the default install slices. It slices once the hub has the slicer's system presets, from the server's slicer or from a zip. Presets stay on the hub. Each slice sends the computer the flattened presets and the 3MF, and the result comes back. The computer needs no preset folder.

The row says **{name} is online.** or **{name} is offline now.** and, once chosen, **Uses version {version} at {path}.** **Delete** in the row's **⋯** menu removes it: a slicer the hub installed there is removed, and one installed by hand stays.

A slice on a computer takes at most 10 minutes, as on the server. If the computer is offline, the plate says **Waiting for the slice worker** and the queue goes on. It slices when the computer is back, or when you press **Slice**. There is no fallback to another install. Pick another default install for that.

The slice remembers the computer and the slicer version, so a new version marks it outdated. It also remembers the presets it used. When one of them changes in the [preset library](Catalog-Settings.md#preset-library), the slice shows as outdated.

## Presets

- **Bambu Studio (server)** and **OrcaSlicer (server)** bring in their brands, printers and presets from the download, with the same options as an installed slicer. Use **Choose brands** on [Catalog settings](Catalog-Settings.md#choose-brands).
- **OrcaSlicer** ships its system presets as binary files. The app reads them. If a newer OrcaSlicer changes the format, **Choose brands** says **Couldn't read the slicer's brands. Check its folder above.** until the app is updated. Meanwhile it slices with the 3MF's own settings plus the user presets you import.
- **Your own presets:** zip the slicer's config folder on your computer and upload it from **No connector? Upload a zip** on [Catalog settings](Catalog-Settings.md#upload-a-zip). The zip is merged into the hub's preset library, so presets already there stay. Slicing on the server and on computers uses that library. Where the slicer has no folder of yours to read, the **Catalog** sources tab says **This slicer has no folder of yours to read. To use your brands, printers and presets here, import them from a desktop install of {name}:** and lists the steps.
- **A preset you save in a slicer that runs on the server** reaches the catalog within a minute, on its own.
- **Presets belong to a slicer.** A Bambu Studio process or printer preset doesn't exist in OrcaSlicer, and the other way round. A slicer's presets are never matched to the other's, even with the same name. The slicer pickers mark slicers that don't fit a plate's presets, and the plate warns before slicing. A filament preset of the other slicer is fine: that slot slices with the file's own filament.

See [Presets](Presets.md) for what a preset is, and [Projects](Projects.md#print-setup) for the plate's slicer, printer, printer preset and process preset.

## Common tasks

### Slice on a NAS

1. Use the `-slicer` Docker image. See [Docker](Docker.md#slicing-in-docker).
2. **Add integration**, pick **Bambu Studio** or **OrcaSlicer**, and **This server**.
3. On its row, press **Install slicer**, pick a version, and press **Install slicer** again.
4. Upload your presets as a zip, see [Presets](#presets).

### Slice on a workstation

1. In **Hub management**, open the computer and switch on **Use slicer as server worker**.
2. **Add integration**, pick the slicer, and pick the computer under **Where**.
3. On its row, pick **Use this program**.
4. In its **⋯** menu, press **Make default install**.

### Update a downloaded slicer

1. Open the slicer's row.
2. Press **Update to {version}**.

## Related settings

- **Catalog → Catalog settings → Sources** holds the slicer's lines for brands, models and presets.
- **Hub management** has **Use slicer as server worker** for each computer.
- **Slice again when the file changes** on a project's **Print setup**.

## Limits and tips

- A slicer needs no display, only its shared libraries.
- Only x64 is supported for the downloaded Linux slicer: Bambu Lab has no Linux ARM build. Bambu Studio on Windows ARM isn't offered either.
- In OrcaSlicer, a process preset can't be applied to a project made in Bambu Studio: OrcaSlicer rejects a setting saved in the file, with error `-18`. Open and save the project in OrcaSlicer first.
- Only a changed preset marks a slice outdated. Changing a plate's spool only changes its price.
- A database from before version 5.5.0 with both an installed and a downloaded copy keeps both working. The card says **Installed twice on this server: the copy found installed here and a download. Both keep working; delete one.**

## Problems and fixes

| What you see | What to do |
|---|---|
| **The slicer couldn't slice the file.** and a reason on the plate | Read the reason: no objects on the plate, a preset that doesn't exist in that slicer, or the slicer's own error line. A file that crashes the slicer is worth opening once in the desktop slicer |
| **Couldn't download {version}. Check the server's internet connection and try again.** | Check the server's internet connection, then **Try again** |
| **The download of {version} doesn't match its checksum, so it wasn't installed.** | Try again. If it keeps happening, the download is damaged |
| **Couldn't unpack {version}. Is there enough free disk space?** | Free some disk space |
| **{version} was downloaded but doesn't start on this server, so it wasn't installed.** | The server lacks a library. In Docker, use the `-slicer` image |
| **{version} needs the Microsoft Visual C++ Redistributable (x64). Install it, then try again.** | Use **Get the Visual C++ Redistributable** and install it on that Windows computer |
| **No stable release can be installed on this server yet. Switch on pre-releases to see the others.** | Tick **Show pre-releases** |
| **No release has a build for this server's system.** | This system isn't supported for a download. Use a computer instead |
| **Couldn't read the releases from GitHub. Check the server's internet connection and try again later.** | Check the connection |
| **Its device was revoked. Pick another one.** | The computer was removed from the hub. Add the slicer on another one |
| **The connector on the device is too old for slice workers. Update it to the hub's version, then try again.** | Update the connector in Hub management |
| **The device isn't a slice worker. Turn it on in Hub management.** | Switch on **Use slicer as server worker** |
| **That program doesn't start on the device. Check the path.** | Fix the **Program path on the device** |
| **Waiting for the slice worker** | The computer is offline. Start it, or pick another default install |

## Related pages

- [Integrations](Integrations.md)
- [Projects](Projects.md)
- [Presets](Presets.md)
- [Catalog settings](Catalog-Settings.md)
- [Docker](Docker.md)
- [Hub setup](Hub-Setup.md)
