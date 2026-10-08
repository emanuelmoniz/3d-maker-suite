import { type AnyRoute, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./components/EmptyState.tsx";
import { loadNamespace } from "./i18n.ts";
import { FilamentPage } from "./pages/filament/FilamentPage.tsx";
import { ProfileCreatePage } from "./pages/filament/ProfileFormPage.tsx";
import { SpoolCreatePage } from "./pages/filament/SpoolFormPage.tsx";
import { ModulePage } from "./pages/ModulePage.tsx";
import { MaintenancePage } from "./pages/maintenance/MaintenancePage.tsx";
import { TypeCreatePage } from "./pages/maintenance/TypeFormPage.tsx";
import { PrinterDetailPage } from "./pages/printers/PrinterDetailPage.tsx";
import { PrinterCreatePage, PrinterEditPage } from "./pages/printers/PrinterFormPage.tsx";
import { PrintersPage } from "./pages/printers/PrintersPage.tsx";
import { PrintCreatePage, PrintEditPage } from "./pages/prints/PrintFormPage.tsx";
import { PrintsPage } from "./pages/prints/PrintsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
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
const built = [SETTINGS_ITEM.to, "/printers", "/maintenance", "/filament", "/prints"];
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
    loader: () => Promise.all([loadNamespace("printers"), loadNamespace("settings")]),
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
    loader: () => loadNamespace("filament"),
    component: SpoolCreatePage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/profiles/new",
    loader: () => loadNamespace("filament"),
    component: ProfileCreatePage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/filament",
    loader: () => loadNamespace("filament"),
    component: FilamentPage,
  }),
  ...[
    ["/prints", PrintsPage],
    ["/prints/new", PrintCreatePage],
    ["/prints/$id/edit", PrintEditPage],
  ].map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      loader: () => Promise.all([loadNamespace("prints"), loadNamespace("filament")]),
      component: component as () => ReactNode,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: SETTINGS_ITEM.to,
    loader: () => loadNamespace("settings"),
    component: SettingsPage,
  }),
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
