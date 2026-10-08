import {
  Bell,
  Calculator,
  ChartColumn,
  FolderKanban,
  House,
  Layers,
  type LucideIcon,
  Printer,
  Settings,
  Spool,
  Wrench,
} from "lucide-react";

export type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
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
        primary: true,
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
        to: "/prints",
        icon: Layers,
        label: "nav:items.prints.label",
        description: "nav:items.prints.description",
        primary: true,
      },
      {
        to: "/projects",
        icon: FolderKanban,
        label: "nav:items.projects.label",
        description: "nav:items.projects.description",
      },
      {
        to: "/costs",
        icon: Calculator,
        label: "nav:items.costs.label",
        description: "nav:items.costs.description",
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

export const SETTINGS_ITEM: NavItem = {
  to: "/settings",
  icon: Settings,
  label: "nav:items.settings.label",
  description: "nav:items.settings.description",
};

export const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
