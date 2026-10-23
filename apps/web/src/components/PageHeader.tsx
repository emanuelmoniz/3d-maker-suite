import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BackLink } from "./BackLink";

export function PageHeader({
  title,
  description,
  actions,
  backTo,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Fallback route for the back link, used when there is no in-app history. */
  backTo?: { to: LinkProps["to"]; params?: Record<string, string> };
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      {backTo && (
        <BackLink
          to={backTo.to}
          params={backTo.params}
          className="order-first -mb-1 flex min-h-10 w-full items-center gap-1 text-muted hover:text-fg md:min-h-6"
        />
      )}
      <div>
        <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="mt-0.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
