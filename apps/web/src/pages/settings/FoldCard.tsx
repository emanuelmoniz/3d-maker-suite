import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../../lib/cx.ts";

const KEY = "integrations.fold";

// localStorage is a per-viewer convenience: it can be missing or throw, and the card still works.
function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function saveFold(id: string, open: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readFolds(), [id]: open }));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export type FoldBadge = "error" | "paused" | null;

/**
 * The frame of an Integrations card: a header button that folds it, then the body. Closed by
 * default, remembered per browser, and open by itself while something needs attention. The edge
 * carries the state, so a closed list still shows which card to open.
 */
export function FoldCard({
  id,
  title,
  count,
  badge,
  pill,
  reveal,
  scroll,
  action,
  menu,
  children,
}: {
  /** Stable key for the remembered state and the `#` anchor. */
  id: string;
  title: string;
  /** "3 printers": what is inside. */
  count: string;
  badge: FoldBadge;
  /** Next to the count, open or closed (the default slicer). */
  pill?: ReactNode;
  /** A link brought the viewer here: open; with `scroll`, also scroll to that element id, or to the card for `true`. */
  reveal: boolean;
  scroll?: string | true;
  /** Shown on the right while open (the Add button). */
  action?: ReactNode;
  /** Shown on the right, open or closed (Remove integration). */
  menu?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const body = useId();
  const root = useRef<HTMLElement>(null);
  const [stored, setStored] = useState<boolean | undefined>(() => readFolds()[id]);
  const [revealed, setRevealed] = useState(false);
  const open = revealed || (stored ?? badge === "error");

  useEffect(() => {
    if (!reveal) return;
    setRevealed(true);
    if (!scroll) return;
    // The body mounts on this render; wait a frame so a row's own anchor exists.
    const frame = requestAnimationFrame(
      () =>
        (scroll === true ? null : document.getElementById(scroll))?.scrollIntoView({
          block: "center",
        }) ?? root.current?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [reveal, scroll]);

  const toggle = () => {
    setRevealed(false);
    setStored(!open);
    saveFold(id, !open);
  };

  return (
    <section
      ref={root}
      id={id}
      aria-labelledby={heading}
      className={cx(
        "min-w-0 scroll-mt-4 rounded-lg border border-border border-l-4 bg-surface",
        badge === "error"
          ? "border-l-bad"
          : badge === "paused"
            ? "border-l-warn"
            : "border-l-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pr-4 sm:pr-5">
        <h2 id={heading} className="min-w-0 flex-1 text-base font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={body}
            onClick={toggle}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg py-2 pr-2 pl-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent sm:pl-4"
          >
            <ChevronRight
              aria-hidden
              className={cx(
                "size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
            <span className="wrap-anywhere">{title}</span>
            <span className="text-sm font-normal text-muted">{count}</span>
            {pill}
            {badge && (
              <span
                className={cx(
                  "rounded-full border px-2 py-0.5 text-sm font-medium",
                  badge === "error" ? "border-bad/40 text-bad" : "border-warn/40 text-warn",
                )}
              >
                {t(badge === "error" ? "integrations:fold.error" : "integrations:fold.paused")}
              </span>
            )}
          </button>
        </h2>
        {((open && action) || menu) && (
          <div className="flex items-center gap-2">
            {open && action}
            {menu}
          </div>
        )}
      </div>
      {open && (
        <div id={body} className="grid gap-4 border-t border-border p-4 sm:p-5">
          {children}
        </div>
      )}
    </section>
  );
}

/** An error on any enabled row wins; all rows switched off is paused. */
export const badgeOf = (rows: readonly { enabled: boolean; status: string }[]): FoldBadge =>
  rows.some((i) => i.enabled && i.status === "error")
    ? "error"
    : rows.length && rows.every((i) => !i.enabled)
      ? "paused"
      : null;

// Literal keys so `pnpm i18n:check` sees them.
export const COUNT_KEYS = {
  accounts: "integrations:fold.accounts",
  printers: "integrations:fold.printers",
  sources: "integrations:fold.sources",
} as const;
export const ADD_KEYS = {
  accounts: "integrations:addAnother.accounts",
  printers: "integrations:addAnother.printers",
  sources: "integrations:addAnother.sources",
} as const;
