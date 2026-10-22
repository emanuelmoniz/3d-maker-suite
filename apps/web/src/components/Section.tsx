import { REPO_URL } from "@3d-maker-suite/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** A settings card. Its fields stay a narrow column unless `wide`. */
export function Section({
  title,
  wide,
  id,
  help,
  children,
}: {
  title: string;
  wide?: boolean;
  /** Anchor for links such as `/settings#updates`. */
  id?: string;
  /** Doc path in the repo (e.g. `docs/projects.md`), shown as a small "Help" link. */
  help?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id={id} className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {help && (
          <a
            href={`${REPO_URL}/blob/main/${help}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            {t("common:help")}
          </a>
        )}
      </div>
      <div className={wide ? "grid gap-4" : "grid gap-4 sm:max-w-md"}>{children}</div>
    </section>
  );
}
