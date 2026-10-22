import type { ReactNode } from "react";

/** A settings card. Its fields stay a narrow column unless `wide`. */
export function Section({
  title,
  wide,
  id,
  children,
}: {
  title: string;
  wide?: boolean;
  /** Anchor for links such as `/settings#updates`. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className={wide ? "grid gap-4" : "grid gap-4 sm:max-w-md"}>{children}</div>
    </section>
  );
}
