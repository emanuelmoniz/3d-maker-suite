import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="grid gap-4 sm:max-w-md">{children}</div>
    </section>
  );
}
