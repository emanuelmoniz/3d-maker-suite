import { homedir } from "node:os";
import { join } from "node:path";
import {
  type FilamentLibrary,
  glibcAtLeast,
  type IntegrationAdapter,
  type ManagedSlicer,
  pickAsset,
  tagPattern,
} from "@3d-maker-suite/core";
import { cliSlicer, slicerPresetLibrary } from "@3d-maker-suite/slicer-presets";
import { z } from "zod";

// Windows checked against OrcaSlicer 2.4; macOS and Linux paths are from Orca's docs, not tested here.
// Orca 2.4+ keeps cloud-synced presets in user/<uuid>/ next to user/default/; the shared reader reads both.
export function orcaDefaultDirs(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string[] {
  if (platform === "win32")
    return [join(env.APPDATA ?? join(home, "AppData", "Roaming"), "OrcaSlicer")];
  if (platform === "darwin") return [join(home, "Library", "Application Support", "OrcaSlicer")];
  return [
    join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "OrcaSlicer"),
    join(home, ".var", "app", "io.github.softfever.OrcaSlicer", "config", "OrcaSlicer"), // Flatpak
  ];
}

export const orcaSlicerLibrary = (
  defaultDirs: () => string[] = orcaDefaultDirs,
): FilamentLibrary => ({
  ...slicerPresetLibrary("orca-slicer", defaultDirs),
  folders: {
    windows: "%APPDATA%\\OrcaSlicer",
    mac: "~/Library/Application Support/OrcaSlicer",
    linux: "~/.config/OrcaSlicer",
  },
});

// OrcaSlicer on the server's disk: its presets and the program itself. No print history or spools.
export function orcaSlicerAdapter(): IntegrationAdapter {
  return {
    id: "orca-slicer",
    kind: "local",
    capabilities: [
      "brands",
      "printerModels",
      "machineProfiles",
      "printProfiles",
      "filamentBrands",
      "filamentMaterials",
      "filamentProfiles",
      "openInSlicer",
      "slice",
    ],
    library: orcaSlicerLibrary(),
    slicer: cliSlicer({ flavor: "orca" }),
    desktop: {
      windowsName: "OrcaSlicer",
      macApp: "OrcaSlicer.app",
      flatpak: "io.github.softfever.OrcaSlicer",
    },
    configSchema: z.object({}),
    secretsSchema: z.object({}),
  };
}

const app = (platform: string) => (platform === "darwin" ? "OrcaSlicer.app/Contents" : "");

/** ADR-0013: portable zip, universal dmg, Ubuntu 24.04 AppImage (x64, glibc ≥ 2.38). */
export const orcaManaged: ManagedSlicer = {
  repo: "OrcaSlicer/OrcaSlicer",
  licenceUrl: "https://github.com/OrcaSlicer/OrcaSlicer/blob/main/LICENSE.txt",
  // 2.4 stops on Bambu files (-24, then -18); 2.5's pre-releases count, so it's the alpha.
  minVersion: "2.5.0-alpha",
  asset(tag, names, sys) {
    const v = tagPattern(tag);
    const re =
      sys.platform === "win32"
        ? new RegExp(
            `^OrcaSlicer_Windows_V${v}_${sys.arch === "arm64" ? "arm64" : "x64"}_portable\\.zip$`,
          )
        : sys.platform === "darwin"
          ? new RegExp(`^OrcaSlicer_Mac_universal_V${v}\\.dmg$`)
          : sys.platform === "linux" && sys.arch === "x64" && glibcAtLeast(sys, "2.38")
            ? new RegExp(`^OrcaSlicer_Linux_AppImage_Ubuntu2404_V${v}\\.AppImage$`)
            : undefined;
    return pickAsset(names, re);
  },
  exe: (p) =>
    p === "win32"
      ? "orca-slicer.exe"
      : p === "darwin"
        ? `${app(p)}/MacOS/OrcaSlicer`
        : "squashfs-root/AppRun",
  profiles: (p) =>
    p === "darwin"
      ? `${app(p)}/Resources/profiles`
      : p === "win32"
        ? "resources/profiles"
        : "squashfs-root/resources/profiles",
};

// OrcaSlicer downloaded and run by the server. Its profiles ship as binary .opc files (ADR-0013),
// so it imports nothing: it slices with the 3MF's settings (and imported user presets, Step 14).
// The library is only its id: presets imported from an Orca zip are `orca-slicer:<preset>`.
export function orcaSlicerServerAdapter(): IntegrationAdapter {
  return {
    id: "orca-slicer-server",
    kind: "server",
    capabilities: ["slice"],
    library: orcaSlicerLibrary(() => []),
    slicer: cliSlicer({ flavor: "orca" }),
    managed: orcaManaged,
    configSchema: z.object({}),
    secretsSchema: z.object({}),
  };
}
