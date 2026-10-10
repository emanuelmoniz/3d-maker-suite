import { homedir } from "node:os";
import { join } from "node:path";
import type { FilamentLibrary } from "@3d-maker-suite/core";
import { slicerPresetLibrary } from "@3d-maker-suite/slicer-presets";

// macOS and Linux paths are from Bambu's docs, not tested here.
export function studioDefaultDirs(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string[] {
  if (platform === "win32")
    return [join(env.APPDATA ?? join(home, "AppData", "Roaming"), "BambuStudio")];
  if (platform === "darwin") return [join(home, "Library", "Application Support", "BambuStudio")];
  return [
    join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "BambuStudio"),
    join(home, ".var", "app", "com.bambulab.BambuStudio", "config", "BambuStudio"), // Flatpak
  ];
}

export const bambuStudioLibrary = (
  defaultDirs: () => string[] = studioDefaultDirs,
): FilamentLibrary => slicerPresetLibrary("bambu-studio", defaultDirs);
