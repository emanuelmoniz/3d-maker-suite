import { wikiTarget } from "@3d-maker-suite/core";
import { type LinkProps, useRouterState } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";
import { BackLink } from "./BackLink";
import { HelpLink } from "./HelpLink.tsx";

/**
 * Inside a page that has its own title (a tab of Settings): the header is one level down, and has
 * no Help icon, because the outer header's already opens the open tab's section.
 */
export const NestedPageHeader = createContext(false);

export function PageHeader({
  title,
  badge,
  description,
  actions,
  backTo,
}: {
  title: string;
  /** Sits right next to the title, outside the heading (a status pill). */
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Fallback route for the back link, used when there is no in-app history. */
  backTo?: { to: LinkProps["to"]; params?: Record<string, string> };
}) {
  const nested = useContext(NestedPageHeader);
  // The open page's route, as the route map (packages/core/src/wikiRoutes.ts) writes it.
  const route = useRouterState({ select: (s): string | undefined => s.matches.at(-1)?.fullPath });
  const help = !nested && route ? wikiTarget(route) : undefined;
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
        <div className="flex flex-wrap items-center gap-2">
          {nested ? (
            <h2 className="min-w-0 text-lg font-semibold wrap-anywhere">{title}</h2>
          ) : (
            <h1 className="min-w-0 text-xl font-semibold tracking-tight wrap-anywhere">{title}</h1>
          )}
          {badge}
          {help && <HelpLink {...help} />}
        </div>
        {description && <p className="mt-0.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
