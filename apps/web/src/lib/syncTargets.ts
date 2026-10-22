import type { Capability } from "@3d-maker-suite/core";

type Target = {
  to: "/printers" | "/prints" | "/filament" | "/printers/settings" | "/filament/settings";
  /** Id of the catalog section on the page. */
  hash?: string;
  label: string;
};

/** Where a finished sync of each type lands: the module, or the catalog section it filled. Keys are written out in full for i18n:check. */
export const SYNC_TARGETS: Partial<Record<Capability, Target>> = {
  printers: { to: "/printers", label: "alerts:view.sync.printers" },
  prints: { to: "/prints", label: "alerts:view.sync.prints" },
  spools: { to: "/filament", label: "alerts:view.sync.spools" },
  brands: { to: "/printers/settings", hash: "brands", label: "alerts:view.sync.brands" },
  printerModels: {
    to: "/printers/settings",
    hash: "printer-models",
    label: "alerts:view.sync.printerModels",
  },
  machineProfiles: {
    to: "/printers/settings",
    hash: "machine-profiles",
    label: "alerts:view.sync.machineProfiles",
  },
  printProfiles: {
    to: "/printers/settings",
    hash: "print-profiles",
    label: "alerts:view.sync.printProfiles",
  },
  filamentBrands: {
    to: "/filament/settings",
    hash: "filament-brands",
    label: "alerts:view.sync.filamentBrands",
  },
  filamentMaterials: {
    to: "/filament/settings",
    hash: "filament-materials",
    label: "alerts:view.sync.filamentMaterials",
  },
  filamentProfiles: {
    to: "/filament/settings",
    hash: "filament-profiles",
    label: "alerts:view.sync.filamentProfiles",
  },
};
