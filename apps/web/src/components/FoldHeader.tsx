import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

/**
 * The title row of a collapsible card, shared by `Collapsible` and the Integrations `FoldCard`.
 * The whole row left of `end` is one button (`aria-expanded`), so a click anywhere on the title,
 * the count or a badge folds the card. `end` holds actions that must not fold it.
 */
export function FoldHeader({
  headingId,
  bodyId,
  open,
  onToggle,
  title,
  subtitle,
  icon,
  as: Heading = "h2",
  meta,
  end,
}: {
  headingId: string;
  bodyId: string;
  open: boolean;
  onToggle: () => void;
  title: string;
  /** A muted line under the title. */
  subtitle?: string;
  /** Before the title, after the chevron. */
  icon?: ReactNode;
  /** Heading level: h2 for a page section, h3 for a card inside one. */
  as?: "h2" | "h3";
  /** Inside the button, after the title: a count, a pill, a badge. */
  meta?: ReactNode;
  /** Outside the button, on the right: buttons and menus. */
  end?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pr-4 sm:pr-5">
      <Heading id={headingId} className="min-w-0 flex-1 text-base font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg py-2 pr-2 pl-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent sm:pl-4"
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
          {meta}
        </button>
      </Heading>
      {end && <div className="flex items-center gap-2">{end}</div>}
    </div>
  );
}
