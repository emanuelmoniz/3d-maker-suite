import { useQuery } from "@tanstack/react-query";
import { type LinkProps, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NestedPageHeader, PageHeader } from "../../components/PageHeader.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { api } from "../../lib/api.ts";
import { meQuery, useCan } from "../../lib/auth.ts";
import { useHasTasks, useTasksLoading } from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useUsersShown } from "../../lib/users.ts";
import { ServerActions } from "./ServerSection.tsx";

/** Hours:minutes:seconds the server has been up, ticking each second from its reported start. */
function ServerUptime() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ startedAt: string }>("GET", "/api/health"),
    refetchInterval: 30_000,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!data) return null;
  const total = Math.max(0, Math.floor((now - Date.parse(data.startedAt)) / 1000));
  const time = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return t("settings:uptime", { time });
}

/**
 * Settings' tabs (6.1.0 Step 15), each with the right its page had in the sidebar. `shown` puts it
 * in the row, `open` lets its address open: logs stay readable while logging is off, and without
 * an account the Users address still offers the first admin.
 */
function useSettingsTabs() {
  const { t } = useTranslation();
  const signedIn = !!useQuery(meQuery).data?.user;
  const values = usePreferences().data?.values;
  const hub = useCan("hub.manage") && !!values?.hubEnabled;
  const integrations = useHasTasks();
  const users = useUsersShown();
  const catalog = useCan("catalog", "read");
  const data = useCan("integrations.manage");
  const logs = useCan("settings.logs");
  return [
    { to: "/settings/hub", label: t("settings:tabs.hub"), shown: hub, open: hub },
    {
      to: "/settings/integrations",
      label: t("settings:tabs.integrations"),
      shown: integrations,
      open: integrations,
    },
    { to: "/settings/users", label: t("settings:tabs.users"), shown: users, open: users },
    {
      to: "/settings/roles",
      label: t("settings:tabs.roles"),
      shown: users && signedIn,
      open: users,
    },
    { to: "/settings/catalog", label: t("settings:tabs.catalog"), shown: catalog, open: catalog },
    { to: "/settings/data", label: t("settings:tabs.data"), shown: data, open: data },
    {
      to: "/settings/logs",
      label: t("settings:tabs.logs"),
      shown: logs && !!values?.logActive,
      open: logs,
    },
  ];
}

/** The Settings page: its title, a tab per part, and the open tab's page. */
export function SettingsShell() {
  const { t } = useTranslation();
  const me = useQuery(meQuery);
  const prefs = usePreferences();
  const tabs = useSettingsTabs();
  const tasksLoading = useTasksLoading();
  // Only the pathname: a re-render on every location change would make the `Navigate` below
  // navigate again on each one, and never stop.
  const path = useLocation({ select: (l) => l.pathname });
  if (!me.data || (!prefs.data && !prefs.isError)) return null;
  const current = tabs.find((tab) => path === tab.to || path.startsWith(`${tab.to}/`));
  const denied = !!current && !current.open;
  // An editor's Integrations tab depends on the list: wait for it before sending them away.
  if (denied && !tasksLoading) return <Navigate to="/settings" replace />;
  const general = !current;
  return (
    <>
      <PageHeader
        title={t("nav:items.settings.label")}
        description={general ? <ServerUptime /> : undefined}
        actions={general ? <ServerActions /> : undefined}
      />
      <Tabs
        label={t("settings:tabs.label")}
        items={[
          { to: "/settings", label: t("settings:tabs.general"), exact: true },
          ...tabs
            .filter((tab) => tab.shown)
            .map((tab) => ({ to: tab.to as LinkProps["to"], label: tab.label })),
        ]}
      />
      <NestedPageHeader.Provider value>{!denied && <Outlet />}</NestedPageHeader.Provider>
    </>
  );
}
