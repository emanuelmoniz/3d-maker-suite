import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function PageHeader({
  title,
  description,
  actions,
  backTo,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Parent route for the back link; the page passes it explicitly (no history.back()). */
  backTo?: { to: LinkProps["to"]; params?: Record<string, string> };
}) {
  const { t } = useTranslation();
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      {backTo && (
        <Link
          to={backTo.to}
          params={backTo.params as never}
          className="order-first -mb-1 flex w-full items-center gap-1 text-muted hover:text-fg"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t("common:actions.back")}
        </Link>
      )}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}
