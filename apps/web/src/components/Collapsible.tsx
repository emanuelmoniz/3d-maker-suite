import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";

/** A page section that starts closed. Native `<details>`: mouse, Enter and Space work for free. */
export function Collapsible({
  title,
  children,
  className = "mt-6",
  ...rest
}: {
  title: string;
  children: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className} {...rest}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden
          />
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    </section>
  );
}
