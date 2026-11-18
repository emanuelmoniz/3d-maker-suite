import type { Capability } from "@3d-maker-suite/core";

type Target = {
  to:
    | "/printers"
    | "/prints"
    | "/filament"
    | "/settings/catalog/printers"
    | "/settings/catalog/filament";
  /** Id of the catalog table on its tab. */
  hash?: string;
  label: string;
};

/** Where a finished sync of each type lands: the module, or the catalog section it filled. Keys are written out in full for i18n:check. */
export const SYNC_TARGETS: Partial<Record<Capability, Target>> = {
  printers: { to: "/printers", label: "alerts:view.sync.printers" },
  prints: { to: "/prints", label: "alerts:view.sync.prints" },
  spools: { to: "/filament", label: "alerts:view.sync.spools" },
  brands: { to: "/settings/catalog/printers", hash: "brands", label: "alerts:view.sync.brands" },
  printerModels: {
    to: "/settings/catalog/printers",
    hash: "printer-models",
    label: "alerts:view.sync.printerModels",
  },
  machinePresets: {
    to: "/settings/catalog/printers",
    hash: "machine-presets",
    label: "alerts:view.sync.machinePresets",
  },
  processPresets: {
    to: "/settings/catalog/printers",
    hash: "process-presets",
    label: "alerts:view.sync.processPresets",
  },
  filamentBrands: {
    to: "/settings/catalog/filament",
    hash: "filament-brands",
    label: "alerts:view.sync.filamentBrands",
  },
  filamentMaterials: {
    to: "/settings/catalog/filament",
    hash: "filament-materials",
    label: "alerts:view.sync.filamentMaterials",
  },
  filamentPresets: {
    to: "/settings/catalog/filament",
    hash: "filament-presets",
    label: "alerts:view.sync.filamentPresets",
  },
  userMachinePresets: {
    to: "/settings/catalog/printers",
    hash: "machine-presets",
    label: "alerts:view.sync.machinePresets",
  },
  userProcessPresets: {
    to: "/settings/catalog/printers",
    hash: "process-presets",
    label: "alerts:view.sync.processPresets",
  },
  userFilamentPresets: {
    to: "/settings/catalog/filament",
    hash: "filament-presets",
    label: "alerts:view.sync.filamentPresets",
  },
};
