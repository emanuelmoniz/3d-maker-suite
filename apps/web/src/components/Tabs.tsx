import { Link, type LinkProps } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export type TabItem = {
  to: LinkProps["to"];
  label: string;
  /** Match only this exact path (a tab whose address is a prefix of another's). */
  exact?: boolean;
};

/**
 * Router-link tabs: the active one carries `aria-current="page"`, all are plain links (Tab and
 * Enter work). The row scrolls sideways at phone width and keeps the active tab in view.
 */
export function Tabs({ label, items }: { label: string; items: TabItem[] }) {
  const nav = useRef<HTMLElement>(null);
  // Every render: the active tab changes with the route.
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  });
  return (
    <nav
      ref={nav}
      aria-label={label}
      className="mb-6 flex gap-6 overflow-x-auto border-b border-border pb-px"
    >
      {items.map((i) => (
        <Link
          key={String(i.to)}
          to={i.to}
          activeOptions={{ exact: i.exact ?? false }}
          className="-mb-px inline-flex min-h-10 shrink-0 items-center whitespace-nowrap border-b-2 border-transparent px-1 font-medium text-muted hover:text-fg focus-visible:rounded-sm data-[status=active]:border-accent data-[status=active]:text-fg"
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
