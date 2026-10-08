import { Construction } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import type { NavItem } from "../shell/nav.ts";

/** Placeholder for modules that land in later steps. */
export function ModulePage({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(item.label)} description={t(item.description)} />
      <EmptyState
        icon={Construction}
        title={t("common:placeholder.title")}
        description={t("common:placeholder.body")}
      />
    </>
  );
}
