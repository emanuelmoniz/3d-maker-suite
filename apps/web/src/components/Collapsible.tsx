import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";

/** A page section that starts closed. Native `<details>`: mouse, Enter and Space work for free. */
export function Collapsible({
  title,
  children,
  className = "mt-6",
  defaultOpen = false,
  ...rest
}: {
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className} {...rest}>
      <details className="group" open={defaultOpen || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-surface px-3 hover:bg-surface-2 group-open:mb-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden
          />
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
        </summary>
        <div>{children}</div>
      </details>
    </section>
  );
}
