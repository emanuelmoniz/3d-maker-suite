import { type AnyRoute, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./components/EmptyState.tsx";
import { loadNamespace } from "./i18n.ts";
import { CostsPage } from "./pages/costs/CostsPage.tsx";
import { FilamentPage } from "./pages/filament/FilamentPage.tsx";
import { LibraryImportPage } from "./pages/filament/LibraryImportPage.tsx";
import { ProfileCreatePage } from "./pages/filament/ProfileFormPage.tsx";
import { SpoolCreatePage } from "./pages/filament/SpoolFormPage.tsx";
import { SpoolImportPage } from "./pages/filament/SpoolImportPage.tsx";
import { ModulePage } from "./pages/ModulePage.tsx";
import { MaintenancePage } from "./pages/maintenance/MaintenancePage.tsx";
import { TypeCreatePage } from "./pages/maintenance/TypeFormPage.tsx";
import { PrinterDetailPage } from "./pages/printers/PrinterDetailPage.tsx";
import { PrinterCreatePage, PrinterEditPage } from "./pages/printers/PrinterFormPage.tsx";
import { PrintersPage } from "./pages/printers/PrintersPage.tsx";
import { PrintCreatePage, PrintEditPage } from "./pages/prints/PrintFormPage.tsx";
import { PrintReviewPage } from "./pages/prints/PrintReviewPage.tsx";
import { PrintsPage } from "./pages/prints/PrintsPage.tsx";
import { ProjectDetailPage } from "./pages/projects/ProjectDetailPage.tsx";
import { ProjectCreatePage, ProjectEditPage } from "./pages/projects/ProjectFormPage.tsx";
import { ProjectsPage } from "./pages/projects/ProjectsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { IntegrationCreatePage } from "./pages/settings/IntegrationFormPage.tsx";
import { IntegrationLoginPage } from "./pages/settings/IntegrationLoginPage.tsx";
import { IntegrationsPage } from "./pages/settings/IntegrationsPage.tsx";
import { StatsPage } from "./pages/stats/StatsPage.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { ALL_ITEMS, SETTINGS_ITEM } from "./shell/nav.ts";

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
  SETTINGS_ITEM.to,
  "/printers",
  "/maintenance",
  "/filament",
  "/prints",
  "/projects",
  "/costs",
  "/stats",
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
      Promise.all([loadNamespace("printers"), loadNamespace("settings"), loadNamespace("tags")]),
    component,
  });

// "/printers/new" is declared before "/printers/$id" so it wins the match.
const routes: AnyRoute[] = [
  ...modules,
  printerRoute("/printers", PrintersPage),
  printerRoute("/printers/new", PrinterCreatePage),
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
  createRoute({
    getParentRoute: () => root,
    path: "/filament/spools/new",
    loader: () => Promise.all([loadNamespace("filament"), loadNamespace("tags")]),
    component: SpoolCreatePage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/profiles/new",
    loader: () => Promise.all([loadNamespace("filament"), loadNamespace("tags")]),
    component: ProfileCreatePage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/spools/import",
    loader: () => loadNamespace("filament"),
    component: SpoolImportPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/import",
    loader: () => loadNamespace("filament"),
    component: LibraryImportPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/filament",
    loader: () => Promise.all([loadNamespace("filament"), loadNamespace("tags")]),
    component: FilamentPage,
  }),
  ...[
    ["/prints", PrintsPage],
    ["/prints/new", PrintCreatePage],
    ["/prints/review", PrintReviewPage],
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
          loadNamespace("prints"),
          loadNamespace("tags"),
          loadNamespace("costs"),
        ]),
      component: component as () => ReactNode,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/costs",
    loader: () => loadNamespace("costs"),
    component: CostsPage,
  }),
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
    path: SETTINGS_ITEM.to,
    loader: () => loadNamespace("settings"),
    component: SettingsPage,
  }),
  ...[
    ["/settings/integrations", IntegrationsPage],
    ["/settings/integrations/new", IntegrationCreatePage],
    ["/settings/integrations/$id/login", IntegrationLoginPage],
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
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
