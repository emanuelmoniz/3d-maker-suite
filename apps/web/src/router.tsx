import { type AnyRoute, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./components/EmptyState.tsx";
import { loadNamespace } from "./i18n.ts";
import { ModulePage } from "./pages/ModulePage.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { ALL_ITEMS } from "./shell/nav.ts";

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
const modules = ALL_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => root,
    path: item.to,
    component: () => <ModulePage item={item} />,
  }),
);

const routes: AnyRoute[] = [...modules];

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
