import { REPO_URL } from "@3d-maker-suite/core";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { textLink } from "../lib/cx.ts";

/**
 * Half-width `Section` cards: one column on mobile; on a desktop two columns that each stack their
 * cards (CSS columns), so a short card leaves no gap under it. Only half cards go in it: a
 * full-width card or note sits between two of these in the page's `grid gap-4` (inside the
 * columns, the space above and below it breaks).
 */
// The space is each card's top margin, which the browser drops at the top of the second column.
export const cardGrid =
  "grid gap-4 lg:block lg:columns-2 lg:*:break-inside-avoid lg:*:not-first:mt-4";

/** A settings card: full width, or half a desktop row in a `cardGrid`. */
export function Section({
  title,
  id,
  help,
  action,
  children,
}: {
  title: string;
  /** Anchor for links such as `/settings#updates`. */
  id?: string;
  /** Doc path in the repo (e.g. `docs/projects.md`), shown as a small "Help" link. */
  help?: string;
  /** A link or button on the right of the title (e.g. "Add another account"). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const heading = useId();
  return (
    <section
      id={id}
      aria-labelledby={heading}
      className="min-w-0 scroll-mt-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={heading} className="text-base font-semibold">
          {title}
        </h2>
        {help && (
          <a
            href={`${REPO_URL}/blob/main/${help}`}
            target="_blank"
            rel="noreferrer"
            className={`text-sm ${textLink}`}
          >
            {t("common:help")}
          </a>
        )}
        {action}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}
