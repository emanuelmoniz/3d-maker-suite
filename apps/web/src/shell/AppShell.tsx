import { REPO_URL, SITE_URL } from "@3d-maker-suite/core";
import { Link, Outlet } from "@tanstack/react-router";
import {
  CircleUser,
  Download,
  Ellipsis,
  LoaderCircle,
  Power,
  Printer,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../components/Button.tsx";
import { Menu } from "../components/Menu.tsx";
import { unreadCount, useAlertAction, useAlerts } from "../lib/alerts.ts";
import { FORBIDDEN_EVENT } from "../lib/api.ts";
import { useCan, useMe, useMyRole, useSignOut } from "../lib/auth.ts";
import { useApplyBranding, useAppName, useBrandingUrl } from "../lib/branding.ts";
import { cx, textLink } from "../lib/cx.ts";
import { setDateTimePrefs } from "../lib/format.ts";
import { useHasTasks } from "../lib/integrations.ts";
import { usePreferences } from "../lib/preferences.ts";
import { useServerState, useSetServerState } from "../lib/serverState.ts";
import { useVersion } from "../lib/updates.ts";
import { useUsersShown } from "../lib/users.ts";
import {
  ALL_ITEMS,
  CATALOG_ITEM,
  HUB_ITEM,
  IMPORT_ITEM,
  INTEGRATIONS_ITEM,
  LOGS_ITEM,
  NAV_GROUPS,
  type NavItem,
  SETTINGS_ITEM,
  USERS_ITEM,
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
      <Icon className="size-4.5 shrink-0" aria-hidden />
      <span className="hidden lg:inline">{t(item.label)}</span>
      <Badge to={item.to} />
    </Link>
  );
}

/** Sidebar brand from `md` up; `mobile` is the header above the content, below `md`. */
function Brand({ mobile = false }: { mobile?: boolean }) {
  const name = useAppName();
  const logo = useBrandingUrl("logo");
  return (
    <div
      className={cx("flex min-w-0 items-center gap-2.5 font-semibold", mobile && "mb-4 md:hidden")}
    >
      {logo ? (
        <img src={logo} alt={name} className="size-8 shrink-0 rounded-md object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-fg">
          <Printer className="size-4.5" aria-hidden />
        </span>
      )}
      <span className={cx("truncate", !mobile && "hidden lg:inline")}>{name}</span>
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
      <Link to="/settings" hash="updates" className={textLink}>
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

/** The server said no (403): the role isn't enough for what was just tried. */
function ForbiddenBanner() {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(true);
    window.addEventListener(FORBIDDEN_EVENT, on);
    return () => window.removeEventListener(FORBIDDEN_EVENT, on);
  }, []);
  if (!shown) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex items-center gap-x-4 rounded-lg border border-bad/40 bg-surface-2 px-4 py-2.5"
    >
      <ShieldAlert className="size-4 shrink-0 text-bad" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">{t("common:forbidden")}</span>
      <button
        type="button"
        className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={t("common:updateBanner.dismiss")}
        onClick={() => setShown(false)}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const PHASES = {
  preparing: "common:serverOverlay.preparing",
  installing: "common:serverOverlay.installing",
  slow: "common:serverOverlay.slow",
} as const;

/**
 * Stop, restart or update: the server is away, so the page is frosted over until it's back (the
 * waiting code reloads it). A modal <dialog> like the others, but Escape doesn't close it.
 * Staying mounted underneath keeps About's own messages for when the overlay closes.
 */
function ServerOverlay() {
  const { t } = useTranslation();
  const s = useServerState();
  const set = useSetServerState();
  const ref = useRef<HTMLDialogElement>(null);
  const current = useRef(s);
  current.current = s;
  useEffect(() => {
    const d = ref.current;
    if (s && !d?.open) d?.showModal();
    if (!s && d?.open) d.close();
  }, [s]);
  const failed = s?.kind === "restarting" && s.timedOut;
  const slow = s?.kind === "updating" && s.phase === "slow";
  const waiting = !!s && s.kind !== "stopped" && !failed && !slow;
  const Icon = s?.kind === "updating" ? Download : Power;
  return (
    <dialog
      ref={ref}
      aria-labelledby="server-overlay-text"
      onCancel={(e) => e.preventDefault()}
      // Chrome closes on a repeated Escape without a cancel event: open it again.
      onClose={() => current.current && ref.current?.showModal()}
      className="m-0 h-dvh max-h-none w-full max-w-none place-items-center bg-bg/85 p-4 text-fg backdrop-blur-md backdrop:bg-transparent open:grid"
    >
      {s && (
        <div className="grid max-w-sm justify-items-center gap-5 text-center">
          <div className="relative grid size-20 place-items-center">
            {waiting && (
              <LoaderCircle
                aria-hidden
                strokeWidth={1}
                className="busy-spinner absolute inset-0 size-20 text-accent"
              />
            )}
            <span
              className={cx(
                "grid size-14 place-items-center rounded-full border bg-surface",
                failed
                  ? "border-bad/50 text-bad"
                  : waiting
                    ? "border-accent/40 text-accent"
                    : "border-border text-muted",
              )}
            >
              <Icon className="size-6" aria-hidden />
            </span>
          </div>
          <p
            id="server-overlay-text"
            role={failed ? "alert" : "status"}
            className="text-base font-medium text-balance"
          >
            {s.kind === "stopped" && t("common:serverOverlay.stopped")}
            {s.kind === "restarting" &&
              t(s.timedOut ? "common:serverOverlay.timeout" : "common:serverOverlay.restarting")}
            {s.kind === "updating" && t(PHASES[s.phase])}
          </p>
          {failed && (
            <a href={s.url} className={cx(textLink, "wrap-anywhere")}>
              {s.url}
            </a>
          )}
          {slow && <Button onClick={() => set(null)}>{t("common:actions.close")}</Button>}
        </div>
      )}
    </dialog>
  );
}

const menuItem = "flex h-9 items-center rounded-md px-3 hover:bg-surface-2";

/** Name, account link and sign out; absent while no accounts exist. */
function UserMenu() {
  const { t } = useTranslation();
  const user = useMe();
  const role = useMyRole();
  const out = useSignOut();
  if (!user) return null;
  return (
    <Menu
      label={t("common:userMenu.label", { name: user.displayName })}
      triggerClass="h-9 w-full gap-3 px-2.5 text-muted hover:text-fg"
      trigger={
        <>
          <CircleUser className="size-4.5 shrink-0" aria-hidden />
          <span className="hidden truncate lg:inline">{user.displayName}</span>
        </>
      }
    >
      <p className="px-3 py-1.5 text-muted wrap-anywhere">
        {user.email} · {role?.name}
      </p>
      <Link to="/account" className={menuItem}>
        {t("common:userMenu.account")}
      </Link>
      <button type="button" className={cx(menuItem, "text-left")} onClick={() => out.mutate()}>
        {t("common:userMenu.signOut")}
      </button>
    </Menu>
  );
}

/** The same, inside the mobile "More" sheet. */
function SheetUser({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const user = useMe();
  const role = useMyRole();
  const out = useSignOut();
  if (!user) return null;
  return (
    <div className="mt-2 grid gap-0.5 border-t border-border pt-2">
      <p className="px-2.5 py-1.5 text-muted wrap-anywhere">
        {user.displayName} · {role?.name}
      </p>
      <Link to="/account" className={linkClass} onClick={onNavigate}>
        {t("common:userMenu.account")}
      </Link>
      <button type="button" className={cx(linkClass, "text-left")} onClick={() => out.mutate()}>
        {t("common:userMenu.signOut")}
      </button>
    </div>
  );
}

/** The Logs item is in the menu only while logging is on, and only with settings.logs. */
const useLogsShown = () => {
  const on = !!usePreferences().data?.values.logActive;
  return useCan("settings.logs") && on;
};

/** Hub management: hub.manage, while the hub is on. */
const useHubShown = () => {
  const on = !!usePreferences().data?.values.hubEnabled;
  return useCan("hub.manage") && on;
};

function Sidebar() {
  const { t } = useTranslation();
  const logsShown = useLogsShown();
  const hubShown = useHubShown();
  const importShown = useCan("integrations.manage");
  const catalogShown = useCan("catalog", "read");
  const usersShown = useUsersShown();
  const tasks = useHasTasks();
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
        {hubShown && <SideLink item={HUB_ITEM} />}
        {tasks && <SideLink item={INTEGRATIONS_ITEM} />}
        {catalogShown && <SideLink item={CATALOG_ITEM} />}
        {importShown && <SideLink item={IMPORT_ITEM} />}
        {logsShown && <SideLink item={LOGS_ITEM} />}
        {usersShown && <SideLink item={USERS_ITEM} />}
        <SideLink item={SETTINGS_ITEM} />
        <UserMenu />
        <ThemeToggle className="mt-1.5 flex-col lg:flex-row" />
      </div>
    </aside>
  );
}

/** Year, version and links at the foot of every page; the links open in a new tab. */
function Footer() {
  const { t } = useTranslation();
  const version = useVersion();

  return (
    <footer className="mt-10 border-t border-border pt-4 text-sm text-muted">
      <Trans
        t={t}
        i18nKey="common:footer.line"
        values={{
          year: new Date().getFullYear(),
          version: version ?? "",
          stage: version?.includes("-") ? t("common:footer.preRelease") : t("common:footer.stable"),
        }}
        components={{
          site: (
            <a href={SITE_URL} target="_blank" rel="noreferrer" className={textLink}>
              {t("common:footer.site")}
            </a>
          ),
          github: (
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={textLink}>
              {t("common:footer.github")}
            </a>
          ),
        }}
      />
    </footer>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const sheet = useRef<HTMLDialogElement>(null);
  const primary = ALL_ITEMS.filter((i) => i.primary);
  const logsShown = useLogsShown();
  const hubShown = useHubShown();
  const importShown = useCan("integrations.manage");
  const catalogShown = useCan("catalog", "read");
  const usersShown = useUsersShown();
  const tasks = useHasTasks();
  const more = ALL_ITEMS.filter(
    (i) =>
      !i.primary &&
      (usersShown || i !== USERS_ITEM) &&
      (catalogShown || i !== CATALOG_ITEM) &&
      (logsShown || i !== LOGS_ITEM) &&
      (importShown || i !== IMPORT_ITEM) &&
      (tasks || i !== INTEGRATIONS_ITEM) &&
      (hubShown || i !== HUB_ITEM),
  );
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
              <i.icon className="size-4.5" aria-hidden />
              {t(i.label)}
              <Badge to={i.to} />
            </Link>
          ))}
        </div>
        <SheetUser onNavigate={() => sheet.current?.close()} />
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
        className={cx("flex min-w-0 flex-1 flex-col px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8")}
      >
        <div className="mx-auto w-full max-w-6xl flex-1">
          <Brand mobile />
          <ForbiddenBanner />
          <UpdateBanner />
          <Outlet />
        </div>
        <div className="mx-auto w-full max-w-6xl">
          <Footer />
        </div>
      </main>
      <BottomNav />
      <ServerOverlay />
    </div>
  );
}
