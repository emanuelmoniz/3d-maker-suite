import { docsUrl, type WikiTarget } from "@3d-maker-suite/core";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Help icon: opens a guide section in the copy the app serves at `/guide/`, in a new tab, so the
 * page and anything typed in it stay put. A plain link: the guide is not part of the SPA.
 */
export function HelpLink({ page, section }: WikiTarget) {
  const { t } = useTranslation();
  const label = t("common:help");
  return (
    <a
      href={docsUrl(page, section)}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <CircleHelp className="size-5" aria-hidden="true" />
    </a>
  );
}
