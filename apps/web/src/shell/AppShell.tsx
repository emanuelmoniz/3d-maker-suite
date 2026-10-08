import { Link, Outlet } from "@tanstack/react-router";
import { Ellipsis, Printer } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
import { ALL_ITEMS, NAV_GROUPS, type NavItem, SETTINGS_ITEM } from "./nav.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

const linkClass =
  "flex items-center gap-3 rounded-md px-2.5 h-9 text-muted hover:bg-surface-2 hover:text-fg " +
  "data-[status=active]:bg-accent-soft data-[status=active]:text-accent data-[status=active]:font-medium";

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
    </Link>
  );
}

function Brand() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5 font-semibold">
      <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
        <Printer className="size-[18px]" aria-hidden />
      </span>
      <span className="hidden lg:inline">{t("common:appName")}</span>
    </div>
  );
}

function Sidebar() {
  const { t } = useTranslation();
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
      <div className="flex flex-col gap-2 border-t border-border p-2">
        <SideLink item={SETTINGS_ITEM} />
        <ThemeToggle className="flex-col lg:flex-row" />
      </div>
    </aside>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const sheet = useRef<HTMLDialogElement>(null);
  const primary = ALL_ITEMS.filter((i) => i.primary);
  const more = ALL_ITEMS.filter((i) => !i.primary);
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
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        {t("common:a11y.skipToContent")}
      </a>
      <Sidebar />
      <main id="main" className={cx("min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8")}>
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
