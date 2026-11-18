import {
  Bell,
  Calculator,
  ChartColumn,
  ClipboardList,
  FolderKanban,
  House,
  Layers,
  Library,
  type LucideIcon,
  Printer,
  Settings,
  Spool,
  Users,
} from "lucide-react";

export type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  /** Shown in the mobile bottom bar; the rest go under "More". */
  primary?: boolean;
  /** Only for who may read this part of the data (the `catalog` permission). */
  needsRead?: "catalog";
  /** Pages with their own address that still belong to this item (it stays highlighted). */
  alsoActive?: RegExp;
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
        // Maintenance is a tab of Printers (6.1.0 Step 25); its task pages keep /maintenance/.
        alsoActive: /^\/maintenance\//,
      },
      {
        to: "/filament",
        icon: Spool,
        label: "nav:items.filament.label",
        description: "nav:items.filament.description",
        primary: true,
      },
      // Brands, models, materials and their presets (ADR-0023): with `catalog` read.
      {
        to: "/catalog",
        icon: Library,
        label: "nav:items.catalog.label",
        description: "nav:items.catalog.description",
        needsRead: "catalog",
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

/** The admin pages are its tabs (6.1.0 Step 15): `pages/settings/SettingsShell.tsx`. */
export const SETTINGS_ITEM: NavItem = {
  to: "/settings",
  icon: Settings,
  label: "nav:items.settings.label",
};

/** The pages under a Settings tab that keep their own address. */
export const SETTINGS_SUB_PAGES = /^\/(hub|integrations|users|import)\//;

export const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
