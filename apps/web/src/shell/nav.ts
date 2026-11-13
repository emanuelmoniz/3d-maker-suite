import {
  Bell,
  Calculator,
  ChartColumn,
  ClipboardList,
  FileUp,
  FolderKanban,
  House,
  Layers,
  Library,
  type LucideIcon,
  MonitorSmartphone,
  Plug,
  Printer,
  ScrollText,
  Settings,
  Spool,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";

export type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  /** Shown in the mobile bottom bar; the rest go under "More". */
  primary?: boolean;
};

// i18n keys are written out in full so `pnpm i18n:check` can see them.
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "nav:groups.overview",
    items: [
      {
        to: "/",
        icon: House,
        label: "nav:items.home.label",
        description: "nav:items.home.description",
        primary: true,
      },
    ],
  },
  {
    label: "nav:groups.equipment",
    items: [
      {
        to: "/printers",
        icon: Printer,
        label: "nav:items.printers.label",
        description: "nav:items.printers.description",
      },
      {
        to: "/maintenance",
        icon: Wrench,
        label: "nav:items.maintenance.label",
        description: "nav:items.maintenance.description",
      },
      {
        to: "/filament",
        icon: Spool,
        label: "nav:items.filament.label",
        description: "nav:items.filament.description",
        primary: true,
      },
    ],
  },
  {
    label: "nav:groups.work",
    items: [
      {
        to: "/projects",
        icon: FolderKanban,
        label: "nav:items.projects.label",
        description: "nav:items.projects.description",
        primary: true,
      },
      {
        to: "/prints",
        icon: Layers,
        label: "nav:items.prints.label",
        description: "nav:items.prints.description",
        primary: true,
      },
    ],
  },
  {
    label: "nav:groups.accounting",
    items: [
      {
        to: "/quotes",
        icon: Calculator,
        label: "nav:items.quotes.label",
        description: "nav:items.quotes.description",
      },
      {
        to: "/orders",
        icon: ClipboardList,
        label: "nav:items.orders.label",
        description: "nav:items.orders.description",
      },
      {
        to: "/clients",
        icon: Users,
        label: "nav:items.clients.label",
        description: "nav:items.clients.description",
      },
    ],
  },
  {
    label: "nav:groups.insights",
    items: [
      {
        to: "/stats",
        icon: ChartColumn,
        label: "nav:items.stats.label",
        description: "nav:items.stats.description",
      },
      {
        to: "/alerts",
        icon: Bell,
        label: "nav:items.alerts.label",
        description: "nav:items.alerts.description",
      },
    ],
  },
];

/** Brands, models, materials and their presets (ADR-0023), with `catalog` read. */
export const CATALOG_ITEM: NavItem = {
  to: "/catalog",
  icon: Library,
  label: "nav:items.catalog.label",
  description: "nav:items.catalog.description",
};

/** Sits just above Logs, outside the groups. */
export const IMPORT_ITEM: NavItem = {
  to: "/import",
  icon: FileUp,
  label: "nav:items.import.label",
  description: "nav:items.import.description",
};

export const INTEGRATIONS_ITEM: NavItem = {
  to: "/integrations",
  icon: Plug,
  label: "nav:items.integrations.label",
  description: "nav:items.integrations.description",
};

/** Admin only, in the menu while the hub is on (ADR-0014). */
export const HUB_ITEM: NavItem = {
  to: "/hub",
  icon: MonitorSmartphone,
  label: "nav:items.hub.label",
  description: "nav:items.hub.description",
};

/** Only in the menu while logging is on (Settings -> Logs). */
export const LOGS_ITEM: NavItem = {
  to: "/logs",
  icon: ScrollText,
  label: "nav:items.logs.label",
  description: "nav:items.logs.description",
};

/** Right before Settings, with `users.manage`. */
export const USERS_ITEM: NavItem = {
  to: "/users",
  icon: UserCog,
  label: "nav:items.users.label",
  description: "nav:items.users.description",
};

export const SETTINGS_ITEM: NavItem = {
  to: "/settings",
  icon: Settings,
  label: "nav:items.settings.label",
};

/** The bottom block (ADR-0021, ADR-0023): Hub management, Integrations, Catalog, Import | Export, Logs, Users | Roles, Settings. */
export const ALL_ITEMS = [
  ...NAV_GROUPS.flatMap((g) => g.items),
  HUB_ITEM,
  INTEGRATIONS_ITEM,
  CATALOG_ITEM,
  IMPORT_ITEM,
  LOGS_ITEM,
  USERS_ITEM,
  SETTINGS_ITEM,
];
