import {
  type AnyRoute,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./components/EmptyState.tsx";
import { loadNamespace } from "./i18n.ts";
import { AlertDetailPage } from "./pages/alerts/AlertDetailPage.tsx";
import { AlertsPage } from "./pages/alerts/AlertsPage.tsx";
import { LoginPage, SetupPage } from "./pages/auth/AuthPages.tsx";
import { CatalogImportPage } from "./pages/catalog/CatalogImportPage.tsx";
import { CATALOG_TABS, CatalogPage, tabOf } from "./pages/catalog/CatalogPage.tsx";
import { ClientDetailPage } from "./pages/clients/ClientDetailPage.tsx";
import { ClientCreatePage, ClientEditPage } from "./pages/clients/ClientFormPage.tsx";
import { ClientsPage } from "./pages/clients/ClientsPage.tsx";
import { FilamentBrandFormPage, FilamentMaterialFormPage } from "./pages/filament/CatalogForms.tsx";
import { FilamentPage } from "./pages/filament/FilamentPage.tsx";
import { SpoolDetailPage } from "./pages/filament/SpoolDetailPage.tsx";
import { SpoolCreatePage, SpoolEditPage } from "./pages/filament/SpoolFormPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { HubPage } from "./pages/hub/HubPage.tsx";
import { MachinePage } from "./pages/hub/MachinePage.tsx";
import { ImportPage } from "./pages/import/ImportPage.tsx";
import { SlicerZipPage } from "./pages/import/SlicerZipPage.tsx";
import { SourceReviewPage } from "./pages/import/SourceReviewPage.tsx";
import { LogsPage } from "./pages/LogsPage.tsx";
import { ModulePage } from "./pages/ModulePage.tsx";
import { MaintenancePage } from "./pages/maintenance/MaintenancePage.tsx";
import { TypeDetailPage } from "./pages/maintenance/TypeDetailPage.tsx";
import { TypeCreatePage, TypeEditPage } from "./pages/maintenance/TypeFormPage.tsx";
import { OrderDetailPage } from "./pages/orders/OrderDetailPage.tsx";
import { OrderCreatePage, OrderEditPage } from "./pages/orders/OrderFormPage.tsx";
import { OrdersPage } from "./pages/orders/OrdersPage.tsx";
import {
  FilamentPresetPage,
  MachinePresetPage,
  ProcessPresetPage,
} from "./pages/presets/PresetPage.tsx";
import { AccessoryDetailPage } from "./pages/printers/AccessoryDetailPage.tsx";
import { AccessoryCreatePage, AccessoryEditPage } from "./pages/printers/AccessoryFormPage.tsx";
import { BrandFormPage, ModelFormPage } from "./pages/printers/CatalogForms.tsx";
import { PrinterDetailPage } from "./pages/printers/PrinterDetailPage.tsx";
import { PrinterCreatePage, PrinterEditPage } from "./pages/printers/PrinterFormPage.tsx";
import { PrintersPage } from "./pages/printers/PrintersPage.tsx";
import { PrintDetailPage } from "./pages/prints/PrintDetailPage.tsx";
import { PrintCreatePage, PrintEditPage } from "./pages/prints/PrintFormPage.tsx";
import { PrintReviewPage } from "./pages/prints/PrintReviewPage.tsx";
import { PrintsPage } from "./pages/prints/PrintsPage.tsx";
import { ProjectDetailPage } from "./pages/projects/ProjectDetailPage.tsx";
import { ProjectCreatePage, ProjectEditPage } from "./pages/projects/ProjectFormPage.tsx";
import { ProjectsPage } from "./pages/projects/ProjectsPage.tsx";
import { QuoteCreatePage, QuoteEditPage } from "./pages/quotes/QuoteFormPage.tsx";
import { QuotesPage } from "./pages/quotes/QuotesPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import {
  AlertsConfigPage,
  CatalogConfigPage,
  CostsConfigPage,
  FilamentConfigPage,
  HubConfigPage,
  OrdersConfigPage,
  PrintersConfigPage,
  PrintsConfigPage,
  ProjectsConfigPage,
} from "./pages/settings/ConfigPages.tsx";
import { IntegrationCreatePage } from "./pages/settings/IntegrationFormPage.tsx";
import { IntegrationLoginPage } from "./pages/settings/IntegrationLoginPage.tsx";
import { IntegrationsPage } from "./pages/settings/IntegrationsPage.tsx";
import { MyAccountPage } from "./pages/settings/MyAccountPage.tsx";
import { ProjectFolderPage } from "./pages/settings/ProjectFolderPage.tsx";
import { RoleEditPage } from "./pages/settings/RoleEditPage.tsx";
import { UserEditPage } from "./pages/settings/UserEditPage.tsx";
import { StatsPage } from "./pages/stats/StatsPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import {
  ALL_ITEMS,
  CATALOG_ITEM,
  HUB_ITEM,
  IMPORT_ITEM,
  INTEGRATIONS_ITEM,
  LOGS_ITEM,
  SETTINGS_ITEM,
  USERS_ITEM,
} from "./shell/nav.ts";

function NotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t("common:notFound.title")}
      description={t("common:notFound.body")}
    />
  );
}

/** Login and setup run without the shell: it loads data a visitor without a session can't have. */
function Root() {
  const bare = useRouterState({
    select: (s) => ["/login", "/setup"].includes(s.location.pathname),
  });
  return bare ? <Outlet /> : <AppShell />;
}

const root = createRootRoute({ component: Root, notFoundComponent: NotFound });

// Feature routes load their i18n namespace here (code-split JSON), e.g. loader: () => loadNamespace("printers").
const built = [
  "/",
  CATALOG_ITEM.to,
  IMPORT_ITEM.to,
  INTEGRATIONS_ITEM.to,
  HUB_ITEM.to,
  SETTINGS_ITEM.to,
  USERS_ITEM.to,
  LOGS_ITEM.to,
  "/printers",
  "/maintenance",
  "/filament",
  "/prints",
  "/projects",
  "/quotes",
  "/orders",
  "/clients",
  "/stats",
  "/alerts",
];
const modules = ALL_ITEMS.filter((i) => !built.includes(i.to)).map((item) =>
  createRoute({
    getParentRoute: () => root,
    path: item.to,
    component: () => <ModulePage item={item} />,
  }),
);

const printerRoute = (path: string, component: () => ReactNode) =>
  createRoute({
    getParentRoute: () => root,
    path,
    loader: () =>
      Promise.all([
        loadNamespace("printers"),
        loadNamespace("settings"),
        loadNamespace("tags"),
        // The catalog forms' locked names.
        loadNamespace("catalog"),
      ]),
    component,
  });

// "/printers/new" is declared before "/printers/$id" so it wins the match.
const routes: AnyRoute[] = [
  ...modules,
  createRoute({
    getParentRoute: () => root,
    path: "/",
    loader: () =>
      Promise.all(
        ["dashboard", "stats", "printers", "maintenance", "filament", "prints", "costs"].map(
          loadNamespace,
        ),
      ),
    component: HomePage,
  }),
  printerRoute("/printers", PrintersPage),
  printerRoute("/printers/new", PrinterCreatePage),
  ...(
    [
      ["brands", BrandFormPage],
      ["models", ModelFormPage],
    ] as const
  ).flatMap(([kind, page]) => [
    printerRoute(`/printers/${kind}/new`, page),
    printerRoute(`/printers/${kind}/$id/edit`, page),
  ]),
  printerRoute("/printers/accessories/new", AccessoryCreatePage),
  printerRoute("/printers/accessories/$id", AccessoryDetailPage),
  printerRoute("/printers/accessories/$id/edit", AccessoryEditPage),
  printerRoute("/printers/$id", PrinterDetailPage),
  printerRoute("/printers/$id/edit", PrinterEditPage),
  createRoute({
    getParentRoute: () => root,
    path: "/maintenance",
    loader: () => loadNamespace("maintenance"),
    component: MaintenancePage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/maintenance/new",
    loader: () => loadNamespace("maintenance"),
    component: TypeCreatePage,
  }),
  ...[
    ["/maintenance/types/$id", TypeDetailPage],
    ["/maintenance/types/$id/edit", TypeEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () => loadNamespace("maintenance"),
      component: component as () => ReactNode,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/spools/new",
    // printers: quick-add modals (preset, brand, material) share the catalog forms.
    loader: () => Promise.all(["filament", "tags", "printers"].map(loadNamespace)),
    component: SpoolCreatePage,
  }),
  ...[
    ["/filament/spools/$id", SpoolDetailPage],
    ["/filament/spools/$id/edit", SpoolEditPage],
    ["/catalog/filament-presets/$id", FilamentPresetPage],
    ["/catalog/printer-presets/$id", MachinePresetPage],
    ["/catalog/process-presets/$id", ProcessPresetPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () =>
        Promise.all(
          // The spool page lists its projects and prints; printers: quick-add modals; catalog: a
          // preset's source.
          ["filament", "tags", "projects", "prints", "printers", "catalog", "integrations"].map(
            loadNamespace,
          ),
        ),
      component: component as () => ReactNode,
    }),
  ),
  // Presets were profiles before 5.5, lived in Printers and Filament, then had their own module
  // (ADR-0021) until ADR-0023; old links and bookmarks still land.
  ...(
    [
      ["/filament/profiles/$id", "/catalog/filament-presets/$id"],
      ["/printers/machine-profiles/$id", "/catalog/printer-presets/$id"],
      ["/printers/print-profiles/$id", "/catalog/process-presets/$id"],
      ["/filament/presets/$id", "/catalog/filament-presets/$id"],
      ["/printers/machine-presets/$id", "/catalog/printer-presets/$id"],
      ["/printers/process-presets/$id", "/catalog/process-presets/$id"],
      ["/presets/filament/$id", "/catalog/filament-presets/$id"],
      ["/presets/printer/$id", "/catalog/printer-presets/$id"],
      ["/presets/process/$id", "/catalog/process-presets/$id"],
    ] as const
  ).map(([path, to]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      beforeLoad: ({ params }) => {
        throw redirect({ to, params });
      },
    }),
  ),
  ...(
    [
      ["brands", FilamentBrandFormPage],
      ["materials", FilamentMaterialFormPage],
    ] as const
  ).flatMap(([kind, page]) =>
    [`/filament/${kind}/new`, `/filament/${kind}/$id/edit`].map((path) =>
      createRoute({
        getParentRoute: () => root,
        path,
        loader: () =>
          Promise.all(["filament", "printers", "catalog", "integrations"].map(loadNamespace)),
        component: page,
      }),
    ),
  ),
  // Catalog (ADR-0020): one tab per part of the catalog, `/catalog` opens the first.
  createRoute({
    getParentRoute: () => root,
    path: "/catalog",
    beforeLoad: ({ location }) => {
      throw redirect({ to: "/catalog/printers", hash: location.hash });
    },
  }),
  ...CATALOG_TABS.map((tab) =>
    createRoute({
      getParentRoute: () => root,
      path: `/catalog/${tab}`,
      // A table's address on the other tab lands on its own (ADR-0023).
      beforeLoad: ({ location }: { location: { hash: string } }) => {
        const to = tabOf(location.hash);
        if (to && to !== tab) throw redirect({ to: `/catalog/${to}`, hash: location.hash });
      },
      // integrations: the names of the accounts a row can come from.
      loader: () =>
        Promise.all(
          ["catalog", "printers", "filament", "integrations", "import", "hub"].map(loadNamespace),
        ),
      component: () => <CatalogPage tab={tab} />,
    }),
  ),
  // The library and the sources were Catalog tabs before ADR-0021, then Presets settings tabs
  // until ADR-0023.
  ...(
    [
      ["/catalog/presets", "/catalog/settings/library"],
      ["/catalog/sources", "/catalog/settings/sources"],
      ["/presets/settings", "/catalog/settings"],
      ["/presets/settings/library", "/catalog/settings/library"],
      ["/presets/settings/sources", "/catalog/settings/sources"],
      // Preset sources was a tab of its own until ADR-0023's Step 11h.
      ["/catalog/settings/preset-sources", "/catalog/settings/sources"],
    ] as const
  ).map(([path, to]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      beforeLoad: ({ location }) => {
        throw redirect({ to, hash: location.hash });
      },
    }),
  ),
  // The Presets page had a tab per kind (ADR-0021): each lands on its Catalog table.
  ...(
    [
      ["/presets", "printers", "machine-presets"],
      ["/presets/printer", "printers", "machine-presets"],
      ["/presets/process", "printers", "process-presets"],
      ["/presets/filament", "filament", "filament-presets"],
    ] as const
  ).map(([path, tab, hash]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      // Keeps the table's filters (`process-presets.archived=true`).
      beforeLoad: ({ location }) => {
        throw redirect({ to: `/catalog/${tab}`, search: location.search, hash });
      },
    }),
  ),
  // The catalog tables were in Printers and Filament settings before; old links still land.
  createRoute({
    getParentRoute: () => root,
    path: "/catalog/import/$entity",
    // filament + printers: the review's pickers for brands, models and materials.
    loader: () => Promise.all(["import", "catalog", "filament", "printers"].map(loadNamespace)),
    component: CatalogImportPage,
  }),
  // The review of what an integration or an uploaded zip (`$source`) offers for one type.
  createRoute({
    getParentRoute: () => root,
    path: "/import/$source/$id/$type",
    // filament + tags + printers: a print's review can add a spool (NewSpoolDialog) and its preset.
    loader: () =>
      Promise.all(["import", "integrations", "filament", "tags", "printers"].map(loadNamespace)),
    component: SourceReviewPage,
  }),
  ...["/import/slicer-zip", "/import/slicer-zip/$id"].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      loader: () =>
        Promise.all([
          loadNamespace("import"),
          loadNamespace("filament"),
          loadNamespace("integrations"),
        ]),
      component: SlicerZipPage,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/filament",
    loader: () =>
      Promise.all([loadNamespace("filament"), loadNamespace("printers"), loadNamespace("tags")]),
    component: FilamentPage,
  }),
  ...[
    ["/prints", PrintsPage],
    ["/prints/new", PrintCreatePage],
    ["/prints/review", PrintReviewPage],
    ["/prints/$id", PrintDetailPage],
    ["/prints/$id/edit", PrintEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () =>
        Promise.all([
          loadNamespace("prints"),
          loadNamespace("filament"),
          loadNamespace("tags"),
          loadNamespace("costs"),
          loadNamespace("orders"), // the print's order
          loadNamespace("printers"), // quick-add modals (machine preset, spool preset)
        ]),
      component: component as () => ReactNode,
    }),
  ),
  ...[
    ["/projects", ProjectsPage],
    ["/projects/new", ProjectCreatePage],
    ["/projects/$id", ProjectDetailPage],
    ["/projects/$id/edit", ProjectEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () =>
        Promise.all([
          loadNamespace("projects"),
          loadNamespace("integrations"),
          loadNamespace("prints"),
          loadNamespace("tags"),
          loadNamespace("costs"),
          loadNamespace("orders"),
          loadNamespace("filament"), // spool names in the slicing setup
        ]),
      component: component as () => ReactNode,
    }),
  ),
  // "/quotes/new" is declared before "/quotes/$id" so it wins the match.
  ...[
    ["/quotes", QuotesPage],
    ["/quotes/new", QuoteCreatePage],
    ["/quotes/$id", QuoteEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () =>
        Promise.all(
          // "projects", "filament", "integrations": the slicing setup's labels, spools, slicers.
          ["costs", "clients", "projects", "filament", "integrations"].map(loadNamespace),
        ),
      component: component as () => ReactNode,
    }),
  ),
  // The page was "Costs" before; old links and bookmarks still land.
  createRoute({
    getParentRoute: () => root,
    path: "/costs",
    beforeLoad: ({ search }) => {
      const id = (search as { quote?: string }).quote;
      throw id ? redirect({ to: "/quotes/$id", params: { id } }) : redirect({ to: "/quotes" });
    },
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/costs/settings",
    beforeLoad: () => {
      throw redirect({ to: "/quotes/settings" });
    },
  }),
  // "/orders/new" is declared before "/orders/$id" so it wins the match.
  ...[
    ["/orders", OrdersPage],
    ["/orders/new", OrderCreatePage],
    ["/orders/$id", OrderDetailPage],
    ["/orders/$id/edit", OrderEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      // "prints", "tags", "costs": the order's prints table; "clients": the new client dialog.
      loader: () =>
        Promise.all(["orders", "clients", "costs", "prints", "tags"].map(loadNamespace)),
      component: component as () => ReactNode,
    }),
  ),
  // "/clients/new" is declared before "/clients/$id" so it wins the match.
  ...[
    ["/clients", ClientsPage],
    ["/clients/new", ClientCreatePage],
    ["/clients/$id", ClientDetailPage],
    ["/clients/$id/edit", ClientEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () => Promise.all(["clients", "costs", "orders"].map(loadNamespace)),
      component: component as () => ReactNode,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/stats",
    loader: () =>
      Promise.all([
        loadNamespace("stats"),
        loadNamespace("prints"),
        loadNamespace("costs"),
        loadNamespace("filament"),
      ]),
    component: StatsPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/alerts",
    loader: () => Promise.all([loadNamespace("alerts"), loadNamespace("integrations")]),
    component: AlertsPage,
  }),
  // Module config pages (gear button in each module header); "settings" holds the field labels.
  ...(
    [
      ["/quotes/settings", CostsConfigPage, ["costs"]],
      ["/orders/settings", OrdersConfigPage, ["orders"]],
      // integrations: the accounts' lines on Sources (ADR-0021).
      ["/printers/settings", PrintersConfigPage, ["printers", "catalog", "integrations"]],
      ["/prints/settings", PrintsConfigPage, ["prints", "integrations"]],
      // hub: the machines on Sources (ADR-0021).
      ["/projects/settings", ProjectsConfigPage, ["projects", "hub"]],
      ["/alerts/settings", AlertsConfigPage, ["alerts", "integrations"]],
      ["/hub/settings", HubConfigPage, ["hub"]],
      ["/filament/settings", FilamentConfigPage, ["filament", "integrations"]],
      // hub, integrations: the lines and the machines on Sources (ADR-0021); import, filament: the
      // zip's steps and the slicer's desktop name.
      [
        "/catalog/settings",
        CatalogConfigPage,
        ["catalog", "hub", "import", "integrations", "filament"],
      ],
    ] as const
  ).flatMap(([path, component, ns]) =>
    // Data types also have a Sources tab; Catalog has Library too (ADR-0023).
    [path, `${path}/sources`, ...(path === "/catalog/settings" ? [`${path}/library`] : [])].map(
      (path) =>
        createRoute({
          getParentRoute: () => root,
          path,
          // A catalog table's old address lands on its tab; the page keeps the default printer.
          beforeLoad: ({ location }: { location: { pathname: string; hash: string } }) => {
            if (location.pathname !== "/printers/settings") return;
            const tab = tabOf(location.hash);
            if (tab) throw redirect({ to: `/catalog/${tab}`, hash: location.hash });
          },
          loader: () => Promise.all(["settings", ...ns].map(loadNamespace)),
          component,
        }),
    ),
  ),
  // After "/alerts/settings" so that wins the match.
  createRoute({
    getParentRoute: () => root,
    path: "/alerts/$id",
    loader: () => Promise.all(["alerts", "integrations", "maintenance"].map(loadNamespace)),
    component: AlertDetailPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: IMPORT_ITEM.to,
    // filament + tags + printers: a print's review can add a spool (NewSpoolDialog) and its preset.
    loader: () =>
      Promise.all(["import", "integrations", "filament", "tags", "printers"].map(loadNamespace)),
    component: ImportPage,
  }),
  ...(
    [
      ["/login", LoginPage],
      ["/setup", SetupPage],
      ["/account", MyAccountPage],
    ] as const
  ).map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      loader: () => loadNamespace("users"),
      component,
    }),
  ),
  // A project folder's page; "/new" is declared before "/$id" so it wins the match.
  ...(["/projects/settings/folders/new", "/projects/settings/folders/$id"] as const).map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      // users: the save bar.
      loader: () => Promise.all(["settings", "hub", "users"].map(loadNamespace)),
      component: ProjectFolderPage,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: SETTINGS_ITEM.to,
    // The Users and Roles sections were here before 5.6.0: their `#users` and `#roles` links land.
    beforeLoad: ({ location }) => {
      const h = location.hash.replace(/^#/, "");
      if (h === "users") throw redirect({ to: "/users" });
      if (h === "roles") throw redirect({ to: "/users/roles" });
    },
    loader: () => Promise.all(["settings", "logs", "users"].map(loadNamespace)),
    component: SettingsPage,
  }),
  // Users | Roles: a tab each. "/users/roles" and "/users/roles/new" are declared next to
  // "/users/$id"; static segments win the match.
  ...(
    [
      ["/users", () => <UsersPage tab="users" />],
      ["/users/roles", () => <UsersPage tab="roles" />],
      ["/users/$id", UserEditPage],
      ["/users/roles/new", RoleEditPage],
      ["/users/roles/$id", RoleEditPage],
    ] as const
  ).map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      loader: () => loadNamespace("users"),
      component,
    }),
  ),
  // Their edit pages were under Settings before 5.6.0.
  ...(
    [
      ["/settings/users/$id", "/users/$id"],
      ["/settings/roles/new", "/users/roles/new"],
      ["/settings/roles/$id", "/users/roles/$id"],
    ] as const
  ).map(([path, to]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      beforeLoad: ({ params }) => {
        throw redirect({ to, params });
      },
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: HUB_ITEM.to,
    loader: () => loadNamespace("hub"),
    component: HubPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/hub/presets",
    beforeLoad: ({ location }) => {
      throw redirect({ to: "/catalog/settings/library", hash: location.hash });
    },
  }),
  createRoute({
    getParentRoute: () => root,
    path: `${HUB_ITEM.to}/devices/$deviceId`,
    // integrations: the slicers' names.
    loader: () => Promise.all(["hub", "integrations"].map(loadNamespace)),
    component: MachinePage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: LOGS_ITEM.to,
    loader: () => loadNamespace("logs"),
    component: LogsPage,
  }),
  ...[
    ["/integrations", IntegrationsPage],
    ["/integrations/new", IntegrationCreatePage],
    ["/integrations/$id/login", IntegrationLoginPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      // import + filament: a server slicer card's "import from a zip" steps (ManagedSlicer.tsx).
      loader: () => Promise.all(["integrations", "import", "filament"].map(loadNamespace)),
      component: component as () => ReactNode,
    }),
  ),
];

if (import.meta.env.DEV) {
  const { DesignPage } = await import("./pages/DesignPage.tsx");
  routes.push(
    createRoute({
      getParentRoute: () => root,
      path: "/design",
      loader: () => loadNamespace("design"),
      component: DesignPage,
    }),
  );
}

export const router = createRouter({
  routeTree: root.addChildren(routes),
  defaultPreload: "intent",
  // Plain query strings (not JSON): list pages pass their search params straight to the API.
  parseSearch: (s) => Object.fromEntries(new URLSearchParams(s)),
  stringifySearch: (o) => {
    const q = new URLSearchParams(o as Record<string, string>).toString();
    return q ? `?${q}` : "";
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
