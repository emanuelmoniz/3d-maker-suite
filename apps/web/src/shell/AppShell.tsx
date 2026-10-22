import { Link, Outlet } from "@tanstack/react-router";
import { Ellipsis, Printer, Sparkles, X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { unreadCount, useAlertAction, useAlerts } from "../lib/alerts.ts";
import { useApplyBranding, useAppName, useBrandingUrl } from "../lib/branding.ts";
import { cx } from "../lib/cx.ts";
import { setDateTimePrefs } from "../lib/format.ts";
import { usePreferences } from "../lib/preferences.ts";
import { useUpdates } from "../lib/updates.ts";
import {
  ALL_ITEMS,
  IMPORT_ITEM,
  INTEGRATIONS_ITEM,
  LOGS_ITEM,
  NAV_GROUPS,
  type NavItem,
  SETTINGS_ITEM,
} from "./nav.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

const linkClass =
  "relative flex items-center gap-3 rounded-md px-2.5 h-9 text-muted hover:bg-surface-2 hover:text-fg " +
  "data-[status=active]:bg-accent-soft data-[status=active]:text-accent data-[status=active]:font-medium";

/** Unread-alert count on the Alerts nav item. */
function Badge({ to }: { to: string }) {
  const { t } = useTranslation();
  const count = unreadCount(useAlerts().data);
  if (to !== "/alerts" || !count) return null;
  return (
    <span
      role="status"
      aria-label={t("nav:unreadAlerts", { count })}
      className="ml-auto min-w-5 rounded-full bg-bad px-1.5 text-center text-xs font-medium text-white max-lg:absolute max-lg:right-0.5 max-lg:top-0.5 max-lg:ml-0 max-lg:min-w-4 max-lg:px-1 max-lg:text-[10px]"
    >
      {count}
    </span>
  );
}

function SideLink({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      className={linkClass}
      title={t(item.label)}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className="hidden lg:inline">{t(item.label)}</span>
      <Badge to={item.to} />
    </Link>
  );
}

function Brand() {
  const name = useAppName();
  const logo = useBrandingUrl("logo");
  return (
    <div className="flex min-w-0 items-center gap-2.5 font-semibold">
      {logo ? (
        <img src={logo} alt={name} className="size-8 shrink-0 rounded-md object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-fg">
          <Printer className="size-[18px]" aria-hidden />
        </span>
      )}
      <span className="hidden truncate lg:inline">{name}</span>
    </div>
  );
}

/** A new release, while its alert is open and not snoozed; dismissing hides it (ADR-0009).
 * The shell only has `common` and `nav` loaded, so its strings live in `common`. */
function UpdateBanner() {
  const { t } = useTranslation();
  const act = useAlertAction();
  const a = useAlerts().data?.find(
    (x) =>
      x.kind === "update_available" && !(x.snoozedUntil && Date.parse(x.snoozedUntil) > Date.now()),
  );
  if (!a) return null;
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-accent/40 bg-accent-soft px-4 py-2.5"
    >
      <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">
        {t("common:updateBanner.available", { version: a.context.version })}
      </span>
      <Link to="/settings" hash="updates" className="font-medium text-accent hover:underline">
        {t("common:updateBanner.see")}
      </Link>
      <button
        type="button"
        className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={t("common:updateBanner.dismiss")}
        onClick={() => act.mutate({ id: a.id, action: "dismiss" })}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** The Logs item is in the menu only while logging is on. */
const useLogsShown = () => !!usePreferences().data?.values.logActive;

function Sidebar() {
  const { t } = useTranslation();
  const logsShown = useLogsShown();
  const version = useUpdates().data?.version;
  return (
    <aside className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col border-r border-border bg-surface md:flex lg:w-56">
      <div className="flex h-14 items-center px-3 lg:px-4">
        <Brand />
      </div>
      <nav aria-label={t("common:a11y.mainNav")} className="flex-1 overflow-y-auto px-2 pb-3">
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="mt-3 first:mt-0">
            <p className="hidden px-2.5 pb-1 text-xs text-muted lg:block">{t(g.label)}</p>
            <div className="flex flex-col gap-0.5">
              {g.items.map((i) => (
                <SideLink key={i.to} item={i} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-border p-2">
        <SideLink item={IMPORT_ITEM} />
        <SideLink item={INTEGRATIONS_ITEM} />
        {logsShown && <SideLink item={LOGS_ITEM} />}
        <SideLink item={SETTINGS_ITEM} />
        <ThemeToggle className="mt-1.5 flex-col lg:flex-row" />
        {version && (
          <p className="hidden px-2.5 text-xs text-muted lg:block">
            {t("common:version", { version })}
          </p>
        )}
      </div>
    </aside>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const sheet = useRef<HTMLDialogElement>(null);
  const primary = ALL_ITEMS.filter((i) => i.primary);
  const logsShown = useLogsShown();
  const more = ALL_ITEMS.filter((i) => !i.primary && (logsShown || i !== LOGS_ITEM));
  const tab =
    "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted data-[status=active]:text-accent";
  return (
    <>
      <nav
        aria-label={t("common:a11y.mainNav")}
        className="fixed inset-x-0 bottom-0 z-10 flex h-14 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {primary.map((i) => (
          <Link key={i.to} to={i.to} activeOptions={{ exact: i.to === "/" }} className={tab}>
            <i.icon className="size-5" aria-hidden />
            {t(i.label)}
          </Link>
        ))}
        <button type="button" className={tab} onClick={() => sheet.current?.showModal()}>
          <Ellipsis className="size-5" aria-hidden />
          {t("common:actions.more")}
        </button>
      </nav>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively */}
      <dialog
        ref={sheet}
        onClick={(e) => e.target === sheet.current && sheet.current?.close()}
        className="m-0 mt-auto w-full max-w-none rounded-t-lg border border-border bg-surface p-3 text-fg backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-0.5">
          {more.map((i) => (
            <Link key={i.to} to={i.to} className={linkClass} onClick={() => sheet.current?.close()}>
              <i.icon className="size-[18px]" aria-hidden />
              {t(i.label)}
              <Badge to={i.to} />
            </Link>
          ))}
        </div>
        <ThemeToggle className="mt-3" />
      </dialog>
    </>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  useApplyBranding();
  const prefs = usePreferences().data?.values;
  if (prefs) setDateTimePrefs(prefs);
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        {t("common:a11y.skipToContent")}
      </a>
      <Sidebar />
      <main
        id="main"
        key={`${prefs?.dateFormat}${prefs?.timeFormat}`}
        className={cx("min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8")}
      >
        <div className="mx-auto max-w-6xl">
          <UpdateBanner />
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
