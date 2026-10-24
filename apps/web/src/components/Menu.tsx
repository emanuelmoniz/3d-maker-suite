import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../lib/cx.ts";

/**
 * A "⋯" menu on native `<details>`: Enter/Space open it; a click outside, Escape or a pick closes it.
 * `trigger` swaps the icon for other content (then style the button with `triggerClass`); `panelClass` places the panel.
 */
export function Menu({
  label,
  children,
  trigger,
  triggerClass = "size-9 justify-center",
  panelClass = "right-0 mt-1",
}: {
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  triggerClass?: string;
  panelClass?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) ref.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  return (
    <details
      ref={ref}
      className="relative"
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
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the buttons inside own the keys; this only closes */}
      <div
        onClick={() => ref.current?.removeAttribute("open")}
        className={cx(
          "absolute z-10 grid min-w-48 gap-0.5 rounded-md border border-border bg-surface p-1 shadow-lg",
          panelClass,
        )}
      >
        {children}
      </div>
    </details>
  );
}
