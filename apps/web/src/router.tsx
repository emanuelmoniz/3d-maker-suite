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
import type { SettingsModule } from "./components/SettingsLink.tsx";
import { loadNamespace } from "./i18n.ts";
import {
  at,
  cfg,
  either,
  form,
  on,
  PUBLIC,
  type RouteAccess,
  type RouteRight,
  SESSION,
} from "./lib/routeAccess.ts";
import { AlertDetailPage } from "./pages/alerts/AlertDetailPage.tsx";
import { AlertsPage } from "./pages/alerts/AlertsPage.tsx";
import { LoginPage, SetupPage } from "./pages/auth/AuthPages.tsx";
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
import { DATA_TABS, ImportPage } from "./pages/import/ImportPage.tsx";
import { SlicerZipPage } from "./pages/import/SlicerZipPage.tsx";
import { SourceReviewPage } from "./pages/import/SourceReviewPage.tsx";
import { LogsPage } from "./pages/LogsPage.tsx";
import { ModulePage } from "./pages/ModulePage.tsx";
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
  LogsConfigPage,
  OrdersConfigPage,
  PrintersConfigPage,
  PrintsConfigPage,
  ProjectsConfigPage,
} from "./pages/settings/ConfigPages.tsx";
import {
  IntegrationCreatePage,
  IntegrationEditPage,
} from "./pages/settings/IntegrationFormPage.tsx";
import { IntegrationsPage } from "./pages/settings/IntegrationsPage.tsx";
import { MyAccountPage } from "./pages/settings/MyAccountPage.tsx";
import { ProjectFolderPage } from "./pages/settings/ProjectFolderPage.tsx";
import { RoleEditPage } from "./pages/settings/RoleEditPage.tsx";
import { SettingsShell } from "./pages/settings/SettingsShell.tsx";
import { UserEditPage } from "./pages/settings/UserEditPage.tsx";
import { StatsPage } from "./pages/stats/StatsPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
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
  SETTINGS_ITEM.to,
  "/printers",
  "/filament",
  "/catalog",
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
    staticData: { access: { need: SESSION } },
    component: () => <ModulePage item={item} />,
  }),
);

/**
 * What each page needs (6.2.0 Step 3f, `lib/routeAccess.ts`); `shell/RouteGuard.tsx` enforces it.
 * A form the person may read goes to its item or list with a notice; an area with no right at all
 * shows "You can't open this". `routeAccess.test.ts` fails on a page that declares nothing.
 */
const read = (module: Parameters<typeof at>[0]): RouteAccess => ({ need: at(module, "read") });
const PRINTERS = at("printers", "read");
const CATALOG_READ = at("catalog", "read");
const CATALOG_MANAGE = at("catalog", "manage");
// A preset's page opens from Printers and Filament too (the server's GET rule).
const PRESETS = either(PRINTERS, at("filament", "read"), CATALOG_READ);
const printerForm = (to: string) => form(at("printers", "manage"), PRINTERS, to);
/** A module's list, add form, item page and edit form: read opens the pages, `level` the forms. */
const crud = (module: Parameters<typeof at>[0], level: Parameters<typeof at>[1], list: string) => ({
  list: read(module),
  add: form(at(module, level), at(module, "read"), list),
  item: read(module),
  edit: form(at(module, level), at(module, "read"), `${list}/$id`),
});
/**
 * A module's settings page (`ConfigPage`): its General address needs the settings right, and
 * someone with only the Sources tab lands there quietly; the Sources and Consumers addresses open
 * with either. Without both, back to the module with the notice if they read it (ADR-0012, ADR-0021).
 */
const configAccess = (
  base: string,
  path: string,
  module: SettingsModule,
  moduleRead: RouteRight | null,
): RouteAccess => {
  const settings = cfg(module, "settings");
  const sources = cfg(module, "sources");
  const back = module === "hub" || module === "logs" ? `/settings/${module}` : `/${module}`;
  const toModule = moduleRead ? [{ if: moduleRead, to: back, notice: true as const }] : [];
  if (path === base)
    return { need: settings, otherwise: [{ if: sources, to: `${base}/sources` }, ...toModule] };
  if (path.endsWith("/library")) return { need: settings, otherwise: toModule };
  return { need: either(settings, sources), otherwise: toModule };
};
const PRINTS = crud("prints", "write", "/prints");
const PROJECTS = crud("projects", "write", "/projects");
const QUOTES = crud("costs", "write", "/quotes");
const ORDERS = crud("costs", "write", "/orders");
const CLIENTS = crud("costs", "write", "/clients");
const access = (a: RouteAccess) => ({ staticData: { access: a } });

const printerRoute = (
  path: string,
  component: () => ReactNode,
  a: RouteAccess,
  extra: { beforeLoad?: (ctx: { location: { search: object; hash: string } }) => void } = {},
) =>
  createRoute({
    getParentRoute: () => root,
    path,
    ...access(a),
    ...extra,
    loader: () =>
      Promise.all([
        loadNamespace("printers"),
        loadNamespace("maintenance"),
        loadNamespace("settings"),
        loadNamespace("tags"),
        // The catalog forms' locked names.
        loadNamespace("catalog"),
      ]),
    component,
  });

/** Settings' title and tabs around the open tab (6.1.0 Step 15). */
const settingsLayout = createRoute({
  getParentRoute: () => root,
  path: SETTINGS_ITEM.to,
  ...access({ need: SESSION }),
  // users: the accounts switch on General and the save bar.
  loader: () => Promise.all(["settings", "logs", "users"].map(loadNamespace)),
  component: SettingsShell,
});

/** A Settings tab: an admin area, so no right shows "You can't open this" (6.2.0 Step 3f). */
const settingsTab = (
  path: string,
  namespaces: string[],
  component: () => ReactNode,
  need: RouteAccess["need"],
) =>
  createRoute({
    getParentRoute: () => settingsLayout,
    path,
    ...access({ need }),
    loader: () => Promise.all(namespaces.map(loadNamespace)),
    component,
  });

const settingsTabs: AnyRoute[] = [
  createRoute({
    getParentRoute: () => settingsLayout,
    path: "/",
    ...access({ need: SESSION }),
    // The Users and Roles sections were here before 5.6.0: their `#users` and `#roles` links land.
    beforeLoad: ({ location }) => {
      const h = location.hash.replace(/^#/, "");
      if (h === "users") throw redirect({ to: "/settings/users" });
      if (h === "roles") throw redirect({ to: "/settings/roles" });
    },
    component: SettingsPage,
  }),
  settingsTab("hub", ["hub"], HubPage, on("hub.manage")),
  // import + filament: a server slicer card's "import from a zip" steps (ManagedSlicer.tsx).
  settingsTab(
    "integrations",
    ["integrations", "import", "filament"],
    IntegrationsPage,
    either(on("integrations.sync"), on("integrations.review"), on("integrations.manage")),
  ),
  settingsTab("users", ["users"], () => <UsersPage tab="users" />, on("users.manage")),
  settingsTab("roles", ["users"], () => <UsersPage tab="roles" />, on("users.manage")),
  // Catalog was a tab of Settings (6.1.0 Steps 15 to 22): its addresses land on the page.
  ...["catalog", ...CATALOG_TABS.map((tab) => `catalog/${tab}`)].map((path) =>
    createRoute({
      getParentRoute: () => settingsLayout,
      path,
      beforeLoad: ({ location }) => {
        const tab = path.split("/")[1] ?? tabOf(location.hash) ?? CATALOG_TABS[0];
        throw redirect({ to: `/catalog/${tab}`, search: location.search, hash: location.hash });
      },
    }),
  ),
  // Data: Import and Export, a tab each; `/settings/data` opens the first.
  createRoute({
    getParentRoute: () => settingsLayout,
    path: "data",
    beforeLoad: ({ location }) => {
      if (location.pathname.replace(/\/$/, "") === "/settings/data")
        throw redirect({
          to: "/settings/data/import",
          search: location.search,
          hash: location.hash,
        });
    },
  }),
  ...DATA_TABS.map((tab) =>
    // filament + tags + printers: a print's review can add a spool (NewSpoolDialog) and its preset.
    settingsTab(
      `data/${tab}`,
      ["import", "integrations", "catalog", "filament", "tags", "printers"],
      () => <ImportPage tab={tab} />,
      on("integrations.manage"),
    ),
  ),
  settingsTab("logs", ["logs"], LogsPage, on("settings.logs")),
];

// "/printers/new" is declared before "/printers/$id" so it wins the match.
const routes: AnyRoute[] = [
  settingsLayout.addChildren(settingsTabs),
  // The admin pages were sidebar items before 6.1.0 Step 15; a link keeps its filters and its card.
  ...(
    [
      ["/hub", "/settings/hub"],
      ["/integrations", "/settings/integrations"],
      ["/import", "/settings/data/import"],
      ["/logs", "/settings/logs"],
      ["/users", "/settings/users"],
      ["/users/roles", "/settings/roles"],
    ] as const
  ).map(([path, to]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      beforeLoad: ({ location }) => {
        throw redirect({ to, search: location.search, hash: location.hash });
      },
    }),
  ),
  ...modules,
  // Catalog (ADR-0023): one tab per part of the catalog, `/catalog` opens the first.
  createRoute({
    getParentRoute: () => root,
    path: "/catalog",
    beforeLoad: ({ location }) => {
      throw redirect({
        to: "/catalog/printers",
        search: location.search,
        hash: location.hash,
      });
    },
  }),
  ...CATALOG_TABS.map((tab) =>
    createRoute({
      getParentRoute: () => root,
      path: `/catalog/${tab}`,
      // A table's address on the other tab lands on its own (ADR-0023).
      beforeLoad: ({ location }: { location: { hash: string; search: object } }) => {
        const to = tabOf(location.hash);
        if (to && to !== tab)
          throw redirect({
            to: `/catalog/${to}`,
            search: location.search,
            hash: location.hash,
          });
      },
      ...access({ need: CATALOG_READ }),
      // integrations: the names of the accounts a row can come from.
      loader: () =>
        Promise.all(
          ["catalog", "printers", "filament", "integrations", "import", "hub", "settings"].map(
            loadNamespace,
          ),
        ),
      component: () => <CatalogPage tab={tab} />,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/",
    ...access({ need: SESSION }),
    loader: () =>
      Promise.all(
        ["dashboard", "stats", "printers", "maintenance", "filament", "prints", "costs"].map(
          loadNamespace,
        ),
      ),
    component: HomePage,
  }),
  // Printers and Accessories need printers read, Maintenance its own: without one, the other tab.
  printerRoute(
    "/printers",
    () => <PrintersPage tab="printers" />,
    { need: PRINTERS, otherwise: [{ if: at("maintenance", "read"), to: "/printers/maintenance" }] },
    {
      // The accessories table sat below the printers: its `accessories.*` filters land on its tab.
      beforeLoad: ({ location }) => {
        const search = Object.fromEntries(
          Object.entries(location.search).filter(([k]) => k.startsWith("accessories.")),
        );
        if (Object.keys(search).length)
          throw redirect({
            to: "/printers/accessories",
            search: search as never,
            hash: location.hash,
          });
      },
    },
  ),
  printerRoute("/printers/accessories", () => <PrintersPage tab="accessories" />, {
    need: PRINTERS,
    otherwise: [{ if: at("maintenance", "read"), to: "/printers/maintenance" }],
  }),
  printerRoute("/printers/new", PrinterCreatePage, printerForm("/printers")),
  ...(
    [
      ["brands", BrandFormPage],
      ["models", ModelFormPage],
    ] as const
  ).flatMap(([kind, page]) => [
    printerRoute(
      `/printers/${kind}/new`,
      page,
      form(CATALOG_MANAGE, CATALOG_READ, "/catalog/printers"),
    ),
    printerRoute(
      `/printers/${kind}/$id/edit`,
      page,
      form(CATALOG_MANAGE, CATALOG_READ, "/catalog/printers"),
    ),
  ]),
  printerRoute(
    "/printers/accessories/new",
    AccessoryCreatePage,
    printerForm("/printers/accessories"),
  ),
  printerRoute("/printers/accessories/$id", AccessoryDetailPage, read("printers")),
  printerRoute(
    "/printers/accessories/$id/edit",
    AccessoryEditPage,
    printerForm("/printers/accessories/$id"),
  ),
  printerRoute("/printers/$id", PrinterDetailPage, read("printers")),
  printerRoute("/printers/$id/edit", PrinterEditPage, printerForm("/printers/$id")),
  printerRoute("/printers/maintenance", () => <PrintersPage tab="maintenance" />, {
    need: at("maintenance", "read"),
    otherwise: [{ if: PRINTERS, to: "/printers" }],
  }),
  // Maintenance was a page of its own before 6.1.0 Step 25: it is a tab of Printers now.
  createRoute({
    getParentRoute: () => root,
    path: "/maintenance",
    beforeLoad: ({ location }) => {
      throw redirect({
        to: "/printers/maintenance",
        search: location.search as never,
        hash: location.hash,
      });
    },
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/maintenance/new",
    ...access(
      form(at("maintenance", "manage"), at("maintenance", "read"), "/printers/maintenance"),
    ),
    loader: () => loadNamespace("maintenance"),
    component: TypeCreatePage,
  }),
  ...(
    [
      ["/maintenance/types/$id", TypeDetailPage, read("maintenance")],
      [
        "/maintenance/types/$id/edit",
        TypeEditPage,
        form(at("maintenance", "manage"), at("maintenance", "read"), "/maintenance/types/$id"),
      ],
    ] as const
  ).map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...access(a),
      loader: () => loadNamespace("maintenance"),
      component,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/filament/spools/new",
    ...access(form(at("filament", "write"), at("filament", "read"), "/filament")),
    // printers: quick-add modals (preset, brand, material) share the catalog forms.
    loader: () => Promise.all(["filament", "tags", "printers"].map(loadNamespace)),
    component: SpoolCreatePage,
  }),
  ...(
    [
      ["/filament/spools/$id", SpoolDetailPage, read("filament")],
      [
        "/filament/spools/$id/edit",
        SpoolEditPage,
        form(at("filament", "write"), at("filament", "read"), "/filament/spools/$id"),
      ],
      ["/catalog/filament-presets/$id", FilamentPresetPage, { need: PRESETS }],
      ["/catalog/printer-presets/$id", MachinePresetPage, { need: PRESETS }],
      ["/catalog/process-presets/$id", ProcessPresetPage, { need: PRESETS }],
    ] as const
  ).map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...access(a),
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
        ...access(form(CATALOG_MANAGE, CATALOG_READ, "/catalog/filament")),
        loader: () =>
          Promise.all(["filament", "printers", "catalog", "integrations"].map(loadNamespace)),
        component: page,
      }),
    ),
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
  // The review of what an integration or an uploaded zip (`$source`) offers for one type.
  createRoute({
    getParentRoute: () => root,
    path: "/import/$source/$id/$type",
    ...access({ need: either(on("integrations.review"), on("integrations.manage")) }),
    // filament + tags + printers: a print's review can add a spool (NewSpoolDialog) and its preset.
    loader: () =>
      Promise.all(["import", "integrations", "filament", "tags", "printers"].map(loadNamespace)),
    component: SourceReviewPage,
  }),
  ...["/import/slicer-zip", "/import/slicer-zip/$id"].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...access({ need: on("integrations.manage") }),
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
    ...access(read("filament")),
    loader: () =>
      Promise.all([loadNamespace("filament"), loadNamespace("printers"), loadNamespace("tags")]),
    component: FilamentPage,
  }),
  ...[
    ["/prints", PrintsPage, PRINTS.list],
    ["/prints/new", PrintCreatePage, PRINTS.add],
    ["/prints/review", PrintReviewPage, PRINTS.list],
    ["/prints/$id", PrintDetailPage, PRINTS.item],
    ["/prints/$id/edit", PrintEditPage, PRINTS.edit],
  ].map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      ...access(a as RouteAccess),
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
    ["/projects", ProjectsPage, PROJECTS.list],
    ["/projects/new", ProjectCreatePage, PROJECTS.add],
    ["/projects/$id", ProjectDetailPage, PROJECTS.item],
    ["/projects/$id/edit", ProjectEditPage, PROJECTS.edit],
  ].map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      ...access(a as RouteAccess),
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
    ["/quotes", QuotesPage, QUOTES.list],
    ["/quotes/new", QuoteCreatePage, QUOTES.add],
    // The saved quote is its own page: read opens it, its save controls need write.
    ["/quotes/$id", QuoteEditPage, QUOTES.item],
  ].map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      ...access(a as RouteAccess),
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
    ["/orders", OrdersPage, ORDERS.list],
    ["/orders/new", OrderCreatePage, ORDERS.add],
    ["/orders/$id", OrderDetailPage, ORDERS.item],
    ["/orders/$id/edit", OrderEditPage, ORDERS.edit],
  ].map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      ...access(a as RouteAccess),
      // "prints", "tags", "costs": the order's prints table; "clients": the new client dialog.
      loader: () =>
        Promise.all(["orders", "clients", "costs", "prints", "tags"].map(loadNamespace)),
      component: component as () => ReactNode,
    }),
  ),
  // "/clients/new" is declared before "/clients/$id" so it wins the match.
  ...[
    ["/clients", ClientsPage, CLIENTS.list],
    ["/clients/new", ClientCreatePage, CLIENTS.add],
    ["/clients/$id", ClientDetailPage, CLIENTS.item],
    ["/clients/$id/edit", ClientEditPage, CLIENTS.edit],
  ].map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      ...access(a as RouteAccess),
      loader: () => Promise.all(["clients", "costs", "orders"].map(loadNamespace)),
      component: component as () => ReactNode,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/stats",
    ...access(read("stats")),
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
    ...access({ need: SESSION }),
    loader: () => Promise.all([loadNamespace("alerts"), loadNamespace("integrations")]),
    component: AlertsPage,
  }),
  // Module config pages (gear button in each module header); "settings" holds the field labels.
  ...(
    [
      ["/quotes/settings", CostsConfigPage, ["costs"], "quotes", at("costs", "read")],
      ["/orders/settings", OrdersConfigPage, ["orders"], "orders", at("costs", "read")],
      // integrations: the accounts' lines on Sources (ADR-0021).
      [
        "/printers/settings",
        PrintersConfigPage,
        ["printers", "catalog", "integrations"],
        "printers",
        PRINTERS,
      ],
      [
        "/prints/settings",
        PrintsConfigPage,
        ["prints", "integrations"],
        "prints",
        at("prints", "read"),
      ],
      // hub: the machines on Sources (ADR-0021).
      [
        "/projects/settings",
        ProjectsConfigPage,
        ["projects", "hub"],
        "projects",
        at("projects", "read"),
      ],
      // Everyone reads their own alerts.
      ["/alerts/settings", AlertsConfigPage, ["alerts", "integrations"], "alerts", SESSION],
      // Hub management and Logs have no read level: without the right, "You can't open this".
      ["/hub/settings", HubConfigPage, ["hub"], "hub", null],
      ["/logs/settings", LogsConfigPage, ["logs"], "logs", null],
      [
        "/filament/settings",
        FilamentConfigPage,
        ["filament", "integrations"],
        "filament",
        at("filament", "read"),
      ],
      // hub, integrations: the lines and the machines on Sources (ADR-0021); import, filament: the
      // zip's steps and the slicer's desktop name. Its settings open with read.
      [
        "/catalog/settings",
        CatalogConfigPage,
        ["catalog", "hub", "import", "integrations", "filament"],
        "catalog",
        null,
      ],
    ] as const
  ).flatMap(([path, component, ns, module, moduleRead]) =>
    // Data types also have a Sources tab; Catalog and Projects have Consumers, Catalog Library too
    // (ADR-0023).
    [
      path,
      `${path}/sources`,
      ...(path === "/catalog/settings" || path === "/projects/settings"
        ? [`${path}/consumers`]
        : []),
      ...(path === "/catalog/settings" ? [`${path}/library`] : []),
    ].map((sub) =>
      createRoute({
        getParentRoute: () => root,
        path: sub,
        ...access(configAccess(path, sub, module, moduleRead)),
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
    // Each alert is its owner's: the server's 404 shows the same text as a missing one.
    ...access({ need: SESSION }),
    loader: () => Promise.all(["alerts", "integrations", "maintenance"].map(loadNamespace)),
    component: AlertDetailPage,
  }),
  ...(
    [
      ["/login", LoginPage, PUBLIC],
      ["/setup", SetupPage, PUBLIC],
      ["/account", MyAccountPage, SESSION],
    ] as const
  ).map(([path, component, need]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...access({ need }),
      // alerts: the alert kinds' names in My alerts.
      loader: () => Promise.all(["users", "alerts"].map(loadNamespace)),
      component,
    }),
  ),
  // A project folder's page; "/new" is declared before "/$id" so it wins the match.
  ...(["/projects/settings/folders/new", "/projects/settings/folders/$id"] as const).map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...access(form(at("projects", "manage"), at("projects", "read"), "/projects")),
      // users: the save bar; integrations: the rescan's schedule (catalog sync's controls).
      loader: () => Promise.all(["settings", "hub", "users", "integrations"].map(loadNamespace)),
      component: ProjectFolderPage,
    }),
  ),
  // A user's and a role's pages. "/users/roles/new" is declared next to "/users/$id"; static
  // segments win the match.
  ...(
    [
      ["/users/$id", UserEditPage],
      ["/users/roles/new", RoleEditPage],
      ["/users/roles/$id", RoleEditPage],
    ] as const
  ).map(([path, component]) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...access({ need: on("users.manage") }),
      // alerts: the alert kinds' names in the alerts card.
      loader: () => Promise.all(["users", "alerts"].map(loadNamespace)),
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
    path: "/hub/presets",
    beforeLoad: ({ location }) => {
      throw redirect({ to: "/catalog/settings/library", hash: location.hash });
    },
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/hub/devices/$deviceId",
    // A machine's own user opens it too; someone else's is the server's 404, shown as a missing one.
    ...access({ need: SESSION }),
    // integrations: the slicers' names.
    loader: () => Promise.all(["hub", "integrations"].map(loadNamespace)),
    component: MachinePage,
  }),
  ...[
    ["/integrations/new", IntegrationCreatePage, { need: on("integrations.manage") }],
    // A catalog card is catalog manage's; the page checks the account itself.
    [
      "/integrations/$id/edit",
      IntegrationEditPage,
      { need: either(on("integrations.manage"), CATALOG_MANAGE) },
    ],
  ].map(([path, component, a]) =>
    createRoute({
      getParentRoute: () => root,
      path: path as string,
      ...access(a as RouteAccess),
      // import + filament: a server slicer card's "import from a zip" steps (ManagedSlicer.tsx).
      loader: () => Promise.all(["integrations", "import", "filament"].map(loadNamespace)),
      component: component as () => ReactNode,
    }),
  ),
  // An account signed in on a page of its own before 6.1.0 Step 10c: now on its Edit page.
  createRoute({
    getParentRoute: () => root,
    path: "/integrations/$id/login",
    beforeLoad: ({ params }) => {
      throw redirect({ to: "/integrations/$id/edit", params });
    },
  }),
];

if (import.meta.env.DEV) {
  const { DesignPage } = await import("./pages/DesignPage.tsx");
  routes.push(
    createRoute({
      getParentRoute: () => root,
      path: "/design",
      ...access({ need: SESSION }),
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
