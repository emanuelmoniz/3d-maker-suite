# ADR-0013: Managed slicer, downloaded from the vendor's releases

- Status: Accepted (replaces the "Bundling a slicer binary" rejected option of ADR-0007)
- Date: 2026-10-26

## Context
ADR-0007 slices with the CLI of the slicer installed on the server's PC. A headless server, a NAS or a Docker container has no desktop slicer, so it can't slice at all. ADR-0007 rejected bundling a slicer (licence, size, version drift) and kept it as an idea for those servers. Plan 4.2.0 Phase 8 lets the user install Bambu Studio or OrcaSlicer from the app instead: we download the vendor's own release, so we never redistribute it, and the user picks the version. This ADR records which asset to use per OS, how to unpack it without new dependencies, whether the CLI slices headless, where the system profiles are, and what doesn't work.

## Decision
- **Source:** the vendor's GitHub releases (`bambulab/BambuStudio`, `OrcaSlicer/OrcaSlicer`). We list them with the same code as the app's own update check (`fetchReleases` in `updates.ts`, generalised to any repo). Pre-releases are shown only when the user asks for them. Orca's `nightly-builds` tag is always skipped.
- **Digest:** every asset in the releases API has `digest: "sha256:…"`. The download is hashed and compared before unpacking. No asset without a digest is installed.
- **Descriptor:** core gets a types-only `managedSlicer` descriptor (repo, asset matcher per OS/arch, unpack type, exe path, profiles path, licence and source link). The bambu and orca adapters fill it in. Download, unpack and smoke test live in `apps/server/src/integrations/managedSlicer.ts`.
- **Target:** `<dataDir>/slicers/<adapter>/<version>/`. The previous version is kept until the new one passes its smoke test.
  - *Step 13 amendment:* managed slicers are their own integration kind `server` (Bambu Studio (server), OrcaSlicer (server)), so the folder is per integration, `<dataDir>/slicers/<integrationId>/`, and `config/system` links to the installed version's profiles. The smoke test is `<exe> --help` exiting 0.

### Per slicer × OS

| | Asset | Unpack | Program | Profiles |
|---|---|---|---|---|
| Bambu, Windows x64 | `Bambu_Studio_win[-_]v<ver>-<build>.zip` (portable, ~450 MB) | yauzl, skipping `*.pdb` | `bambu-studio.exe` | `resources/profiles` |
| Bambu, macOS | `Bambu_Studio_mac[-_]v<ver>-<build>.dmg` (universal) | `hdiutil attach -nobrowse -readonly -noautoopen -mountpoint <tmp>`, `cp -R *.app`, `hdiutil detach` | `BambuStudio.app/Contents/MacOS/BambuStudio` | `BambuStudio.app/Contents/Resources/profiles` |
| Bambu, Linux/Docker x64 | `BambuStudio_ubu24-v…AppImage`, named `ubuntu24.04` before 02.08.03; `ubu22`/`ubuntu22.04` on glibc < 2.38 | `chmod +x`, `--appimage-extract` with the target as cwd, delete the AppImage | `squashfs-root/AppRun` | `squashfs-root/resources/profiles` |
| Orca, Windows x64/arm64 | `OrcaSlicer_Windows_V<ver>_<arch>_portable.zip` | yauzl | `orca-slicer.exe` | `resources/profiles` |
| Orca, macOS | `OrcaSlicer_Mac_universal_V<ver>.dmg` | as Bambu | `OrcaSlicer.app/Contents/MacOS/OrcaSlicer` | `OrcaSlicer.app/Contents/Resources/profiles` |
| Orca, Linux/Docker x64 | `OrcaSlicer_Linux_AppImage_Ubuntu2404_V<ver>.AppImage` | as Bambu | `squashfs-root/AppRun` | `squashfs-root/resources/profiles` |

- The matcher must use the tag's version, not "the first `.dmg`": release 02.08.04.57 also carries a `.dmg` of 02.08.04.61. Installers (`.exe`), flatpaks, `Debug_PDB_*.7z` and Orca's profile validator are never picked.
- No new dependency: zips through yauzl (deflate and store only, no zip64 in any release so far), dmg through `hdiutil`, AppImage through its own `--appimage-extract` (no FUSE needed).
- `resources/profiles` has the same layout as `<configDir>/system/` (`<vendor>.json` + `<vendor>/{machine,process,filament}`), so Step 14's managed config folder can use it as its `system/`. No download ships `machine_full`/`process_full`.

### Running the CLI
- Bambu: unchanged from ADR-0007 (`result.json` for success and errors). It refuses any flag it doesn't know (`--logfile` gives `-2`, "setup params error"), so the arguments are built per slicer.
- Orca: always `--allow-newer-file`, and `--logfile <out>/log.txt`. It writes `result.json` on Linux but not on Windows or macOS. Success is exit code 0 plus `out.3mf`. Otherwise the exit code is the error code (e.g. `-24`), and the reason is the last error line of the log.
- **Orca 2.5.0 is the minimum.** 2.4.x stops on Bambu files: `-24` (file from a newer Bambu Studio), then `-18` with `--allow-newer-file` because it requires `BBL/machine_full`. In 2.5.0 a missing `*_full` file is only a warning. Until 2.5.0 is stable, Orca is offered only with pre-releases switched on.
- **Orca's system presets aren't listed.** From 2.5.0 Orca ships its profiles only as binary `resources/profiles/<vendor>.opc` files (magic `ZCRO`, Orca's `docs/HLSD/preset-cache.md`), which our JSON preset reader can't read. A managed Orca slices with the 3MF's own settings plus imported user presets (Step 14). System-preset picking for Orca waits until Orca offers a JSON export.
- **Headless:** the slicers need no display and no xvfb. They only need their shared libraries.
- **Docker:** the base moves to `node:22-trixie-slim` (glibc 2.41; bookworm's 2.36 runs none of the Ubuntu 24.04 builds). The slicer libraries go only into a separate slicer image (Step 15), so the default image stays small:
  ```
  libgtk-3-0t64 libwebkit2gtk-4.1-0 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0
  libgl1 libegl1 libglu1-mesa libsm6 libice6 libopengl0 libmspack0t64
  ```
  The first line plus `libgl1 libegl1` is enough for Bambu; the rest is Orca's.
- **Licence:** both are AGPL-3.0. The install dialog shows the licence and a link to the release's source. We only download from the vendor's release and never host or change a binary.

## Spike results (2026-10-26)
Fixtures from `packages/3mf/fixtures`, plate 1. Bambu Studio 02.08.02.61, OrcaSlicer 2.4.2 and 2.5.0-alpha. Windows 11 x64 (this PC), Docker Desktop (`node:22-bookworm-slim` and `node:22-trixie-slim`), GitHub Actions `macos-latest` (arm64) and `macos-15-intel`.

| Run | Windows | macOS arm64 / Intel | Linux (Docker) |
|---|---|---|---|
| Bambu, `single_color` | 0h30, 18.73 g | 1812 s, 18.73 g | 0h30, 18.73 g (bookworm `ubuntu22.04`; trixie both builds) |
| Bambu, `multi_color` | 3h07, 124.71 g | 11225 s, 124.71 g | 3h07, 124.71 g |
| Orca 2.4.2, either | `-24`; `-18` with `--allow-newer-file` | same | same (trixie) |
| Orca 2.5.0-alpha, `single_color` | 0h28, 18.70 g | 1701 s, 18.70 g | 0h28, 18.70 g (trixie) |
| Orca 2.5.0-alpha, `multi_color` | `-24`; with `--allow-newer-file` 3h00, 124.53 g | same, 10826 s | same (trixie) |
| Any, `unsliced` | crash, no `result.json` | crash (SIGSEGV) | crash (SIGSEGV) |

- All seven downloads matched their API digest. The three Windows zips unpack with yauzl in 4–10 s. Bambu's unpacks to 1.7 GB, 1.1 GB of which is `BambuStudio.pdb`.
- Bambu matches ADR-0007 to the gram on every OS. Orca 2.5 on the same files: grams within 0.2 %, time 4–6 % lower (its own time model).
- Neither slicer wrote to `%APPDATA%` or `~/Library/Application Support`.
- macOS: both `.dmg` files are universal. `spctl` accepts both apps. Files fetched with curl have no quarantine flag, so Gatekeeper doesn't block them.
- Bambu's Windows zip has no VC++ runtime (`MSVCP140.dll`, `VCRUNTIME140*.dll`); it relies on the system's. Orca's portable zip includes it.
- Linux: `--appimage-extract` works in a container without FUSE. On bookworm, every Ubuntu 24.04 build fails with `GLIBC_2.38` and `GLIBCXX_3.4.32` not found. The library list above was found with `ldd`. With it, the image grows from 333 MB to 1.15 GB.

## Unsupported combinations
- Linux and Docker on arm64: Bambu has no build. Orca's `aarch64` AppImage exists but wasn't tested.
- Bambu on Windows arm64: no build. The x64 build would run under emulation (not tested).
- Orca 2.4.x on Bambu projects (`-24`/`-18`, above).
- Any Ubuntu 24.04 build (all of Orca's, Bambu's `ubu24`) on glibc < 2.38, e.g. Debian 12.
- Picking Orca system presets (binary `.opc`, above).

## Rejected options
- **Bundling a slicer in our release or Docker image:** still rejected for the reasons in ADR-0007 (licence, 150–700 MB per OS, version drift). Downloading on request keeps the user's choice of version and leaves redistribution to the vendor.
- **Running the vendor's Windows installer:** it needs elevation and touches the user's desktop install. The zip is portable and complete.
- **Mounting the AppImage with FUSE:** containers usually lack `/dev/fuse` and the capability. Extracting once works everywhere.
- **xvfb in Docker:** not needed. The CLI slices without a display.
- **Reading Orca's `.opc` files:** it's a private, versioned binary format tied to Orca's option table. Taking JSON profiles from the tag's source tree would work, but means downloading Orca's repo snapshot. Kept as an option if users ask for Orca system presets.
- **Bookworm with Bambu's `ubuntu22.04` build only:** it works, but rules out Orca entirely and depends on Bambu keeping a 22.04 build.

## Risks and mitigations
- **Asset names change** (Bambu's Linux names did between 02.08.02 and 02.08.03). Mitigation: the matcher is a small per-adapter pattern list with tests against recorded release lists. No match means "no build for this system", never a wrong file.
- **A missing VC++ runtime on Windows** (Bambu): the smoke test fails with `0xC0000135`. The UI then links to Microsoft's VC++ redistributable.
- **Disk:** 0.5–0.7 GB per installed version, plus the previous one until the new one passes. The UI shows the size before installing, and Remove frees it.
- **Orca 2.5 is still an alpha:** Orca is offered only with pre-releases switched on until a stable 2.5 exists. The minimum version is checked against the tag.
- **CLI behaviour changes between versions:** the slicer version is part of the slice cache key (ADR-0007), and Step 14 marks slices outdated on a version change.

## Consequences
- Slicing works on headless servers, NAS and Docker (x86_64) without a desktop slicer.
- Step 13: generalised `fetchReleases`, the descriptors and matchers above, the install job (download, digest, unpack, smoke test, set `slicerPath`), skipping `*.pdb`, per-slicer arguments and error reading.
- Step 14: the managed config folder uses `resources/profiles` as `system/` (Bambu, Orca ≤ 2.4). For Orca ≥ 2.5 it has no system presets.
- Step 15: `node:22-trixie-slim` base and a slicer image with the libraries above.

## Sources (checked 2026-10-26)
- Releases API: `https://api.github.com/repos/bambulab/BambuStudio/releases`, `https://api.github.com/repos/OrcaSlicer/OrcaSlicer/releases`
- Orca preset cache design: https://github.com/OrcaSlicer/OrcaSlicer/blob/main/docs/HLSD/preset-cache.md
- Orca CLI source (`src/OrcaSlicer.cpp` at `v2.4.2` and `v2.5.0-alpha`): `allow_newer_file`, `BBL/machine_full` lookups
- AppImage `--appimage-extract`: https://docs.appimage.org/user-guide/troubleshooting/fuse.html
