import { type ReactNode, useId, useState } from "react";
import { cx } from "../lib/cx.ts";
import { FoldHeader } from "./FoldHeader.tsx";

/**
 * A page section card that starts closed. The body stays mounted while closed (so form fields and
 * file inputs inside keep their state) and is hidden from view and from assistive tech.
 */
export function Collapsible({
  title,
  count,
  children,
  className = "mt-6",
  defaultOpen = false,
  ...rest
}: {
  title: string;
  /** Shown after the title, like the count on an Integrations card. */
  count?: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const heading = useId();
  const body = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      aria-labelledby={heading}
      className={cx("min-w-0 rounded-lg border border-border bg-surface", className)}
      {...rest}
    >
      <FoldHeader
        headingId={heading}
        bodyId={body}
        open={open}
        onToggle={() => setOpen(!open)}
        title={title}
        meta={count && <span className="text-sm font-normal text-muted">{count}</span>}
      />
      <div id={body} hidden={!open} className="border-t border-border p-4 sm:p-5">
        {children}
      </div>
    </section>
  );
}
