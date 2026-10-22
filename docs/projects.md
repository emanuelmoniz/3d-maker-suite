# Projects and folders

A project is a folder of files on disk: models (`.3mf`, `.stl`, `.step`, `.stp`), pictures, notes (`.md`, `.txt`, `.pdf`) and `.url` shortcuts. You tell the app which **project folders** (roots) to watch in Settings → Projects, and it finds the projects inside them. Nothing is moved or renamed for you, and what you edit in the app (name, description, tags, cover) is never overwritten by a scan.

## Recommended structure

One folder per project, numbered, directly under a root:

```
3d-files/
  000_template/          ← template, never a project
  001_aquarium-lid/
    aquarium-lid.3mf
    cover.png
    README.md
  002_cable-clip/
    cable-clip.stl
    cable-clip.gcode.3mf
  003_desk-organizer/
    parts/
      base.stl
      drawer.stl
    renders/
      front.png
```

## Folder names: `NNN_name`

- A name that starts with digits, one or more separators (space, `.`, `_`, `-`) and then the name is read as **number + name**: `001_aquarium-lid`, `12 - Vase` and `7.Cat` give project 1 "aquarium-lid", 12 "Vase" and 7 "Cat". The name is what you see in the app.
- The number is the project number. It is kept when no other project has it. A folder without a prefix, with number 0, or with a number another project owns gets the **next free number**. When two new folders claim the same number in one scan, the first one found keeps it.
- The number is only read when the project is created. Changing the prefix later does not renumber the project (edit the number in the app).
- Folders the app creates are named `NNN_name`, with the number padded to 3 digits and characters no OS allows in a name (`< > : " | ? * \ /`) replaced by `-`.

## Template folders: `000_`

A folder numbered `0` (`000_template`, `000_new-project`) is never a project, even when it holds models. Keep a ready-made structure there and copy it for each new project.

## Which folders become projects

- **Project depth** (per root, 1 to 5, default 1) is how many folder levels below the root a project may sit. 1 means the direct subfolders.
- Going down from the root, the first folder that **holds a model file** is the project, and its subfolders are not searched for more projects. A folder at the maximum depth counts even without a model file in it, but it only becomes a project if a model is found inside (see files depth).
- A model file directly in the root is not a project. A folder with no model is not a project.
- Folders starting with `.` and `node_modules` are skipped everywhere.

## Files depth and the file limit

- **Files depth** (per root, default all) is how many subfolder levels below a project folder are listed and watched. 0 lists only the files right in the project folder, 1 adds its subfolders, and so on; empty means all levels.
- At most **1000 files** per project are listed (Settings → Projects, from 100 to 100000). Files past the limit can't be picked as preview, description or gallery image.
- Only the 50 newest `.3mf` files of a project are read for plates and filaments. The newest project `.3mf` is the main file; a sliced export (`*.gcode.3mf`) is merged into the project file of the same folder that its name starts with.
- The cover is a picture named `cover`, `preview`, `thumbnail`, `thumb` or `main`, else the plate preview of the main 3MF, else the first picture.
- The description is only a linked `.md` or `.txt` file (choose it in the project). The marketplace link comes from a `.url` shortcut first, else from a MakerWorld, Printables or Thingiverse link in a note.

## Auto slice

Per root (default on). When a project's 3MF changes on disk and a slicer integration is set up, the app slices it again and raises an alert. A project can override its root (on, off, or follow the root). See [open in slicer](open-in-slicer.md) for the slicer setup.

## Several roots: examples

Each root has its own depths, so one list can mix layouts:

| Root | Layout | Project depth | Files depth | Auto slice |
|---|---|---|---|---|
| `D:\3d\designs` (own designs) | `Category/001_name` | 2 | all | on |
| `D:\3d\downloads` | `001_name`, flat | 1 | 1 | off |
| `\\nas\archive\3d` (archive on a NAS share) | `Year/Project` | 2 | 0 | off |

- **Own designs, depth 2:** `Furniture/014_shelf-bracket` and `Toys/015_dragon` are projects; `Furniture` and `Toys` are only categories. If a category folder itself holds a model, it becomes a project and its subfolders are no longer searched.
- **Downloads, depth 1, files depth 1:** each download is one project and only its direct subfolders (e.g. `images/`) are listed, so a big unpacked archive stays cheap.
- **NAS archive, files depth 0:** only the files right in each project folder are listed. Keep auto slice off so old files don't get sliced again.

Avoid putting one root inside another. A project follows its root's auto slice setting unless it overrides it, and it counts as "off" when any root with auto slice off contains its folder.

## Adopting projects without a folder

A project made without a folder (for example by a prints import), or whose folder is gone, keeps its number. When a **new folder** whose prefix is that number shows up in a root, the scan makes it the project's folder instead of adding a second project. Only an exact number match is adopted; a folder you add by hand with typed fields is always a new project.

## Deleted files: the trash

Files removed in the app are moved, not erased, into `.3d-maker-suite-trash` in the project's root, as `<timestamp>_<project folder>/<path>`. The folder starts with a dot, so scans ignore it. Settings → Projects shows how many items it holds and empties it. The move is a rename, so a project folder on another volume than its root (a mount inside the root) can't be trashed.

## Renaming and moving folders

The app does not rename folders. Renaming a project's **files** (in the app or on disk) is safe: the next scan picks them up. Renaming a project's **folder** on disk and keeping its number prefix (`012_vase` → `012_tall-vase`) is safe too: the scan moves the project to the new folder. A folder renamed without its number, moved out of the roots or deleted shows a banner on the project page: recreate the folder, link the one where the files are now, or unlink it. Edit → Project folder does the same, and gives a project without a folder one.

## Unlinking or switching a folder

Edit → Project folder → **Unlink folder** (or **Switch to another folder…**) asks what happens to the current folder:

- **Move it to the trash:** the folder and all its files move to `.3d-maker-suite-trash` in its root, as `<timestamp>_<folder>`. They stay there until you empty the trash in Settings → Projects. The project forgets its files and print setup.
- **Keep it as it is:** nothing on disk changes. The project keeps what it knows, and scans skip the folder, so it doesn't come back as a new project. **Link it again** on the same card picks it back up as it was. Linking any other folder starts the project fresh there; deleting the project lets scans find the kept folder again.

## Deleting a project

Delete on the project page removes a project that has no prints and is in no order (move its prints to another project or to No project first). If its folder is inside a root and has no files left (empty subfolders and OS files like `desktop.ini` don't count), the folder goes too; a folder that still has files blocks the delete, because the next scan would find it as a project again.

## Docker and bind mounts

The container only sees what you mount. Mount each folder into the container and add the path **inside the container** in Settings → Projects:

```yaml
volumes:
  - /volume1/3d-files:/projects/files        # browse, upload, delete, create folders
  # - /volume1/3d-downloads:/projects/downloads:ro   # browse only
```

- With `:ro` the app can read and show projects, but uploading, deleting, moving and creating folders fails.
- The app watches folders for changes while it runs and scans once at start. Network shares (SMB, NFS) often send no change events, so use **Scan folders** on the Projects page after changing files there.
- A root that doesn't exist (an unmounted share) is reported by the scan and skipped; its projects stay in the app.

More on installing with Docker: [install.md](install.md#docker).
