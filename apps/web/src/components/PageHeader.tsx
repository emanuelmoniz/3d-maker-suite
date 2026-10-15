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
  description?: string;
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
          className="order-first -mb-1 flex w-full items-center gap-1 text-muted hover:text-fg"
        />
      )}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}
