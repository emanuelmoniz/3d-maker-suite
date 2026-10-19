import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { QuotesTable } from "./QuotesTable.tsx";

/** The saved quotes; a new one, or one opened from the table, gets its own page. */
export function QuotesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t("nav:items.quotes.label")}
        description={t("nav:items.quotes.description")}
        actions={
          <>
            <Link
              to="/quotes/new"
              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden />
              {t("costs:saved.new")}
            </Link>
            <SettingsLink module="quotes" />
          </>
        }
      />
      <QuotesTable />
    </>
  );
}
