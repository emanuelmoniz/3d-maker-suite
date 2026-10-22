import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/** A "⋯" menu on native `<details>`: Enter/Space open it; a click outside, Escape or a pick closes it. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
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
        className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-surface-2 [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </summary>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the buttons inside own the keys; this only closes */}
      <div
        onClick={() => ref.current?.removeAttribute("open")}
        className="absolute right-0 z-10 mt-1 grid min-w-48 gap-0.5 rounded-md border border-border bg-surface p-1 shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}
