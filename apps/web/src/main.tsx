import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import i18n from "./i18n.ts";
import "./styles.css";
import { preferencesQuery } from "./lib/preferences.ts";
import { setTheme } from "./lib/theme.ts";
import { router } from "./router.tsx";

document.title = i18n.t("common:appName");

const queryClient = new QueryClient();

// Server is the source of truth; localStorage only avoids a theme flash on load.
queryClient
  .fetchQuery(preferencesQuery)
  .then(({ values }) => setTheme({ mode: values.themeMode, accent: values.accent }, false))
  .catch(() => {});

// biome-ignore lint/style/noNonNullAssertion: root exists in index.html
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
