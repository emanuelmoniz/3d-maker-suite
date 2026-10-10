import { homedir } from "node:os";
import { join } from "node:path";
import type { FilamentLibrary, IntegrationAdapter } from "@3d-maker-suite/core";
import { slicerPresetLibrary } from "@3d-maker-suite/slicer-presets";
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

export const orcaSlicerLibrary = (defaultDirs: () => string[] = orcaDefaultDirs): FilamentLibrary =>
  slicerPresetLibrary("orca-slicer", defaultDirs);

// OrcaSlicer on the server's disk: its presets and the program itself. No print history or spools.
export function orcaSlicerAdapter(): IntegrationAdapter {
  return {
    id: "orca-slicer",
    kind: "local",
    capabilities: [
      "brands",
      "printerModels",
      "machineProfiles",
      "filamentBrands",
      "filamentProfiles",
      "openInSlicer",
    ],
    library: orcaSlicerLibrary(),
    configSchema: z.object({}),
    secretsSchema: z.object({}),
  };
}
