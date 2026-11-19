/**
 * Which wiki page and section explains each screen of the app. `pnpm wiki:check` and the Help links
 * read this map. Plain data with no imports, so a Node script can load the file directly.
 */

/** Every planned page of the wiki, in sidebar order. The name is the file name in `wiki/`. */
export const WIKI_PAGES = [
  "Home",
  // Get started
  "Choose-How-to-Run",
  "Install-on-Windows",
  "Install-on-macOS",
  "Install-on-Linux",
  "Install-from-Source",
  "Docker",
  "NAS",
  "Server-and-Remote-Access",
  "First-Run",
  "Use-From-Another-Device",
  "Configuration",
  "Updates",
  "Backups-and-Restore",
  "Move-or-Uninstall",
  "Hub-Setup",
  "Connector-Setup",
  // Equipment
  "Dashboard",
  "Printers",
  "Printers-Settings",
  "Accessories",
  "Maintenance",
  "Filament",
  "Filament-Settings",
  "Catalog",
  "Presets",
  "Catalog-Settings",
  // Work
  "Projects",
  "Projects-Settings",
  "Project-Folders",
  "Prints",
  "Filament-Review",
  "Prints-Settings",
  // Accounting
  "Quotes",
  "Quotes-Settings",
  "Orders",
  "Orders-Settings",
  "Clients",
  // Insights
  "Stats",
  "Alerts",
  "Alerts-Settings",
  // Administration
  "Settings-General",
  "My-Account",
  "Sign-In",
  "Users",
  "Roles",
  "Import-and-Export",
  "Logs",
  "Hub-Management",
  // Integrations
  "Integrations",
  "Bambu-Cloud",
  "Bambu-LAN",
  "Moonraker",
  "OctoPrint",
  "PrusaLink",
  "Spoolman",
  "Slicers",
  // Help
  "Troubleshooting",
  "FAQ",
  "Glossary",
  "Sources-and-Sync",
  "Archive-and-Delete",
] as const;

export type WikiPage = (typeof WIKI_PAGES)[number];

/** `section` is the heading's anchor on that page, as GitHub writes it. */
export type WikiTarget = { page: WikiPage; section: string };

/**
 * Every address that opens a page, written as in `apps/web/src/router.tsx`. Addresses that only
 * redirect are left out. Quotes, Orders, Alerts, Hub and Logs settings have no Sources tab: their
 * `/sources` address shows the General tab, so it points at the same section.
 */
export const WIKI_ROUTES = {
  "/": { page: "Dashboard", section: "dashboard" },

  "/printers": { page: "Printers", section: "printers-list" },
  "/printers/new": { page: "Printers", section: "add-or-edit-a-printer" },
  "/printers/$id": { page: "Printers", section: "printer-details" },
  "/printers/$id/edit": { page: "Printers", section: "add-or-edit-a-printer" },
  "/printers/settings": { page: "Printers-Settings", section: "general" },
  "/printers/settings/sources": { page: "Printers-Settings", section: "sources" },

  "/printers/accessories": { page: "Accessories", section: "accessories-tab" },
  "/printers/accessories/new": { page: "Accessories", section: "add-or-edit-an-accessory" },
  "/printers/accessories/$id": { page: "Accessories", section: "accessory-details" },
  "/printers/accessories/$id/edit": { page: "Accessories", section: "add-or-edit-an-accessory" },

  "/printers/maintenance": { page: "Maintenance", section: "maintenance-tab" },
  "/maintenance/new": { page: "Maintenance", section: "add-or-edit-a-task" },
  "/maintenance/types/$id": { page: "Maintenance", section: "task-details" },
  "/maintenance/types/$id/edit": { page: "Maintenance", section: "add-or-edit-a-task" },

  "/filament": { page: "Filament", section: "spools-list" },
  "/filament/spools/new": { page: "Filament", section: "add-or-edit-a-spool" },
  "/filament/spools/$id": { page: "Filament", section: "spool-details" },
  "/filament/spools/$id/edit": { page: "Filament", section: "add-or-edit-a-spool" },
  "/filament/settings": { page: "Filament-Settings", section: "general" },
  "/filament/settings/sources": { page: "Filament-Settings", section: "sources" },

  "/catalog/printers": { page: "Catalog", section: "printers-view" },
  "/catalog/filament": { page: "Catalog", section: "filament-view" },
  "/printers/brands/new": { page: "Catalog", section: "printer-brand-form" },
  "/printers/brands/$id/edit": { page: "Catalog", section: "printer-brand-form" },
  "/printers/models/new": { page: "Catalog", section: "printer-model-form" },
  "/printers/models/$id/edit": { page: "Catalog", section: "printer-model-form" },
  "/filament/brands/new": { page: "Catalog", section: "filament-brand-form" },
  "/filament/brands/$id/edit": { page: "Catalog", section: "filament-brand-form" },
  "/filament/materials/new": { page: "Catalog", section: "filament-material-form" },
  "/filament/materials/$id/edit": { page: "Catalog", section: "filament-material-form" },

  "/catalog/filament-presets/$id": { page: "Presets", section: "filament-presets" },
  "/catalog/printer-presets/$id": { page: "Presets", section: "printer-presets" },
  "/catalog/process-presets/$id": { page: "Presets", section: "process-presets" },

  "/catalog/settings": { page: "Catalog-Settings", section: "general" },
  "/catalog/settings/sources": { page: "Catalog-Settings", section: "sources" },
  "/catalog/settings/consumers": { page: "Catalog-Settings", section: "consumers" },
  "/catalog/settings/library": { page: "Catalog-Settings", section: "preset-library" },

  "/projects": { page: "Projects", section: "projects-list" },
  "/projects/new": { page: "Projects", section: "add-or-edit-a-project" },
  "/projects/$id": { page: "Projects", section: "project-details" },
  "/projects/$id/edit": { page: "Projects", section: "add-or-edit-a-project" },
  "/projects/settings": { page: "Projects-Settings", section: "general" },
  "/projects/settings/sources": { page: "Projects-Settings", section: "sources" },
  "/projects/settings/consumers": { page: "Projects-Settings", section: "consumers" },
  "/projects/settings/folders/new": { page: "Project-Folders", section: "add-or-edit-a-folder" },
  "/projects/settings/folders/$id": { page: "Project-Folders", section: "add-or-edit-a-folder" },

  "/prints": { page: "Prints", section: "prints-list" },
  "/prints/new": { page: "Prints", section: "add-or-edit-a-print" },
  "/prints/$id": { page: "Prints", section: "print-details" },
  "/prints/$id/edit": { page: "Prints", section: "add-or-edit-a-print" },
  "/prints/review": { page: "Filament-Review", section: "review-table" },
  "/prints/settings": { page: "Prints-Settings", section: "general" },
  "/prints/settings/sources": { page: "Prints-Settings", section: "sources" },

  "/quotes": { page: "Quotes", section: "quotes-list" },
  "/quotes/new": { page: "Quotes", section: "quote-form" },
  "/quotes/$id": { page: "Quotes", section: "quote-form" },
  "/quotes/settings": { page: "Quotes-Settings", section: "costs" },
  "/quotes/settings/sources": { page: "Quotes-Settings", section: "costs" },

  "/orders": { page: "Orders", section: "orders-list" },
  "/orders/new": { page: "Orders", section: "add-or-edit-an-order" },
  "/orders/$id": { page: "Orders", section: "order-details" },
  "/orders/$id/edit": { page: "Orders", section: "add-or-edit-an-order" },
  "/orders/settings": { page: "Orders-Settings", section: "order-statuses" },
  "/orders/settings/sources": { page: "Orders-Settings", section: "order-statuses" },

  "/clients": { page: "Clients", section: "clients-list" },
  "/clients/new": { page: "Clients", section: "add-or-edit-a-client" },
  "/clients/$id": { page: "Clients", section: "client-details" },
  "/clients/$id/edit": { page: "Clients", section: "add-or-edit-a-client" },

  "/stats": { page: "Stats", section: "stats" },

  "/alerts": { page: "Alerts", section: "alerts-list" },
  "/alerts/$id": { page: "Alerts", section: "alert-details" },
  "/alerts/settings": { page: "Alerts-Settings", section: "thresholds" },
  "/alerts/settings/sources": { page: "Alerts-Settings", section: "thresholds" },

  "/settings": { page: "Settings-General", section: "general" },
  "/account": { page: "My-Account", section: "my-account" },
  "/login": { page: "Sign-In", section: "sign-in" },
  "/setup": { page: "Sign-In", section: "create-the-admin-account" },

  "/settings/integrations": { page: "Integrations", section: "integrations-page" },
  "/integrations/new": { page: "Integrations", section: "add-or-edit-an-integration" },
  "/integrations/$id/edit": { page: "Integrations", section: "add-or-edit-an-integration" },

  "/settings/users": { page: "Users", section: "users-list" },
  "/users/$id": { page: "Users", section: "user-page" },
  "/settings/roles": { page: "Roles", section: "roles-list" },
  "/users/roles/new": { page: "Roles", section: "role-form" },
  "/users/roles/$id": { page: "Roles", section: "role-form" },

  "/settings/data/import": { page: "Import-and-Export", section: "import" },
  "/settings/data/export": { page: "Import-and-Export", section: "export" },
  "/import/$source/$id/$type": { page: "Import-and-Export", section: "source-review" },
  "/import/slicer-zip": { page: "Import-and-Export", section: "slicer-zip-import" },
  "/import/slicer-zip/$id": { page: "Import-and-Export", section: "slicer-zip-import" },

  "/settings/logs": { page: "Logs", section: "logs-tab" },
  "/logs/settings": { page: "Logs", section: "logs-settings" },
  "/logs/settings/sources": { page: "Logs", section: "logs-settings" },

  "/settings/hub": { page: "Hub-Management", section: "devices" },
  "/hub/settings": { page: "Hub-Management", section: "hub-settings" },
  "/hub/settings/sources": { page: "Hub-Management", section: "hub-settings" },
  "/hub/devices/$deviceId": { page: "Hub-Management", section: "machine-page" },
} as const satisfies Record<string, WikiTarget>;

export type WikiRoute = keyof typeof WIKI_ROUTES;
