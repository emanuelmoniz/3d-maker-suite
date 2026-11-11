import { Link, type LinkProps } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { Section } from "../../components/Section.tsx";
import { Switch } from "../../components/Switch.tsx";
import { cx } from "../../lib/cx.ts";

/**
 * A Sources tab's section (ADR-0021): the sources that feed the hub, or the machines it sends to.
 * Its blocks are the children, one per source; `footer` sits under them.
 */
export function SourcesSection({
  direction,
  children,
  footer,
}: {
  direction: "share" | "receive";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Section
      wide
      title={direction === "share" ? t("settings:sources.share") : t("settings:sources.receive")}
    >
      <ul className="divide-y divide-border">{children}</ul>
      {footer}
    </Section>
  );
}

/**
 * One source in a section: who it is (an account, a machine and its user) and the link back to
 * where it allows the type. Its lines (a `DataTable`, or a `SlicerGroup` each) are the children.
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
  return (
    <li
      id={id}
      aria-labelledby={heading}
      className="grid scroll-mt-4 gap-4 py-5 first:pt-0 last:pb-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="grid min-w-0">
            <h3 id={heading} className="min-w-0 wrap-anywhere text-base font-semibold">
              {title}
            </h3>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {badge}
        </div>
        {link && (
          <Link
            to={link.to}
            params={link.params as never}
            hash={link.hash}
            className="text-sm font-medium text-accent hover:underline"
          >
            {link.label}
          </Link>
        )}
      </div>
      {children}
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
};

/** A block's state lines in one table, Item | On | State, in line with the schedule lines. */
export function StateLines({ label, rows }: { label: string; rows: StateLine[] }) {
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
          cell: (r) => <span className="inline-block min-w-44 font-medium">{r.item}</span>,
        },
        {
          id: "on",
          header: t("settings:sources.columns.on"),
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
          header: t("settings:sources.columns.state"),
          cell: (r) => (
            <span className={cx("inline-block py-1.5", r.tone === "warn" && "text-warn")}>
              {r.state}
            </span>
          ),
        },
      ]}
    />
  );
}
