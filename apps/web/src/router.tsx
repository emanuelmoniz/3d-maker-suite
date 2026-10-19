import {
  type AnyRoute,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./components/EmptyState.tsx";
import { loadNamespace } from "./i18n.ts";
import { AlertsPage } from "./pages/alerts/AlertsPage.tsx";
import { ClientDetailPage } from "./pages/clients/ClientDetailPage.tsx";
import { ClientCreatePage, ClientEditPage } from "./pages/clients/ClientFormPage.tsx";
import { ClientsPage } from "./pages/clients/ClientsPage.tsx";
import { FilamentBrandFormPage, FilamentMaterialFormPage } from "./pages/filament/CatalogForms.tsx";
import { FilamentPage } from "./pages/filament/FilamentPage.tsx";
import { ProfileDetailPage } from "./pages/filament/ProfileDetailPage.tsx";
import { ProfileCreatePage, ProfileEditPage } from "./pages/filament/ProfileFormPage.tsx";
import { SpoolDetailPage } from "./pages/filament/SpoolDetailPage.tsx";
import { SpoolCreatePage, SpoolEditPage } from "./pages/filament/SpoolFormPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ImportPage } from "./pages/import/ImportPage.tsx";
import { SlicerZipPage } from "./pages/import/SlicerZipPage.tsx";
import { SourceReviewPage } from "./pages/import/SourceReviewPage.tsx";
import { ModulePage } from "./pages/ModulePage.tsx";
import { MaintenancePage } from "./pages/maintenance/MaintenancePage.tsx";
import { TypeDetailPage } from "./pages/maintenance/TypeDetailPage.tsx";
import { TypeCreatePage, TypeEditPage } from "./pages/maintenance/TypeFormPage.tsx";
import { OrderDetailPage } from "./pages/orders/OrderDetailPage.tsx";
import { OrderCreatePage, OrderEditPage } from "./pages/orders/OrderFormPage.tsx";
import { OrdersPage } from "./pages/orders/OrdersPage.tsx";
import { AccessoryDetailPage } from "./pages/printers/AccessoryDetailPage.tsx";
import { AccessoryCreatePage, AccessoryEditPage } from "./pages/printers/AccessoryFormPage.tsx";
import {
  BrandFormPage,
  MachineProfileFormPage,
  ModelFormPage,
  PrintProfileFormPage,
} from "./pages/printers/CatalogForms.tsx";
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
  CostsConfigPage,
  FilamentConfigPage,
  OrdersConfigPage,
  PrintersConfigPage,
  PrintsConfigPage,
  ProjectsConfigPage,
} from "./pages/settings/ConfigPages.tsx";
import { IntegrationCreatePage } from "./pages/settings/IntegrationFormPage.tsx";
import { IntegrationLoginPage } from "./pages/settings/IntegrationLoginPage.tsx";
import { IntegrationsPage } from "./pages/settings/IntegrationsPage.tsx";
import { StatsPage } from "./pages/stats/StatsPage.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { ALL_ITEMS, IMPORT_ITEM, INTEGRATIONS_ITEM, SETTINGS_ITEM } from "./shell/nav.ts";

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

const root = createRootRoute({ component: AppShell, notFoundComponent: NotFound });

// Feature routes load their i18n namespace here (code-split JSON), e.g. loader: () => loadNamespace("printers").
const built = [
  "/",
  IMPORT_ITEM.to,
  INTEGRATIONS_ITEM.to,
  SETTINGS_ITEM.to,
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
        loadNamespace("integrations"),
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
      ["profiles", MachineProfileFormPage],
      ["print-profiles", PrintProfileFormPage],
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
    loader: () => Promise.all([loadNamespace("filament"), loadNamespace("tags")]),
    component: SpoolCreatePage,
  }),
  ...[
    ["/filament/spools/$id", SpoolDetailPage],
    ["/filament/spools/$id/edit", SpoolEditPage],
    ["/filament/profiles/$id", ProfileDetailPage],
    ["/filament/profiles/$id/edit", ProfileEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () => Promise.all([loadNamespace("filament"), loadNamespace("tags")]),
      component: component as () => ReactNode,
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
        loader: () => Promise.all([loadNamespace("filament"), loadNamespace("printers")]),
        component: page,
      }),
    ),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/profiles/new",
    loader: () => Promise.all([loadNamespace("filament"), loadNamespace("tags")]),
    component: ProfileCreatePage,
  }),
  // The review of what an integration or an uploaded zip (`$source`) offers for one type.
  createRoute({
    getParentRoute: () => root,
    path: "/import/$source/$id/$type",
    // filament + tags: a print's review can add a spool (NewSpoolDialog).
    loader: () => Promise.all(["import", "integrations", "filament", "tags"].map(loadNamespace)),
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
      Promise.all([
        loadNamespace("filament"),
        loadNamespace("printers"),
        loadNamespace("tags"),
        loadNamespace("integrations"),
      ]),
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
          loadNamespace("integrations"), // the Sync from cloud button on the list
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
          // "projects" and "filament": the slicing setup's labels and spool names.
          ["costs", "clients", "projects", "filament"].map(loadNamespace),
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
      ["/printers/settings", PrintersConfigPage, ["printers", "integrations", "tags"]],
      ["/filament/settings", FilamentConfigPage, ["filament", "printers", "integrations"]],
      ["/prints/settings", PrintsConfigPage, ["prints"]],
      ["/projects/settings", ProjectsConfigPage, ["projects"]],
      ["/alerts/settings", AlertsConfigPage, ["alerts", "integrations"]],
    ] as const
  ).map(([path, component, ns]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      loader: () => Promise.all(["settings", ...ns].map(loadNamespace)),
      component,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: IMPORT_ITEM.to,
    // filament + tags: a print's review can add a spool (NewSpoolDialog).
    loader: () => Promise.all(["import", "integrations", "filament", "tags"].map(loadNamespace)),
    component: ImportPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: SETTINGS_ITEM.to,
    loader: () => loadNamespace("settings"),
    component: SettingsPage,
  }),
  ...[
    ["/integrations", IntegrationsPage],
    ["/integrations/new", IntegrationCreatePage],
    ["/integrations/$id/login", IntegrationLoginPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () => loadNamespace("integrations"),
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
