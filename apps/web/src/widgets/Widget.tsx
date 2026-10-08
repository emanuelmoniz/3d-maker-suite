import type { ReactNode } from "react";

/** Frame shared by the list and chart widgets. */
export function WidgetCard({
  title,
  children,
  more,
}: {
  title: string;
  children: ReactNode;
  more?: ReactNode;
}) {
  return (
    <section className="h-full rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}
