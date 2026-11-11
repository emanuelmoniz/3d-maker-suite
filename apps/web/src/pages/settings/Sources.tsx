import { Link, type LinkProps } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "../../components/Section.tsx";

/**
 * A Sources tab's section (ADR-0021): the sources that feed the hub, or the machines it sends to.
 * Its blocks are the children, one per source.
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
      wide
      title={direction === "share" ? t("settings:sources.share") : t("settings:sources.receive")}
    >
      <ul className="divide-y divide-border">{children}</ul>
    </Section>
  );
}

/**
 * One source in a section: who it is (an account, a machine and its user) and the link back to
 * where it allows the type. Its lines (a `DataTable`, or a `SlicerGroup` each) are the children.
 */
export function SourceBlock({
  icon,
  title,
  badge,
  link,
  children,
}: {
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  link?: { to: LinkProps["to"]; hash?: string; label: string };
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <li aria-labelledby={heading} className="grid gap-3 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <h3 id={heading} className="min-w-0 wrap-anywhere text-base font-semibold">
            {title}
          </h3>
          {badge}
        </div>
        {link && (
          <Link
            to={link.to}
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

/** A machine's lines of one slicer, where the type belongs to a slicer (ADR-0021). */
export function SlicerGroup({ name, children }: { name: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="grid gap-2">
      <h4 id={heading} className="font-medium text-muted">
        {name}
      </h4>
      {children}
    </section>
  );
}
