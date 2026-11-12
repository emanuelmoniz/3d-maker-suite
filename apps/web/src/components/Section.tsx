import { REPO_URL } from "@3d-maker-suite/core";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { textLink } from "../lib/cx.ts";

/** A settings card. Its fields stay a narrow column unless `wide`. */
export function Section({
  title,
  wide,
  id,
  help,
  action,
  children,
}: {
  title: string;
  wide?: boolean;
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
      className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
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
      <div className={wide ? "grid gap-4" : "grid gap-4 sm:max-w-md"}>{children}</div>
    </section>
  );
}
