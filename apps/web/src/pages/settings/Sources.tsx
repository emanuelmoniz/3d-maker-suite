import { isCatalogType } from "@3d-maker-suite/core";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { Section } from "../../components/Section.tsx";
import { type SettingsModule, useSettingsAccess } from "../../components/SettingsLink.tsx";
import { Switch } from "../../components/Switch.tsx";
import { cx, textLink } from "../../lib/cx.ts";

/**
 * A Sources tab's section (ADR-0021): the sources that feed the hub, or the machines it sends to.
 * Its blocks are the children, one card per source.
 */
export function SourcesSection({
  direction,
  children,
}: {
  direction: "share" | "receive";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Section
      title={direction === "share" ? t("settings:sources.share") : t("settings:sources.receive")}
    >
      <ul className="grid gap-3">{children}</ul>
    </Section>
  );
}

// The Sources tabs a source's data types are set up on, in menu order.
const SOURCE_MODULES = ["printers", "prints", "projects", "filament", "catalog"] as const;
const moduleOf = (type: string): SettingsModule | undefined =>
  type === "spools"
    ? "filament"
    : type === "printers" || type === "prints" || type === "projects"
      ? type
      : isCatalogType(type)
        ? "catalog"
        : undefined;

/**
 * Sync sources configurations: a button per Sources tab that `types` feed, which the viewer may
 * open. A source's lines are set up there (ADR-0021), not on its card.
 */
export function SyncSources({
  types,
  hash,
  title,
  labels,
  card,
}: {
  types: readonly string[];
  hash?: string;
  /** Instead of "Sync sources configurations" (a machine's page names its own). */
  title?: string;
  /** A button's label per module, instead of the module's name. */
  labels?: Partial<Record<SettingsModule, string>>;
  /** A card of its own (titled `title`), not a part at the foot of another. */
  card?: boolean;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const may: Record<(typeof SOURCE_MODULES)[number], boolean> = {
    printers: useSettingsAccess("printers").sources,
    prints: useSettingsAccess("prints").sources,
    projects: useSettingsAccess("projects").sources,
    filament: useSettingsAccess("filament").sources,
    catalog: useSettingsAccess("catalog").sources,
  };
  const wanted = new Set(types.map(moduleOf));
  const modules = SOURCE_MODULES.filter((m) => wanted.has(m) && may[m]);
  if (!modules.length) return null;
  const buttons = (
    <div className="flex flex-wrap gap-2">
      {modules.map((m) => (
        <Link
          key={m}
          to={`/${m}/settings/sources` as LinkProps["to"]}
          hash={hash}
          className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-border px-3 font-medium hover:bg-surface-2"
        >
          {labels?.[m] ?? t(`nav:items.${m}.label`)}
        </Link>
      ))}
    </div>
  );
  const name = title ?? t("common:syncSources");
  if (card) return <Section title={name}>{buttons}</Section>;
  return (
    <section aria-labelledby={heading} className="mt-4 grid gap-2 border-t border-border pt-4">
      <h3 id={heading} className="font-semibold">
        {name}
      </h3>
      {buttons}
    </section>
  );
}

/** A source card's icon, as on Integrations: a computer, a machine, a zip (an account has its photo). */
export function SourceIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-muted"
    >
      <Icon className="size-4" />
    </span>
  );
}

// The blocks a viewer opened, per page: a convenience, so a failed read just shows them closed.
const OPENED = "sources-opened";
const readOpened = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(OPENED) ?? "[]");
  } catch {
    return [];
  }
};

/**
 * One source in a section, as a card that folds: who it is (an account, a machine and its user) and
 * the link back to where it allows the type. Its lines (a `DataTable`, or a `SlicerGroup` each) are
 * the children. Closed at first; one opened is remembered per page, and a link into it opens it.
 */
export function SourceBlock({
  id,
  icon,
  title,
  subtitle,
  badge,
  link,
  children,
}: {
  id?: string;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  link?: { to: LinkProps["to"]; params?: object; hash?: string; label: string };
  children: ReactNode;
}) {
  const heading = useId();
  const body = useId();
  const key = id && `${location.pathname}#${id}`;
  const [open, setOpen] = useState(() => {
    const hash = location.hash.slice(1);
    const linked = !!id && (hash === id || hash.startsWith(`${id}-`));
    return linked || (!!key && readOpened().includes(key));
  });
  const toggle = () => {
    setOpen(!open);
    if (!key) return;
    try {
      const rest = readOpened().filter((k) => k !== key);
      localStorage.setItem(OPENED, JSON.stringify(open ? rest : [...rest, key]));
    } catch {
      // Not remembered: it still folds.
    }
  };
  return (
    <li
      id={id}
      aria-labelledby={heading}
      className="scroll-mt-4 rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 sm:px-4">
        <h3 id={heading} className="min-w-0 text-base font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body}
            onClick={toggle}
            className="flex min-h-11 max-w-full items-center gap-3 rounded-md text-left"
          >
            <ChevronRight
              aria-hidden
              className={cx(
                "size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
            {icon}
            <span className="grid min-w-0">
              <span className="wrap-anywhere">{title}</span>
              {subtitle && <span className="text-sm font-normal text-muted">{subtitle}</span>}
            </span>
            {badge}
          </button>
        </h3>
        {link && (
          <Link
            to={link.to}
            params={link.params as never}
            hash={link.hash}
            className={`text-sm ${textLink}`}
          >
            {link.label}
          </Link>
        )}
      </div>
      <div id={body} hidden={!open} className="grid gap-4 border-t border-border p-3 sm:p-4">
        {children}
      </div>
    </li>
  );
}

/**
 * A source's lines of one slicer, where the type belongs to a slicer (ADR-0021). The catalog
 * source's heading carries its badge and Choose brands; the rest stay quiet.
 */
export function SlicerGroup({
  id,
  name,
  badge,
  action,
  meta,
  children,
}: {
  id?: string;
  name: string;
  badge?: ReactNode;
  action?: ReactNode;
  /** One fact about the whole slicer, e.g. when it last sent. */
  meta?: string;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section id={id} aria-labelledby={heading} className="grid scroll-mt-4 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h4 id={heading} className={cx("font-medium", !badge && "text-muted")}>
            {name}
          </h4>
          {badge}
          {meta && <span className="text-sm text-muted">{meta}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "Catalog source": the one slicer heading that stands out (ADR-0020). */
export function SourceBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
      {children}
    </span>
  );
}

/** A line that follows the files: no schedule to edit, its state instead (ADR-0021). */
export type StateLine = {
  key: string;
  item: string;
  /** Its switch; none = turned on and off elsewhere (the machine page). */
  on?: { checked: boolean; label: string; disabled: boolean; set: (on: boolean) => void };
  state: ReactNode;
  tone?: "warn";
  /** Its `⋯`: what it did, as the Share lines' (a receiver's details). */
  menu?: ReactNode;
};

/**
 * Column widths every Sources table shares, so Item, On and the `⋯` line up from table to table
 * and State or When takes the rest.
 */
export const LINE_COLUMNS = { item: "w-64", on: "w-20", what: "w-64", actions: "w-32" };

/**
 * A block's state lines in one table, Item | On | State, in line with the schedule lines. The
 * State column can go by another name (`stateHeader`).
 */
export function StateLines({
  label,
  rows,
  stateHeader,
}: {
  label: string;
  rows: StateLine[];
  stateHeader?: string;
}) {
  const { t } = useTranslation();
  return (
    <DataTable
      label={label}
      rows={rows}
      rowKey={(r) => r.key}
      columns={[
        {
          id: "item",
          header: t("settings:sources.columns.item"),
          className: LINE_COLUMNS.item,
          cell: (r) => <span className="inline-block min-w-44 font-medium">{r.item}</span>,
        },
        {
          id: "on",
          header: t("settings:sources.columns.on"),
          className: LINE_COLUMNS.on,
          cell: (r) =>
            r.on && (
              <Switch
                label={r.on.label}
                labelClassName="sr-only"
                checked={r.on.checked}
                disabled={r.on.disabled}
                onChange={(e) => r.on?.set(e.target.checked)}
              />
            ),
        },
        {
          id: "state",
          header: stateHeader ?? t("settings:sources.columns.state"),
          cell: (r) => (
            <span className={cx("inline-block py-1.5", r.tone === "warn" && "text-warn")}>
              {r.state}
            </span>
          ),
        },
        {
          id: "actions",
          header: t("settings:sources.columns.actions"),
          headerCell: <span className="sr-only">{t("settings:sources.columns.actions")}</span>,
          className: LINE_COLUMNS.actions,
          cell: (r: StateLine) => <span className="flex justify-end">{r.menu}</span>,
        },
      ]}
    />
  );
}
