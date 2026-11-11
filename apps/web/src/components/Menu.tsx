import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../lib/cx.ts";
import { placePopover } from "../lib/placePopover.ts";

/**
 * A "⋯" menu on native `<details>`: Enter/Space open it; a click outside, Escape or a pick closes
 * it. `trigger` swaps the icon for other content (then style the button with `triggerClass`). The
 * panel is fixed and follows the trigger, so a table that scrolls on its own doesn't clip it.
 */
export function Menu({
  label,
  children,
  trigger,
  triggerClass = "size-9 justify-center",
}: {
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  triggerClass?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const custom = !!trigger;
  useEffect(() => {
    const place = () => {
      const summary = ref.current?.querySelector("summary");
      const el = panel.current;
      if (!ref.current?.open || !summary || !el) return;
      placePopover(summary, el);
      // A "⋯" sits at the right of its row: its panel ends where the button ends.
      if (!custom)
        el.style.left = `${Math.max(8, summary.getBoundingClientRect().right - el.offsetWidth)}px`;
    };
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) ref.current?.removeAttribute("open");
    };
    const details = ref.current;
    details?.addEventListener("toggle", place);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      details?.removeEventListener("toggle", place);
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [custom]);
  return (
    <details
      ref={ref}
      className="group/menu relative"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !ref.current?.open) return;
        ref.current.removeAttribute("open");
        ref.current.querySelector("summary")?.focus();
      }}
    >
      <summary
        aria-label={label}
        className={cx(
          "flex cursor-pointer list-none items-center rounded-md hover:bg-surface-2 [&::-webkit-details-marker]:hidden",
          triggerClass,
        )}
      >
        {trigger ?? <MoreHorizontal className="size-5" aria-hidden />}
      </summary>
      {/* Hidden while closed: a closed <details> contains its content, and a fixed panel in it would
          sit by the trigger, off the screen's edge. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the buttons inside own the keys; this only closes */}
      <div
        ref={panel}
        onClick={() => ref.current?.removeAttribute("open")}
        className="fixed top-0 left-0 z-10 hidden min-w-48 group-open/menu:grid gap-0.5 rounded-md border border-border bg-surface p-1 shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}
