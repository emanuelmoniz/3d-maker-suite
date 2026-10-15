import { Link, type LinkProps, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Goes back in history when there is in-app history; otherwise navigates to the fixed `to` route. */
export function BackLink({
  to,
  params,
  className,
}: {
  to: LinkProps["to"];
  params?: Record<string, string>;
  className?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <Link
      to={to}
      params={params as never}
      className={className}
      onClick={(e) => {
        if (!canGoBack) return;
        e.preventDefault();
        router.history.back();
      }}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {t("common:actions.back")}
    </Link>
  );
}
