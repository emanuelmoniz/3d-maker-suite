import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState.tsx";

export const secondaryLink =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";

/**
 * A missing item, or one the person may not see: one text for both, so a private project or
 * someone else's alert doesn't give away that it exists (6.2.0 Step 3f). `back` = its list.
 */
export function ItemMissing({ back }: { back?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t("common:notFound.item")}
      description={t("common:notFound.itemBody")}
      action={
        back ? (
          <Link to={back} className={secondaryLink}>
            {t("common:notFound.back")}
          </Link>
        ) : (
          <Link to="/" className={secondaryLink}>
            {t("common:rights.cantOpen.home")}
          </Link>
        )
      }
    />
  );
}
