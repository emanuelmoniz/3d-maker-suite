import {
  IMPORT_COLUMNS,
  type ImportColumn,
  type ImportEntity,
  type ImportTemplate,
} from "@3d-maker-suite/core";
import type { TFunction } from "i18next";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
export const ENTITIES: Record<ImportEntity, { label: string; to: string; view: string }> = {
  spools: { label: "import:entities.spools", to: "/filament", view: "import:done.viewSpools" },
  printers: {
    label: "import:entities.printers",
    to: "/printers",
    view: "import:done.viewPrinters",
  },
  accessories: {
    label: "import:entities.accessories",
    to: "/printers",
    view: "import:done.viewAccessories",
  },
  accessoryInstalls: {
    label: "import:entities.accessoryInstalls",
    to: "/printers",
    view: "import:done.viewAccessories",
  },
  projects: {
    label: "import:entities.projects",
    to: "/projects",
    view: "import:done.viewProjects",
  },
  prints: { label: "import:entities.prints", to: "/prints", view: "import:done.viewPrints" },
  clients: { label: "import:entities.clients", to: "/clients", view: "import:done.viewClients" },
  quotes: { label: "import:entities.quotes", to: "/quotes", view: "import:done.viewQuotes" },
  orders: { label: "import:entities.orders", to: "/orders", view: "import:done.viewOrders" },
  maintenanceTypes: {
    label: "import:entities.maintenanceTypes",
    to: "/maintenance",
    view: "import:done.viewMaintenance",
  },
  maintenance: {
    label: "import:entities.maintenance",
    to: "/maintenance",
    view: "import:done.viewMaintenance",
  },
  orderProjects: {
    label: "import:entities.orderProjects",
    to: "/orders",
    view: "import:done.viewOrders",
  },
  brands: { label: "import:entities.brands", to: "/printers", view: "import:done.viewCatalog" },
  printerModels: {
    label: "import:entities.printerModels",
    to: "/printers",
    view: "import:done.viewCatalog",
  },
  machineProfiles: {
    label: "import:entities.machineProfiles",
    to: "/printers",
    view: "import:done.viewCatalog",
  },
  printProfiles: {
    label: "import:entities.printProfiles",
    to: "/printers",
    view: "import:done.viewCatalog",
  },
  filamentBrands: {
    label: "import:entities.filamentBrands",
    to: "/filament",
    view: "import:done.viewFilamentCatalog",
  },
  filamentMaterials: {
    label: "import:entities.filamentMaterials",
    to: "/filament",
    view: "import:done.viewFilamentCatalog",
  },
  filamentProfiles: {
    label: "import:entities.filamentProfiles",
    to: "/filament",
    view: "import:done.viewFilamentCatalog",
  },
};

const HINTS: Record<ImportColumn["type"], string> = {
  text: "import:hints.text",
  ref: "import:hints.ref",
  number: "import:hints.number",
  integer: "import:hints.integer",
  money: "import:hints.money",
  date: "import:hints.date",
  datetime: "import:hints.datetime",
  color: "import:hints.color",
  enum: "import:hints.enum",
};

const NOTES: Partial<Record<ImportEntity, string[][]>> = {
  prints: [["import:template.multicolor"], ["import:template.trackUsage"]],
  printers: [["import:template.costs"]],
  accessories: [["import:template.costs"]],
  accessoryInstalls: [["import:template.accessoryInstalls"]],
  projects: [["import:template.projects"]],
  clients: [["import:template.clientMatch"]],
  quotes: [["import:template.quoteCost"]],
  orders: [["import:template.orderProjects"]],
  maintenanceTypes: [["import:template.maintenanceTypes"]],
  maintenance: [["import:template.maintenance"]],
  orderProjects: [["import:template.orderLinks"]],
  printerModels: [["import:template.catalogRefs"], ["import:template.modelPicture"]],
  machineProfiles: [["import:template.catalogRefs"]],
  printProfiles: [["import:template.catalogRefs"]],
  filamentProfiles: [["import:template.catalogRefs"]],
};

/** The translated headers and instruction sheet the server puts in a template, export or review. */
export function templateBody(entity: ImportEntity, t: TFunction): ImportTemplate {
  const columns: readonly ImportColumn[] = IMPORT_COLUMNS[entity];
  const labels = Object.fromEntries(columns.map((c) => [c.key, t(c.label, c.labelArgs)]));
  return {
    labels,
    sheets: {
      data: t(ENTITIES[entity].label),
      lists: t("import:template.lists"),
      instructions: t("import:template.instructions"),
    },
    instructions: [
      [t("import:template.intro")],
      [t("import:template.required")],
      ...(NOTES[entity] ?? []).map((row) => row.map((key) => t(key))),
      [],
      [t("import:template.column"), t("import:template.format")],
      ...columns.map((c) => [
        `${labels[c.key]}${c.required ? " *" : ""}`,
        t(HINTS[c.type], { options: c.options ?? [] }),
      ]),
    ],
  };
}
